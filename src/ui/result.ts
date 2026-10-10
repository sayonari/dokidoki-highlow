import { MODES, SECRET_POOL, modeDef } from '../engine/modes';
import type { ModeId } from '../engine/modes';
import { sfx } from '../audio/sfx';
import { Particles } from '../fx/particles';
import type { GameResult } from './game';
import type { Settings } from './settings';
import { recheckAchievements, recordRound } from './records';
import type { Achievement, Ctx, Update } from './records';
import type { Rule } from '../engine/engine';
import { RULE_NAMES, h, sleep, yen } from './util';

export function educationalNote(r: GameResult): string {
  const e = r.engine;
  const id = r.cfg.mode.id;
  const L = r.cfg.leverage;
  if (e.rule === 'martingale') return `倍賭けは連敗すると 基本の掛け金が倍々（×1→×2→×4→×8…）と賭け金が一気にふくらみ，すぐに払えなくなります（今回の最大の賭け金：${yen(e.maxStake)}円）`;
  if (e.rule === 'binary') return '払い戻し1.85倍のハイローは，勝率54%以上でないと平均でお金が減ります．数秒後の上下はほぼ五分五分なので，続けるほど減っていきます';
  if (id === 'mustwin') return '「必ず勝ち越し」は現実には存在しません．「絶対もうかる」と言われたら詐欺を疑おう';
  if (id === 'mustlose') return '「必ず負け越し」は胴元が値動きを操作した場合の姿．取引相手が信頼できるかはとても大事';
  if (e.losscuts > 0) return 'ロスカットは損が大きくなりすぎる前に強制的に決済するしくみ．でも値が急に飛ぶと間に合わないことも．このゲームではマイナス分を0円で止めています（ゼロカット）';
  if (L >= 500) {
    const pct = +(100 / L / 2).toFixed(2);
    return `レバレッジ${L}倍だと，たった${pct}%の逆行で証拠金の半分が消えます．日本の個人向けFXの上限は25倍です`;
  }
  if (id === 'random') return '完全ランダムな相場では，どんな作戦でも期待値は0．勝ち負けはただの運です';
  if (id === 'loseish' || id === 'winish') return '相場の“クセ”は見抜けた？ 本物の相場にこんな都合のいいクセはまずありません';
  if (e.maxWinStreak >= 5) return '5連勝の大当たりが出ても，次に勝つ確率は変わりません（ギャンブラーの誤謬）';
  return '数秒の上下当ては，スプレッド（売値と買値の差）の分だけ平均すると負けるゲームです';
}

/** 一言の称号（上にあるほど優先） */
export function titleOf(r: GameResult): string {
  const e = r.engine;
  const id = r.cfg.mode.id;
  const bin = e.isBinary;
  const L = bin ? 100 : r.cfg.leverage; // ハイローにレバレッジは無関係
  const pnl = e.realized;
  const taps = Math.max(e.shots, r.log.taps.up + r.log.taps.down);
  if (e.rule === 'martingale' && e.endReason === 'bankrupt') return '倍賭けの犠牲者';
  if (id === 'mustwin') return '相場の神に愛されし者';
  if (id === 'mustlose') return '胴元のお得意さま';
  if (pnl >= r.cfg.initialCash * 0.5) return '爆益の申し子';
  if (L >= 500 && pnl > 0) return '命知らずの勝負師';
  if (e.losscuts >= 2) return 'ロスカット職人';
  if (taps >= 100) return '連打の鬼';
  if (e.maxWinStreak >= 10) return '連勝マスター';
  if (pnl > 0 && L <= 25) return '堅実トレーダー';
  if (pnl > 0) return 'ドキドキの勝者';
  if (id === 'random') return 'コイン投げの旅人';
  if (bin && pnl < 0) return '胴元のお得意さま';
  if (pnl < 0 && pnl > -10000) return 'かすり傷の冒険家';
  if (pnl < 0 && L >= 500) return 'ハラハラの冒険家';
  return '見習いトレーダー';
}

