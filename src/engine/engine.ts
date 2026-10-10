import type { PriceSource, Steer } from '../market/types';
import { PT, TICK_MS } from '../market/types';
import type { ModeDef } from './modes';
import { Rng } from './rng';

export interface GameConfig {
  mode: ModeDef; // 実際に使うモード（ヒミツは解決済み）
  leverage: number;
  marginPerShot: number; // 1発の証拠金 [円]
  holdMs: number; // 建ててから自動決済までの時間
  roundMs: number; // ラウンドの長さ
  initialCash: number;
  /**
   * 決済ルール．fx = 値幅×数量で損益（FX式，既定），binary = ハイロー（当たれば賭け金×payout，外れたら賭け金を全額失う），
   * martingale = binary ＋ 倍賭け（負けたら次の賭け金を2倍，勝ったら元に戻す）
   */
  rule?: Rule;
  /** ハイローの払い戻し倍率（既定 1.85） */
  payout?: number;
}

export type Rule = 'fx' | 'binary' | 'martingale';
export const DEFAULT_PAYOUT = 1.85;

export type Dir = 1 | -1;
export type Outcome = 'win' | 'lose' | 'draw';

export interface Position {
  id: number;
  dir: Dir;
  entryMid: number; // [pt]
  entrySpread: number; // [pt]
  units: number; // 数量 [USD]（ハイローでは賭け金と同じ値を入れ，胴元ドリフトの重みにだけ使う）
  margin: number; // [円]（ハイローでは賭け金）
  openT: number;
  dueT: number;
}

export type EngineEvent =
  | { k: 'open'; pos: Position }
  | { k: 'reject'; reason: 'margin' | 'closed' | 'rate' }
  | { k: 'settle'; pos: Position; exitMid: number; pnl: number; outcome: Outcome; streak: number }
  | { k: 'losscut'; pnl: number; count: number }
  | { k: 'end'; reason: 'time' | 'bankrupt' };

/** ロスカット水準：有効証拠金 < 使用中証拠金 × 50% */
export const LOSSCUT_RATIO = 0.5;
/** 「必ず勝ち越し」でロスカットを起こさないための安全水準 */
const MUSTWIN_GUARD_RATIO = 0.65;

/**
 * 取引エンジン（DOM 非依存．ブラウザとシミュレーションで共用）．
 * 1ティック = 50ms．step() を呼ぶたびに時間が進む．
 */
export class Engine {
  t = 0;
  mid: number;
  balance: number; // 確定済み残高 [円]
  positions: Position[] = [];
  wins = 0;
  losses = 0;
  draws = 0;
  realized = 0;
  streak = 0; // +n = n連勝中，−n = n連敗中
  maxWinStreak = 0;
  losscuts = 0;
  shots = 0;
  maxEquity: number;
  minEquity: number;
  equityHist: { t: number; eq: number }[] = [];
  finished = false;
  endReason: 'time' | 'bankrupt' | null = null;
  /** 1ティックに建てられるのは1発まで（連打ツール対策と決済キューの釣り合い） */
  private lastOpenTick = -1;
  /** 必ず勝ち越しで，ロスカット回避より決済を優先した回数（シミュレーションで監視） */
  forcedSettles = 0;
  /** ゼロカットで免除した額の合計 [円] */
  zeroCutTotal = 0;
  /** 倍賭けの段数（次の賭け金 = 1発の金額 × 2^mgLevel） */
  mgLevel = 0;
  /** このラウンドで最も大きかった賭け金（倍賭けの振り返り用） */
  maxStake = 0;
  private nextId = 1;

  constructor(
    readonly cfg: GameConfig,
    readonly source: PriceSource,
    private readonly rng: Rng,
  ) {
    this.balance = cfg.initialCash;
    this.mid = source.next(0);
    this.maxEquity = this.minEquity = cfg.initialCash;
    this.equityHist.push({ t: 0, eq: cfg.initialCash });
  }

  get spread(): number {
    return this.source.spread();
  }
  get bid(): number {
    return this.mid - this.spread / 2;
  }
  get ask(): number {
    return this.mid + this.spread / 2;
  }
  get rule(): Rule {
    return this.cfg.rule ?? 'fx';
  }
  get isBinary(): boolean {
    return this.rule !== 'fx';
  }
  get payout(): number {
    return this.cfg.payout ?? DEFAULT_PAYOUT;
  }
  /** 1回の掛け金（証拠金）をゲーム途中で変える．次の発注から有効で，建玉中のものは変わらない */
  setStake(yen: number): void {
    this.cfg.marginPerShot = Math.max(100, Math.round(yen));
  }
  /** 次の1発の金額（倍賭けなら段数ぶん2倍ずつ） */
  nextStake(): number {
    return this.rule === 'martingale' ? this.cfg.marginPerShot * 2 ** this.mgLevel : this.cfg.marginPerShot;
  }
  get acceptingOrders(): boolean {
    return !this.finished && this.t < this.cfg.roundMs;
  }

  /** 建玉 p を mid=x で決済したときの損益 [円] */
  pnlAt(p: Position, x: number, spreadNow = this.spread): number {
    if (this.isBinary) {
      // ハイロー：建値より有利なら賭け金×(倍率−1)の勝ち，不利なら賭け金を全額失う，同値は返金
      const k = p.dir * (x - p.entryMid);
      return k > 0 ? p.margin * (this.payout - 1) : k < 0 ? -p.margin : 0;
    }
    return (p.units * (p.dir * (x - p.entryMid) - (p.entrySpread + spreadNow) / 2)) / PT;
  }
  usedMargin(): number {
    let m = 0;
    for (const p of this.positions) m += p.margin;
    return m;
  }
  unrealized(x = this.mid): number {
    let u = 0;
    for (const p of this.positions) u += this.pnlAt(p, x);
    return u;
  }
  equity(x = this.mid): number {
    return this.balance + this.unrealized(x);
  }
  freeMargin(): number {
    return this.equity() - this.usedMargin();
  }
  canAfford(): boolean {
    // ハイローは賭け金を確定残高から出す（含み損益では賭けられない）
    if (this.isBinary) return this.balance - this.usedMargin() >= this.nextStake();
    return this.freeMargin() >= this.cfg.marginPerShot;
  }

  open(dir: Dir): EngineEvent {
    if (!this.acceptingOrders) return { k: 'reject', reason: 'closed' };
    const tick = Math.round(this.t / TICK_MS);
    if (tick === this.lastOpenTick) return { k: 'reject', reason: 'rate' };
    if (!this.canAfford()) return { k: 'reject', reason: 'margin' };
    this.lastOpenTick = tick;

    const bin = this.isBinary;
    const stake = this.nextStake();
    const s = bin ? 0 : this.spread; // ハイローは中値で判定（胴元の取り分は払い戻し倍率に含まれる）
    const entryPx = this.mid + (dir * s) / 2; // 買いは Ask，売りは Bid
    const units = bin ? stake : (stake * this.cfg.leverage) / (entryPx / PT);
    this.maxStake = Math.max(this.maxStake, stake);
    const pos: Position = {
      id: this.nextId++,
      dir,
      entryMid: this.mid,
      entrySpread: s,
      units,
      margin: stake,
      openT: this.t,
      dueT: this.t + this.cfg.holdMs,
    };
    this.positions.push(pos);
    this.shots++;
    return { k: 'open', pos };
  }