export function copyText(r: GameResult): string {
  const e = r.engine;
  return `ドキドキハイ＆ロー［${RULE_NAMES[e.rule]}］結果：${yen(e.realized, true)}円（${e.wins}勝${e.losses}敗）称号『${titleOf(r)}』 #ドキドキハイアンドロー`;
}

export class ResultScreen {
  private root: HTMLElement;
  private alive = true;
  private raf = 0;
  private particles: Particles | null = null;
  private timers: number[] = [];
  private upd: Update | null;
  private popQueue: Achievement[] = [];
  private popping = false;
  private popHost: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly r: GameResult,
    private readonly settings: Settings,
    private readonly onRetry: () => void,
    private readonly onTitle: () => void,
    private readonly onRetryLev: (lev: number) => void = () => onRetry(),
    private readonly onRetryRule: (rule: Rule) => void = () => onRetry(),
  ) {
    this.root = h('div', 'screen result');
    this.popHost = h('div', 'ach-pop-host');
    parent.appendChild(this.root);
    this.upd = recordRound(this.ctx(false));
    this.build();
  }

  private ctx(guessCorrect: boolean): Ctx {
    return { engine: this.r.engine, cfg: this.r.cfg, log: this.r.log, secret: this.r.secret, guessCorrect };
  }

  private build() {
    const { engine: e, cfg, log } = this.r;
    const pnl = e.realized;
    const final = e.balance;
    const plus = Math.round(pnl) > 0;
    const minus = Math.round(pnl) < 0;
    const calm = this.settings.fx === 0;
    const newBest = !!this.upd?.newBest;
    const title = titleOf(this.r);

    this.root.classList.add(plus ? 'is-plus' : 'is-minus');
    if (plus && !calm) this.root.append(h('div', 'halo'));
    let rain: HTMLCanvasElement | null = null;
    if (minus && !calm) {
      rain = h('canvas', 'rain');
      this.root.append(rain);
      this.startRain(rain);
    }

    const card = h('div', 'card');
    if (newBest) card.append(h('div', 'best-band', '🏅 自己ベスト更新!! 🏅'));
    card.append(h('div', 'verdict ' + (plus ? 'win' : minus ? 'lose' : ''), plus ? 'プラスで終了!!' : minus ? 'マイナスで終了…' : '±0'));
    card.append(h('div', 'res-rule', RULE_NAMES[e.rule]));
    card.append(h('div', 'res-title', `称号『${title}』`));

    const bal = h('div', 'res-balance');
    bal.append(h('div', 'res-label', '最終残高'));
    const balVal = h('div', 'res-balance-val', '¥0');
    bal.append(balVal);
    card.append(bal);

    card.append(h('div', 'res-pnl ' + (plus ? 'plus' : minus ? 'minus' : ''), `損益 ${yen(pnl, true)}円`));

    // 収支とは別に，勝ち負けの「回数」
    const total = e.wins + e.losses;
    const rate = total ? Math.round((e.wins / total) * 100) : 0;
    const wl = h('div', 'res-wl');
    wl.append(h('div', 'res-wl-main', `勝ち${e.wins}回・負け${e.losses}回（勝率${rate}%）`), h('div', 'res-wl-note', e.isBinary ? '引き分け（同値）は返金で，勝ちにも負けにも数えません' : 'ロスカットはまとめて1敗と数えます'));
    card.append(wl);

    // 自己ベスト
    if (this.upd) {
      const { prev, now } = this.upd;
      const b = h('div', 'res-best');
      if (prev) {
        b.append(h('div', '', `この設定の前回ベスト ${yen(prev.bestBalance)}円 → 今回 ${yen(e.balance)}円`));
        if (newBest) b.append(h('div', 'res-best-hit', `最高残高 ${yen(now.bestBalance)}円・最大連勝 ${now.bestStreak}`));
      } else {
        b.append(h('div', '', 'この設定ははじめて！ 今回が最初の記録です'));
      }
      card.append(b);
    }

    const grid = h('div', 'res-grid');
    const cell = (l: string, v: string) => {
      const c = h('div', 'res-cell');
      c.append(h('div', 'stat-label', l), h('div', 'res-cell-val', v));
      grid.append(c);
    };
    cell('引き分け', String(e.draws));
    cell('最大連勝', String(e.maxWinStreak));
    if (e.isBinary) cell(e.rule === 'martingale' ? '最大の賭け金' : '払い戻し', e.rule === 'martingale' ? yen(e.maxStake) + '円' : `${e.payout}倍`);
    else cell('ロスカット', e.losscuts + '回');
    cell('発注数', String(e.shots));
    card.append(grid);

    card.append(this.reviewCard());

    const cv = h('canvas', 'res-chart');
    card.append(h('div', 'res-label', '資産のうつりかわり'), cv);

    if (this.r.secret) {
      const sec = h('div', 'secret-reveal');
      sec.append(h('div', 'secret-q', 'どのモードだったと思う？'));
      const ans = h('div', 'secret-ans', '');
      const row = h('div', 'guess-row');
      for (const id of SECRET_POOL) {
        const m = modeDef(id);
        const b = h('button', 'chip guess-btn');
        b.type = 'button';
        b.append(h('span', 'chip-label', `${m.icon} ${m.name}`));
        b.onclick = () => {
          sfx.click('up');
          log.secretGuess = id;
          row.remove();
          sec.querySelector('.secret-q')!.textContent = `あなたの予想：${m.icon} ${m.name}　正体は…`;
          void this.reveal(ans, id);
        };
        row.append(b);
      }
      sec.append(row, ans);
      card.append(sec);
    }

    const note = h('div', 'edu');
    note.append(h('span', 'edu-tag', '💡 ひとこと'), h('span', '', educationalNote(this.r)));
    card.append(note);

    const btns = h('div', 'res-btns');
    const retry = h('button', 'big-btn pink', 'もう一回！（同じ設定）');
    retry.type = 'button';
    retry.onclick = () => {
      sfx.click('up');
      this.onRetry();
    };
    const lvRow = h('div', 'lev-retry');
    lvRow.append(h('span', 'lev-retry-label', '倍率を変えて再挑戦：'));
    for (const lv of [25, 100, 1000]) {
      if (lv === cfg.leverage) continue;
      const c = h('button', 'chip' + (lv >= 500 ? ' danger' : ''), `${lv}倍`);
      c.type = 'button';
      c.onclick = () => {
        sfx.click('up');
        this.onRetryLev(lv);
      };
      lvRow.append(c);
    }
    const copy = h('button', 'big-btn ghost', '結果をコピー');
    copy.type = 'button';
    const copyOut = h('textarea', 'copy-out');
    copyOut.readOnly = true;
    copyOut.hidden = true;
    copy.onclick = () => {
      sfx.click('up');
      const t = copyText(this.r);
      const fallback = () => {
        copyOut.value = t;
        copyOut.hidden = false;
        copyOut.focus();
        copyOut.select();
      };
      try {
        navigator.clipboard.writeText(t).then(() => (copy.textContent = 'コピーしました！'), fallback);
      } catch {
        fallback();
      }
    };
    const back = h('button', 'big-btn ghost', '設定にもどる');
    back.type = 'button';
    back.onclick = () => {
      sfx.click('down');
      this.onTitle();
    };
    const ruleRow = h('div', 'lev-retry');
    ruleRow.append(h('span', 'lev-retry-label', 'ほかのルールで遊ぶ：'));
    for (const rl of ['fx', 'binary', 'martingale'] as Rule[]) {
      if (rl === e.rule) continue;
      const c = h('button', 'chip', RULE_NAMES[rl]);
      c.type = 'button';
      c.onclick = () => {
        sfx.click('up');
        this.onRetryRule(rl);
      };
      ruleRow.append(c);
    }
    btns.append(retry);
    if (!e.isBinary) btns.append(lvRow);
    btns.append(ruleRow, copy, copyOut, back);
    card.append(btns);
    this.root.append(card, this.popHost);

    this.drawChart(cv);
    window.addEventListener('resize', this.onResize);
    this.countUp(balVal, final);

    if (plus || newBest) {
      if (plus) sfx.reach();
      if (!calm) {
        this.particles = new Particles(this.root);
        this.particles.confettiRain(180);
        this.timers.push(window.setTimeout(() => this.particles?.confettiBurst(window.innerWidth / 2, window.innerHeight * 0.3, 120), 400));
        if (plus) this.timers.push(window.setTimeout(() => this.particles?.coinFountain(window.innerWidth / 2, window.innerHeight, 40), 700));
      }
    }

    if (this.upd?.unlocked.length) {
      const list = this.upd.unlocked;
      this.timers.push(window.setTimeout(() => this.enqueue(list), 1600));
    }
  }

  /** 今回の振り返りカード */
  private reviewCard(): HTMLElement {
    const { engine: e, cfg, log } = this.r;
    const pnl = e.realized;
    const box = h('div', 'review');
    box.append(h('div', 'review-title', '🔍 今回の振り返り'));
    const li = (t: string, cls = '') => box.append(h('div', 'review-item ' + cls, t));
    if (e.isBinary) {
      const winSum = log.settles.filter((v) => v > 0).reduce((a, b) => a + b, 0);
      const k = e.payout - 1;
      li(`もし払い戻しがちょうど2倍（胴元の取り分なし）なら，損益は約${yen(pnl + (winSum / k) * (2 - e.payout), true)}円`);
      const total = e.wins + e.losses;
      li(`トントンに必要な勝率：${(100 / e.payout).toFixed(1)}%（1÷${e.payout}）／今回の勝率：${total ? Math.round((e.wins / total) * 100) : 0}%`);
      if (e.rule === 'martingale') {
        li(`最大の賭け金：${yen(e.maxStake)}円（倍賭け${Math.round(Math.log2(log.maxStakeMult))}段）`, 'hl');
        li('払い戻し1.85倍のハイローは，勝率54%以上でないと平均でお金が減ります．数秒後の上下はほぼ五分五分なので，続けるほど減っていきます');
      }
    } else li(`今回のコスト（スプレッド＝売値と買値の差）：${yen(log.spreadCost)}円`);
    if (e.wins > e.losses && pnl < 0) li('勝った回数は多いのにお金は減った！ 負けた時の額が大きかったから', 'hl');
    else if (e.losses > e.wins && pnl > 0) li('負けた回数は多いのにプラス！ 1回の勝ちが大きかった', 'hl');
    if (!e.isBinary && cfg.leverage !== 25) li(`もし日本の上限の25倍だったら，損益は約${yen((pnl * 25) / cfg.leverage, true)}円（ロスカットが無かったとして）`);
    if (log.biggestWin > 0) li(`最大の勝ち：${yen(log.biggestWin, true)}円`);
    if (log.biggestLoss < 0) li(`最大の負け：${yen(log.biggestLoss, true)}円`);
    if (e.zeroCutTotal > 0) li(`ゼロカット：${yen(e.zeroCutTotal)}円分は0円で止まりました`, 'hl');
    if (e.isBinary) box.append(h('div', 'review-note', '日本の登録業者の個人向けバイナリーオプションは，判定まで2時間以上などのルールで規制されています'));
    return box;
  }

  private enqueue(list: Achievement[]) {
    this.popQueue.push(...list);
    if (!this.popping) void this.popLoop();
  }

  private async popLoop() {
    this.popping = true;
    while (this.alive && this.popQueue.length) {
      const a = this.popQueue.shift()!;
      const el = h('div', 'ach-pop');
      el.append(h('div', 'ach-pop-tag', '🏆 実績解除!!'), h('div', 'ach-pop-icon', a.icon), h('div', 'ach-pop-name', a.name), h('div', 'ach-pop-desc', a.desc));
      this.popHost.append(el);
      sfx.settleWin(1);
      if (this.settings.fx > 0 && this.particles) this.particles.confettiBurst(window.innerWidth / 2, window.innerHeight * 0.4, 50);
      await sleep(2300);
      el.remove();
    }
    this.popping = false;
  }

  private cv?: HTMLCanvasElement;
  private onResize = () => {
    if (this.cv) this.drawChart(this.cv);
  };

  private countUp(el: HTMLElement, to: number) {
    const from = 0;
    const t0 = performance.now();
    const dur = 1400;
    const f = (now: number) => {
      if (!this.alive) return;
      const k = Math.min(1, (now - t0) / dur);
      const ease = 1 - Math.pow(1 - k, 3);
      el.textContent = '¥' + yen(from + (to - from) * ease);
      if (k < 1) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  }

  private async reveal(ans: HTMLElement, guess: ModeId) {
    const real = modeDef(this.r.cfg.mode.id);
    ans.textContent = '？？？';
    ans.classList.add('drum');
    for (let i = 0; i < 14 && this.alive; i++) {
      sfx.tick();
      ans.textContent = MODES[2 + (i % 6)].icon + ' ？？？';
      await sleep(110);
    }
    if (!this.alive) return;
    ans.classList.remove('drum');
    const ok = guess === real.id;
    ans.textContent = `${real.icon} ${real.name}`;
    ans.classList.add('pop');
    sfx.reach();
    const verdict = h('div', 'guess-verdict ' + (ok ? 'ok' : 'ng'), ok ? '🎉 正解!! 名探偵！' : '😢 ざんねん，ハズレ！');
    ans.after(verdict);
    if (ok) {
      const got = recheckAchievements(this.ctx(true));
      if (got.length) this.enqueue(got);
    }
  }

  private drawChart(cv: HTMLCanvasElement) {
    this.cv = cv;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = cv.getBoundingClientRect();
    const w = Math.max(10, Math.round(r.width));
    const hh = Math.max(10, Math.round(r.height));
    cv.width = w * dpr;
    cv.height = hh * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const hist = this.r.engine.equityHist;
    const init = this.r.cfg.initialCash;
    if (hist.length < 2) return;
    let mn = init;
    let mx = init;
    for (const p of hist) {
      mn = Math.min(mn, p.eq);
      mx = Math.max(mx, p.eq);
    }
    const pad = Math.max(1000, (mx - mn) * 0.1);
    mn -= pad;
    mx += pad;
    const t1 = hist[hist.length - 1].t || 1;
    const X = (t: number) => 6 + (t / t1) * (w - 12);
    const Y = (v: number) => hh - 6 - ((v - mn) / (mx - mn)) * (hh - 12);
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, Y(init));
    ctx.lineTo(w, Y(init));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('初期資金', 8, Y(init) - 5);
    const up = this.r.engine.realized >= 0;
    const col = up ? '#ffd23f' : '#2f8bff';
    ctx.beginPath();
    hist.forEach((p, i) => (i ? ctx.lineTo(X(p.t), Y(p.eq)) : ctx.moveTo(X(p.t), Y(p.eq))));
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.shadowColor = col;
    ctx.shadowBlur = 10;
    ctx.stroke();
  }

  private startRain(cv: HTMLCanvasElement) {
    const ctx = cv.getContext('2d')!;
    const drops = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), v: 0.6 + Math.random() * 0.8, l: 10 + Math.random() * 18 }));
    const f = () => {
      if (!this.alive) return;
      this.raf = requestAnimationFrame(f);
      const w = (cv.width = window.innerWidth);
      const hh = (cv.height = window.innerHeight);
      ctx.strokeStyle = 'rgba(120,170,255,0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const d of drops) {
        d.y += d.v * 0.012;
        if (d.y > 1.05) {
          d.y = -0.05;
          d.x = Math.random();
        }
        ctx.moveTo(d.x * w, d.y * hh);
        ctx.lineTo(d.x * w - 3, d.y * hh + d.l);
      }
      ctx.stroke();
    };
    f();
  }

  dispose() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    this.timers.forEach((t) => window.clearTimeout(t));
    window.removeEventListener('resize', this.onResize);
    this.particles?.dispose();
    this.root.remove();
  }
}