  step(dt = TICK_MS): EngineEvent[] {
    const ev: EngineEvent[] = [];
    if (this.finished) return ev;
    this.t += dt;
    const dr = this.cfg.mode.director;

    // 1. 価格を進める（ディレクターはプレイヤーの正味ポジションに逆らう／味方するドリフトを加える）
    let steer: Steer | undefined;
    if (dr && this.positions.length) steer = { drift: this.directorDrift(dt) };
    let x = this.source.next(dt, steer);

    // 2. 「必ず勝ち越し」：ロスカット水準に近づかないよう価格を制限
    if (dr?.invariant === 'win' && !this.isBinary) x = this.clampToGuard(x, null, MUSTWIN_GUARD_RATIO) ?? x;
    this.mid = x;
    this.source.set(x);

    // 3. 期日の来た建玉を決済
    if (dr?.clamp) {
      // 決済キュー：1ティック1件．決済の瞬間の価格を目標領域に入れる（最終保証）
      // 先頭が決済できない（必ず勝ち越しのロスカット回避と両立しない）ときは次の建玉を試す
      const due = this.positions.filter((q) => q.dueT <= this.t).sort((a, b) => a.dueT - b.dueT);
      for (const p of due) {
        const xs = this.directedExit(p);
        if (xs === null) continue;
        this.mid = xs;
        this.source.set(xs);
        ev.push(this.settle(p, xs));
        break;
      }
    } else {
      for (const p of this.positions.filter((q) => q.dueT <= this.t)) ev.push(this.settle(p, this.mid));
    }

    // 4. ロスカット判定（「必ず勝ち越し」は仕様上ロスカットを起こさない）
    if (!this.isBinary && dr?.invariant !== 'win' && this.positions.length && this.equity() < this.usedMargin() * LOSSCUT_RATIO) {
      ev.push(this.losscut());
    }

    // 4b. ゼロカット：急な値飛びでロスカットが間に合わず残高がマイナスになった分は 0 円で止める（借金にしない）
    if (this.balance < 0) {
      this.zeroCutTotal += -this.balance;
      this.realized += -this.balance;
      this.balance = 0;
    }

    // 5. 記録と終了判定
    const eq = this.equity();
    this.maxEquity = Math.max(this.maxEquity, eq);
    this.minEquity = Math.min(this.minEquity, eq);
    if (this.t % 250 === 0) this.equityHist.push({ t: this.t, eq });
    if (!this.positions.length) {
      if (this.t >= this.cfg.roundMs) this.finish('time', ev);
      else if (!this.canAfford()) this.finish('bankrupt', ev);
    }
    return ev;
  }

  private finish(reason: 'time' | 'bankrupt', ev: EngineEvent[]) {
    this.finished = true;
    this.endReason = reason;
    this.equityHist.push({ t: this.t, eq: this.balance });
    ev.push({ k: 'end', reason });
  }

  /**
   * 胴元ドリフト：決済が近い建玉ほど重く数えた正味ポジション E = Σ dir·units·exp(−残り時間/τ) を求め，
   *   drift = sign · c · σ_tick / √N · tanh(E / 1発分の数量)   （N = 保有時間のティック数）
   * 保有時間全体で積算すると c · σ_H（決済までの値動きの標準偏差の c 倍）だけ相場が逆行／順行する．
   * sign は負けモードで −1（プレイヤーの逆へ），勝ちモードで +1．c は ModeDef.director.kappa．
   * 1ティックの誘導量はノイズよりずっと小さいので，見た目は普通のランダムウォークのまま．
   */
  private directorDrift(dt: number): number {
    const dr = this.cfg.mode.director!;
    const tau = this.cfg.holdMs / 2;
    let E = 0;
    let unit = 0;
    for (const p of this.positions) {
      E += p.dir * p.units * Math.exp(-Math.max(0, p.dueT - this.t) / tau);
      unit = Math.max(unit, p.units);
    }
    const sign = dr.pWin < 0.5 ? -1 : 1;
    const sigmaTick = this.source.sigmaPerSqrtMs() * Math.sqrt(dt);
    return sign * dr.kappa * sigmaTick * Math.sqrt(dt / this.cfg.holdMs) * Math.tanh(E / unit);
  }

  /**
   * 決済の瞬間の価格を決める（clamp ありのモードのみ）．
   * k = dir·(x − 建値) で考えると，勝ち ⇔ k ≥ s+1，負け ⇔ k ≤ s−1（s はスプレッド）．
   * 自然に決まった結果が「不変条件」と「目標勝率」の両方を満たすならそのまま．
   * 満たさないときだけ，許される領域の端（から 0〜3pt 内側）へ最小限動かす．
   * null を返したら今ティックは見送り（必ず勝ち越しでロスカット回避と両立しない場合のみ）．
   */
  private directedExit(p: Position): number | null {
    const dr = this.cfg.mode.director!;
    const s = this.isBinary ? 0 : Math.round((p.entrySpread + this.spread) / 2);
    const kNow = p.dir * (this.mid - p.entryMid);
    const n = this.wins + this.losses + 1;
    let wantWin: boolean;
    if (dr.invariant === 'lose') {
      wantWin = kNow >= s + 1 && (this.wins + 1) / n <= dr.pWin + 0.05;
    } else if (dr.invariant === 'win') {
      wantWin = !(kNow <= s - 1 && (this.losses + 1) / n <= 1 - dr.pWin + 0.05);
    } else {
      wantWin = kNow >= s + 1 ? (this.wins + 1) / n <= dr.pWin + 0.05 : (this.losses + 1) / n > 1 - dr.pWin + 0.05;
    }
    const x = this.directedExitAs(p, wantWin, MUSTWIN_GUARD_RATIO);
    if (x !== null || dr.invariant !== 'win') return x;
    // 必ず勝ち越し：小さく負けさせるとロスカット回避と両立しないなら勝ちに切り替える．
    // それも無理なら安全水準をロスカット直前まで下げて再挑戦
    const w = this.directedExitAs(p, true, MUSTWIN_GUARD_RATIO) ?? this.directedExitAs(p, true, LOSSCUT_RATIO + 0.01);
    if (w !== null) return w;
    // 最後の手段：3 秒を超えて見送ったらロスカット回避より決済を優先（終わらないラウンドを作らない）
    if (this.t - p.dueT >= 3000) {
      this.forcedSettles++;
      return this.directedExitAs(p, true, 0);
    }
    return null;
  }

  /** 結果を wantWin にする（不変条件で許されなければ安全側に倒す）決済価格 */
  private directedExitAs(p: Position, wantWinIn: boolean, guardRatio: number): number | null {
    const dr = this.cfg.mode.director!;
    let wantWin = wantWinIn;
    const bin = this.isBinary;
    const s = bin ? 0 : Math.round((p.entrySpread + this.spread) / 2);
    const perPt = p.units / PT; // 1pt あたりの損益 [円]
    let lo = -Infinity;
    let hi = Infinity;

    if (bin) {
      // ハイロー：損益は値幅によらず固定なので，勝ち／負けの可否だけを判定する
      const winPnl = p.margin * (this.payout - 1);
      if (dr.invariant === 'lose' && !(this.wins + 1 < this.losses && this.realized + winPnl < 0)) wantWin = false;
      if (dr.invariant === 'win' && !(this.wins > this.losses + 1 && this.realized - p.margin > 0)) wantWin = true;
    } else if (dr.invariant === 'lose') {
      // 勝ちにできるのは：決済後も 勝ち<負け かつ 累積損益<0 のとき
      const kMax = s + Math.ceil(-this.realized / perPt) - 1; // pnl < −realized
      const winOk = this.wins + 1 < this.losses && this.realized < 0 && kMax >= s + 1;
      if (wantWin && winOk) {
        lo = s + 1;
        hi = kMax;
      } else {
        wantWin = false;
      }
    } else if (dr.invariant === 'win') {
      // 負けにできるのは：決済後も 勝ち>負け かつ 累積損益>0 のとき
      const kMin = s - Math.ceil(this.realized / perPt) + 1; // −pnl < realized
      const loseOk = this.wins > this.losses + 1 && this.realized > 0 && kMin <= s - 1;
      if (!wantWin && loseOk) {
        lo = kMin;
        hi = s - 1;
      } else {
        wantWin = true;
      }
    }
    if (wantWin) lo = Math.max(lo, s + 1);
    else hi = Math.min(hi, s - 1);

    const kNow = p.dir * (this.mid - p.entryMid);
    let k = kNow;
    if (k < lo || k > hi) {
      // 領域外なら，跳びが最小になるよう領域の端から少し（0〜3pt）内側へ
      const r = Math.floor(this.rng.next() * 4);
      k = k < lo ? Math.min(hi, lo + r) : Math.max(lo, hi - r);
    }
    let x = p.entryMid + p.dir * k;

    if (dr.invariant === 'win' && guardRatio > 0 && !bin) {
      // ロスカット回避の範囲とも両立させる（[lo,hi] を x 空間に写して交差）
      const xa = p.entryMid + p.dir * lo;
      const xb = p.entryMid + p.dir * hi;
      const g = this.clampToGuard(x, [Math.min(xa, xb), Math.max(xa, xb)], guardRatio, p);
      if (g === null) return null;
      x = g;
    }
    return x;
  }

  /**
   * 「必ず勝ち越し」用：有効証拠金 ≥ 使用中証拠金×GUARD を満たす x に寄せる．
   * equity(x) は x の一次式 C + A·x．range が与えられたらその中で探し，両立しなければ null．
   * settling を渡すと，その建玉を決済した後の帳簿で判定する．
   */
  private clampToGuard(x: number, range: [number, number] | null, ratio: number, settling?: Position): number | null {
    const book = settling ? this.positions.filter((q) => q !== settling) : this.positions;
    let lo = range ? range[0] : -Infinity;
    let hi = range ? range[1] : Infinity;
    if (book.length) {
      let A = 0;
      let C = this.balance;
      let M = 0;
      for (const q of book) {
        const c = q.units / PT;
        A += c * q.dir;
        C += c * (-q.dir * q.entryMid - (q.entrySpread + this.spread) / 2);
        M += q.margin;
      }
      // 決済する建玉の損益も残高に入る（x の一次式として加える）
      if (settling) {
        const c = settling.units / PT;
        A += c * settling.dir;
        C += c * (-settling.dir * settling.entryMid - (settling.entrySpread + this.spread) / 2);
      }
      const need = M * ratio;
      if (A > 0) lo = Math.max(lo, Math.ceil((need - C) / A));
      else if (A < 0) hi = Math.min(hi, Math.floor((need - C) / A));
    }
    if (lo > hi) return range ? null : x;
    return Math.min(hi, Math.max(lo, x));
  }

  private record(pnl: number, forced?: Outcome): { outcome: Outcome; streak: number } {
    const outcome: Outcome = forced ?? (pnl > 1e-9 ? 'win' : pnl < -1e-9 ? 'lose' : 'draw');
    if (this.rule === 'martingale') {
      if (outcome === 'win') this.mgLevel = 0;
      else if (outcome === 'lose') this.mgLevel++;
    }
    if (outcome === 'win') {
      this.wins++;
      this.streak = this.streak > 0 ? this.streak + 1 : 1;
      this.maxWinStreak = Math.max(this.maxWinStreak, this.streak);
    } else if (outcome === 'lose') {
      this.losses++;
      this.streak = this.streak < 0 ? this.streak - 1 : -1;
    } else {
      this.draws++;
    }
    this.realized += pnl;
    this.balance += pnl;
    return { outcome, streak: this.streak };
  }

  private settle(p: Position, x: number): EngineEvent {
    const pnl = this.pnlAt(p, x);
    this.positions = this.positions.filter((q) => q !== p);
    const r = this.record(pnl);
    return { k: 'settle', pos: p, exitMid: x, pnl, ...r };
  }

  /** ロスカット：全建玉を強制決済．まとめて「1敗」と数える */
  private losscut(): EngineEvent {
    const count = this.positions.length;
    if (this.cfg.mode.director?.invariant === 'lose') {
      // 必ず負け越し：ロスカット後も累積損益<0 となるよう，執行価格を不利側へ滑らせる（スリッページ）
      let A = 0;
      for (const p of this.positions) A += (p.dir * p.units) / PT;
      const need = this.unrealized() + this.realized + 1; // U をこれだけ下げる必要がある（0 以下なら不要）
      if (need > 0 && A !== 0) {
        this.mid -= Math.sign(A) * Math.ceil(need / Math.abs(A));
        this.source.set(this.mid);
      }
    }
    const pnl = this.unrealized();
    this.positions = [];
    this.losscuts++;
    // 残高が減った後だと含み損益の合計がプラスのままロスカットされることもあるが，ロスカットは常に「負け」
    this.record(pnl, 'lose');
    return { k: 'losscut', pnl, count };
  }
}
