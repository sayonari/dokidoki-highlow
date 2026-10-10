import { newRoundLog, type RoundLog } from './roundlog';
import type { Dir, Engine, EngineEvent, GameConfig, Position } from '../engine/engine';
import type { PriceSource } from '../market/types';
import { TICK_MS } from '../market/types';
import { sfx } from '../audio/sfx';
import { Effects } from '../fx/effects';
import { Chart } from './chart';
import { saveSettings, type FxLevel, type Settings } from './settings';
import { bigYen, clamp, h, sleep, yen } from './util';

export interface GameResult {
  engine: Engine;
  cfg: GameConfig;
  secret: boolean; // ヒミツモードで遊んだか
  log: RoundLog; // 振り返り用の記録（ui/roundlog.ts）
}

export interface GameOpts {
  settings: Settings;
  cfg: GameConfig;
  engine: Engine;
  source: PriceSource;
  secret: boolean;
  onFinish: (r: GameResult) => void;
  /** プレイ中に「やめる」が確定したとき（log.aborted=true のうえで呼ぶ） */
  onAbort?: () => void;
}

const TUTORIAL_KEY = 'dfx_tutorial_done';
const FX_NAMES = ['控えめ', 'ふつう', 'ド派手'];

/** 大当たりの連勝数 */
const JACKPOT_STREAK = 5;
/** 超大当たり：10連勝，以降5連勝ごと */
function isSuperStreak(n: number): boolean {
  return n >= 10 && n % 5 === 0;
}

export class Game {
  private readonly root: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly fxLayer: HTMLElement;
  private readonly fx: Effects;
  private readonly chart: Chart;
  private readonly e: Engine;
  private readonly cfg: GameConfig;

  private raf = 0;
  private lastNow = 0;
  private acc = 0;
  private running = false; // engine を進めているか
  private active = false; // 入力を受け付けているか
  private alive = true;
  private fever = false;
  private curWin = 0; // 直前までの連勝数（連勝ストップの表示用）
  private dispEq: number;
  private lastTickSec = -1;
  private cache = new Map<string, string>();
  private readonly log: RoundLog = newRoundLog();
  private ended = false; // 終了または中断が確定した
  private stepping = false;
  private stall: 'wait' | 'closed' | null = null;
  private stallEl: HTMLElement | null = null;
  private modalEl: HTMLElement | null = null;
  private lastZero = 0;
  private spurted = false;
  private pw: { start: number; n: number; sum: number; els: HTMLElement[]; batch: { el: HTMLElement; update: (c: number, t: number) => void } | null } = {
    start: -1e9, n: 0, sum: 0, els: [], batch: null,
  };
  // 初回ガイド（0=無効 1〜3=段階）
  private tutStep = 0;
  private tutEl: HTMLElement | null = null;
  private tutTimer = 0;
  private btnSound!: HTMLButtonElement;
  private btnFx!: HTMLButtonElement;
  private btnsBox!: HTMLElement;
  private wrapBox!: HTMLElement;
  private cans = new Map<Dir, HTMLElement>();

  // HUD 要素
  private elEq!: HTMLElement;
  private elUsed!: HTMLElement;
  private elReal!: HTMLElement;
  private elWins!: HTMLElement;
  private elLoses!: HTMLElement;
  private elMeter!: HTMLElement;
  private dots: HTMLElement[] = [];
  private elFever!: HTMLElement;
  private elTime!: HTMLElement;
  private elBar!: HTMLElement;
  private elBarText!: HTMLElement;
  private mbar!: HTMLElement;
  private btnUp!: HTMLButtonElement;
  private btnDown!: HTMLButtonElement;
  private badges = new Map<Dir, HTMLElement>();
  private shorts = new Map<Dir, HTMLElement>();
  private canvas!: HTMLCanvasElement;

  constructor(parent: HTMLElement, private readonly o: GameOpts) {
    this.e = o.engine;
    this.cfg = o.cfg;
    this.dispEq = this.cfg.initialCash;
    this.root = h('div', 'game-root');
    this.stage = h('div', 'play');
    this.fxLayer = h('div', 'fx-layer');
    this.root.append(this.stage, this.fxLayer);
    parent.appendChild(this.root);
    this.build();
    this.applyCalm();
    this.fx = new Effects(this.fxLayer, this.stage, () => this.o.settings.fx);
    this.chart = new Chart(this.canvas);
    this.chart.push(0, this.e.mid);
    window.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onVis);
    this.lastNow = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    void this.countdown();
  }

  // ---------- 構築 ----------

  private stat(label: string, cls = ''): { box: HTMLElement; val: HTMLElement } {
    const box = h('div', 'stat ' + cls);
    const val = h('div', 'stat-val', '-');
    box.append(h('div', 'stat-label', label), val);
    return { box, val };
  }

  private build() {
    const tools = h('div', 'tools');
    this.btnSound = this.toolBtn('', '音のON/OFF', () => this.toggleSound());
    this.btnFx = this.toolBtn('', '演出の強さ（控えめ→ふつう→ド派手）', () => this.cycleFx());
    tools.append(this.btnSound, this.btnFx, this.toolBtn('✖', 'やめる', () => this.askQuit()));
    this.refreshTools();
    const hud = h('div', 'hud');
    const eqBox = h('div', 'eq-box');
    this.elEq = h('div', 'eq-val', '');
    const lab = h('div', 'eq-label');
    lab.append('いまのお金 ', h('span', 'eq-sub', '（有効証拠金）'));
    eqBox.append(lab, this.elEq);
    const timeBox = h('div', 'time-box');
    this.elTime = h('div', 'time-val', '');
    timeBox.append(h('div', 'eq-label', '残り時間'), this.elTime);
    hud.append(eqBox, timeBox);

    const stats = h('div', 'stats');
    const used = this.stat('かけているお金');
    const real = this.stat('確定したもうけ');
    const win = this.stat('勝ち');
    const lose = this.stat('負け');
    this.elUsed = used.val;
    this.elReal = real.val;
    this.elWins = win.val;
    this.elLoses = lose.val;
    stats.append(used.box, real.box, win.box, lose.box);

    // 連勝メーター
    this.elMeter = h('div', 'meter');
    this.elMeter.append(h('span', 'meter-label', '大当たりまで'));
    const dots = h('div', 'meter-dots');
    for (let i = 0; i < JACKPOT_STREAK; i++) {
      const d = h('span', 'meter-dot');
      this.dots.push(d);
      dots.append(d);
    }
    this.elMeter.append(dots);
    this.elFever = h('div', 'meter-fever hidden');
    this.elMeter.append(this.elFever);
    const md = h('span', 'meter-mode', this.o.secret ? '🎁 ？？？' : `${this.cfg.mode.icon} ${this.cfg.mode.name}`);
    this.elMeter.append(md);

    this.mbar = h('div', 'mbar');
    const track = h('div', 'mbar-track');
    this.elBar = h('div', 'mbar-fill');
    track.append(this.elBar);
    this.elBarText = h('div', 'mbar-text', '');
    this.mbar.append(h('div', 'mbar-label', 'ロスカットまでの余裕'), track, this.elBarText);

    const wrap = h('div', 'chart-wrap');
    this.canvas = h('canvas', 'chart');
    wrap.append(this.canvas);

    const btns = h('div', 'btns');
    this.btnUp = this.makeBtn(1);
    this.btnDown = this.makeBtn(-1);
    btns.append(this.btnUp, this.btnDown);

    this.btnsBox = btns;
    this.wrapBox = wrap;
    this.stage.append(tools, hud, stats, this.elMeter, this.mbar, wrap, btns);
    this.stage.addEventListener('contextmenu', (ev) => ev.preventDefault());
  }

  private makeBtn(dir: Dir): HTMLButtonElement {
    const b = h('button', 'btn ' + (dir > 0 ? 'up' : 'down'));
    b.type = 'button';
    const head = h('span', 'btn-head');
    head.append(h('span', 'btn-arrow', dir > 0 ? '▲' : '▼'), h('span', 'btn-text', dir > 0 ? '上がる' : '下がる'));
    const lev = this.cfg.leverage;
    const note = `×${lev}倍＝約${bigYen(this.cfg.marginPerShot * lev)}分の取引`;
    const badge = h('span', 'btn-badge hidden');
    const short = h('span', 'btn-short hidden', 'お金が足りない');
    const can = h('span', 'btn-can hidden');
    this.cans.set(dir, can);
    this.badges.set(dir, badge);
    this.shorts.set(dir, short);
    b.append(head, h('span', 'btn-bet', `1回 ${yen(this.cfg.marginPerShot)}円`), can, h('span', 'btn-note', note), badge, short);
    b.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      this.ripple(b, ev.clientX, ev.clientY);
      this.trade(dir);
    });
    b.addEventListener('dragstart', (ev) => ev.preventDefault());
    // キーボード（Tab で選んで Enter / Space）由来の click は detail===0．マウス・タッチ由来は pointerdown で処理済み
    b.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (ev.detail === 0) this.trade(dir);
    });
    return b;
  }

  private ripple(b: HTMLElement, cx: number, cy: number) {
    const r = b.getBoundingClientRect();
    const s = h('span', 'ripple');
    s.style.left = cx - r.left + 'px';
    s.style.top = cy - r.top + 'px';
    b.appendChild(s);
    window.setTimeout(() => s.remove(), 550);
  }

  private toolBtn(text: string, title: string, fn: () => void): HTMLButtonElement {
    const b = h('button', 'tool-btn', text);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', (ev) => {
      ev.preventDefault();
      fn();
    });
    return b;
  }

  private refreshTools() {
    this.btnSound.textContent = this.o.settings.sound ? '🔊' : '🔇';
    this.btnFx.textContent = '✨' + FX_NAMES[this.o.settings.fx];
  }

  private applyCalm() {
    const calm = this.o.settings.fx < 1;
    this.stage.classList.toggle('fx-calm', calm);
    this.root.classList.toggle('calm', calm);
  }

  private toggleSound() {
    const st = this.o.settings;
    st.sound = !st.sound;
    sfx.setEnabled(st.sound);
    if (st.sound) {
      sfx.unlock();
      if (this.running) sfx.bgmStart(this.fever ? 'kakuhen' : 'normal');
    }
    saveSettings(st);
    this.refreshTools();
  }

  private cycleFx() {
    const st = this.o.settings;
    st.fx = ((st.fx + 1) % 3) as FxLevel;
    saveSettings(st);
    this.applyCalm();
    this.refreshTools();
    this.fx.fever(this.fever);
    this.fx.toast(`演出：${FX_NAMES[st.fx]}`, 'fxlv', 0);
  }

  private askQuit() {
    if (this.modalEl || this.ended) return;
    const m = h('div', 'modal');
    const box = h('div', 'modal-box');
    const row = h('div', 'modal-btns');
    const no = h('button', 'big-btn ghost', 'いいえ');
    const yes = h('button', 'big-btn pink', 'はい');
    no.type = yes.type = 'button';
    no.addEventListener('click', () => this.closeModal());
    yes.addEventListener('click', () => this.abort());
    row.append(no, yes);
    box.append(h('div', 'modal-title', 'やめますか？'), h('div', '', '（このラウンドは記録されません）'), row);
    m.append(box);
    this.root.appendChild(m);
    this.modalEl = m;
    no.focus();
  }

  private closeModal() {
    this.modalEl?.remove();
    this.modalEl = null;
  }

  private abort() {
    if (this.ended) return;
    this.ended = true;
    this.log.aborted = true;
    this.active = false;
    this.running = false;
    this.closeModal();
    this.o.onAbort?.();
  }

  private vib(p: number | number[]) {
    if (this.o.settings.fx < 1) return;
    try {
      if (typeof navigator.vibrate === 'function') navigator.vibrate(p);
    } catch {
      /* 非対応は無視 */
    }
  }

  // ---------- 初回ガイド ----------

  private tutStart() {
    try {
      if (localStorage.getItem(TUTORIAL_KEY)) return;
    } catch {
      return;
    }
    this.tutShow(1, '上がると思ったら ▲，下がると思ったら ▼ を押そう！');
  }

  private tutShow(step: number, text: string) {
    this.tutStep = step;
    this.tutEl?.remove();
    const t = h('div', 'tut', text);
    this.root.appendChild(t);
    this.tutEl = t;
    this.placeTut();
  }

  private placeTut() {
    const t = this.tutEl;
    if (!t) return;
    if (this.tutStep === 2) {
      const r = this.wrapBox.getBoundingClientRect();
      t.style.left = r.left + r.width / 2 + 'px';
      t.style.top = r.top + 24 + 'px';
      t.style.bottom = 'auto';
    } else {
      const r = this.btnsBox.getBoundingClientRect();
      t.style.left = r.left + r.width / 2 + 'px';
      t.style.bottom = window.innerHeight - r.top + 30 + 'px';
      t.style.top = 'auto';
    }
  }

  private tutAdvance(from: number) {
    if (this.tutStep !== from) return;
    if (from === 1) {
      this.tutShow(2, `${this.cfg.holdMs / 1000}秒たつと自動で決済されるよ．チャートの丸い時計を見てね`);
    } else if (from === 2) {
      this.tutShow(3, '勝つとお金が増える！何回でも押せるよ');
      this.tutTimer = window.setTimeout(() => {
        this.tutEl?.remove();
        this.tutEl = null;
        this.tutStep = 0;
        try {
          localStorage.setItem(TUTORIAL_KEY, '1');
        } catch {
          /* 保存できなくても続行 */
        }
      }, 3000);
    }
  }

  private onKey = (ev: KeyboardEvent) => {
    if (ev.repeat) return;
    const k = ev.key;
    let dir: Dir | 0 = 0;
    if (k === 'ArrowUp' || k === 'w' || k === 'W') dir = 1;
    else if (k === 'ArrowDown' || k === 's' || k === 'S') dir = -1;
    if (!dir) return;
    ev.preventDefault();
    const b = dir > 0 ? this.btnUp : this.btnDown;
    b.classList.add('pressed');
    window.setTimeout(() => b.classList.remove('pressed'), 120);
    const r = b.getBoundingClientRect();
    this.ripple(b, r.left + r.width / 2, r.top + r.height / 2);
    this.trade(dir);
  };

  private onVis = () => {
    this.lastNow = performance.now();
    this.acc = 0;
  };

  // ---------- 流れ ----------

  private async countdown() {
    const num = h('div', 'countdown');
    this.fxLayer.appendChild(num);
    const seq: [string, number][] = [['3', 3], ['2', 2], ['1', 1], ['スタート!', 0]];
    for (const [txt, n] of seq) {
      if (!this.alive || this.ended) return;
      num.textContent = txt;
      num.className = 'countdown' + (n === 0 ? ' go' : '');
      void num.offsetWidth;
      num.classList.add('zoom');
      sfx.countdown(n);
      if (n === 0 && !this.ended) {
        // 「スタート！」が出た瞬間から入力・時間進行を始める
        this.running = true;
        this.active = true;
        sfx.bgmStart('normal');
        this.tutStart();
      }
      await sleep(n === 0 ? 600 : 800);
    }
    num.remove();
  }

  private trade(dir: Dir) {
    if (!this.active || this.ended || this.modalEl || this.stall) return;
    const ev = this.e.open(dir);
    const btn = dir > 0 ? this.btnUp : this.btnDown;
    if (ev.k === 'open') {
      sfx.click(dir > 0 ? 'up' : 'down');
      const br = btn.getBoundingClientRect();
      const cr = this.canvas.getBoundingClientRect();
      const tip = this.chart.tip(this.e.mid);
      // 発注は支出ではなく「拘束」：決済で戻ってくる
      this.fx.chip(br.left + br.width / 2, br.top + 14, cr.left + tip.x, cr.top + tip.y, dir > 0, `取引中 ${bigYen(this.cfg.marginPerShot)}`);
      this.bump(this.elUsed);
      this.vib(10);
      if (dir > 0) this.log.taps.up++;
      else this.log.taps.down++;
      this.log.spreadCost += (ev.pos.units * ev.pos.entrySpread) / 2 / 1000;
      this.log.maxOpen = Math.max(this.log.maxOpen, this.e.positions.length);
      this.tutAdvance(1);
    } else if (ev.k === 'reject' && ev.reason === 'margin') {
      const w = this.waitSec();
      this.fx.toast(w > 0 ? `決済待ち… あと${w}秒` : 'お金が足りない！', 'margin', 1500, 'warn');
    }
  }

  /** 最も早い決済までの秒（建玉が無ければ 0） */
  private waitSec(): number {
    if (!this.e.positions.length) return 0;
    let d = Infinity;
    for (const p of this.e.positions) d = Math.min(d, p.dueT);
    return Math.max(1, Math.ceil((d - this.e.t) / 1000));
  }

  /** 数字がピョンと弾む */
  private bump(el: HTMLElement) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  /** 決済ポップアップ．300ms 以内に4件以上重なったら「＋4件 合計 …」にまとめる */
  private settlePopup(x: number, y: number, pnl: number) {
    const w = this.pw;
    const now = performance.now();
    if (now - w.start > 300) {
      w.start = now;
      w.n = 0;
      w.sum = 0;
      w.els = [];
      w.batch = null;
    }
    w.n++;
    w.sum += pnl;
    if (w.n <= 3) {
      w.els.push(this.fx.popup(x, y, pnl, this.cfg.marginPerShot));
    } else if (!w.batch) {
      this.fx.removePopups(w.els);
      w.els = [];
      w.batch = this.fx.batchPopup(x, y, w.n, w.sum);
    } else {
      w.batch.update(w.n, w.sum);
    }
  }

  /** prev = step 前の建玉（ロスカットで閉じた建玉のスプレッド計算用） */
  private handle(evs: EngineEvent[], prev: Position[]) {
    const m = this.cfg.marginPerShot;
    const cr = this.canvas.getBoundingClientRect();
    const log = this.log;
    const settled = new Set<number>();
    for (const ev of evs) {
      if (ev.k === 'settle') {
        settled.add(ev.pos.id);
        log.spreadCost += (ev.pos.units * this.e.spread) / 2 / 1000;
        log.settles.push(ev.pnl);
        log.biggestWin = Math.max(log.biggestWin, ev.pnl);
        log.biggestLoss = Math.min(log.biggestLoss, ev.pnl);
        this.tutAdvance(2);
        const tip = this.chart.tip(ev.exitMid);
        const x = cr.left + tip.x - 30;
        const y = cr.top + clamp(tip.y, 30, cr.height - 30) - 20;
        this.settlePopup(x, y, ev.pnl);
        const strength = Math.min(1, Math.abs(ev.pnl) / m);
        const big = Math.abs(ev.pnl) >= m * 0.5;
        if (ev.outcome === 'win') {
          sfx.settleWin(strength);
          const s = ev.streak;
          const hr = this.elEq.getBoundingClientRect();
          this.fx.coinsToHud(cr.left + tip.x, cr.top + tip.y, hr.left + hr.width / 2, hr.top + hr.height / 2);
          this.curWin = s;
          const celebrating = this.fx.isCelebrating(); // 大当たりの祝福中は格下の演出・ボイスを出さない
          if (s >= JACKPOT_STREAK && isSuperStreak(s)) {
            log.jackpots++;
            sfx.jackpot();
            sfx.coins(40);
            sfx.voice(`${s}連勝！超大当たり！`);
            this.fx.celebrate(`${s}連勝!!! 超大当たり!!`, 'すごすぎる！', true);
            this.vib([60, 40, 60, 40, 120]);
          } else if (s === JACKPOT_STREAK) {
            log.jackpots++;
            sfx.jackpot();
            sfx.coins(30);
            sfx.voice('5連勝！大当たり！');
            this.fx.celebrate('5連勝!!! 大当たり!!', 'フィーバー突入！', false);
            this.vib([60, 40, 60, 40, 120]);
          } else {
            this.vib(20);
            if (!celebrating) {
              if (big) {
                sfx.bakueki();
                this.fx.bakueki();
              }
              if (s === 3) {
                sfx.reach();
                sfx.voice('3連勝！あと2勝で大当たり！');
                this.fx.streakBand('3連勝!!!', 'あと2勝で大当たり！', 1);
              } else if (s === 4) {
                sfx.gekiatsu();
                sfx.voice('4連勝！大当たりまであと一歩！');
                this.fx.streakBand('4連勝!!!', '大当たりまであと一歩！', 2);
              } else if (s > JACKPOT_STREAK) {
                sfx.reach();
                sfx.voice(`${s}連勝！`);
                this.fx.streakBand(`${s}連勝!!!`, 'フィーバー中！', 1);
              }
            }
          }
          if (s >= JACKPOT_STREAK && !this.fever) this.setFever(true);
        } else if (ev.outcome === 'lose') {
          sfx.settleLose(strength);
          this.fx.fadeCelebration();
          this.fx.lose(big);
          // 割れる札には賭け金ではなく実際の損益を出す
          this.fx.chipBreak(cr.left + tip.x, cr.top + tip.y, `${yen(ev.pnl)}円`);
          this.streakStopped();
        }
      } else if (ev.k === 'losscut') {
        for (const p of prev) if (!settled.has(p.id)) log.spreadCost += (p.units * this.e.spread) / 2 / 1000;
        log.losscuts.push({ pnl: ev.pnl, count: ev.count });
        sfx.losscut();
        sfx.voice('ロスカット');
        this.fx.fadeCelebration();
        this.fx.losscut(`${ev.count}件を強制決済　合計 ${yen(ev.pnl)}円`);
        this.vib(200);
        this.streakStopped();
      }
    }
  }

  private streakStopped() {
    if (this.curWin >= 3) this.fx.toast(`連勝ストップ…（${this.curWin}連勝）`, 'stop', 1500, 'blue');
    this.curWin = 0;
    if (this.fever) this.setFever(false);
  }

  private setFever(on: boolean) {
    this.fever = on;
    this.fx.fever(on);
    sfx.bgmStart(on ? 'kakuhen' : 'normal');
  }

  private async finish() {
    if (this.ended) return;
    this.ended = true;
    this.active = false;
    this.running = false;
    this.log.zeroCut = this.e.zeroCutTotal;
    this.closeModal();
    const reason = this.e.endReason;
    if (reason === 'bankrupt') {
      // 破産ではなく「次の1回分が足りない」ことを伝える
      const broke = this.e.balance < this.cfg.marginPerShot * 0.05;
      this.fx.headline('終了…', 'sad', broke ? 'お金がなくなりました…' : `次の1回分（${bigYen(this.cfg.marginPerShot)}）のお金が足りないので終了`);
    } else {
      this.fx.headline('終了〜!!');
    }
    sfx.bgmStop();
    sfx.gameEnd(this.e.realized > 0);
    await sleep(reason === 'bankrupt' ? 2300 : 1500);
    if (!this.alive) return;
    this.o.onFinish({ engine: this.e, cfg: this.cfg, secret: this.o.secret, log: this.log });
  }

  /** ライブ相場の鮮度を見て，止める／再開する */
  private updateStall() {
    let want: 'wait' | 'closed' | null = null;
    if (this.running && !this.ended && this.o.source.kind === 'live') {
      const st = this.o.source.status();
      if (st === 'closed') want = 'closed';
      else if (st !== 'ok') want = 'wait';
    }
    if (want === this.stall) return;
    this.stall = want;
    this.stallEl?.remove();
    this.stallEl = null;
    if (!want) return;
    const el = h('div', 'stall-overlay');
    if (want === 'wait') {
      el.append(h('div', '', '通信が止まっています．再接続中…'));
    } else {
      const b = h('button', 'big-btn pink', 'やめる');
      b.type = 'button';
      b.addEventListener('click', () => this.abort());
      el.append(h('div', '', '市場が閉まりました'), b);
    }
    this.root.appendChild(el);
  }

  // ---------- ループ・描画 ----------

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(250, now - this.lastNow);
    this.lastNow = now;
    this.updateStall();
    this.stepping = this.running && !document.hidden && !this.stall && !this.modalEl;
    if (this.stepping) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= TICK_MS && n < 10) {
        this.acc -= TICK_MS;
        n++;
        const prev = this.e.positions.slice();
        const ev = this.e.step();
        this.chart.push(this.e.t, this.e.mid);
        if (ev.length) this.handle(ev, prev);
        this.log.maxOpen = Math.max(this.log.maxOpen, this.e.positions.length);
        if (this.e.zeroCutTotal > this.lastZero + 0.5) {
          const d = this.e.zeroCutTotal - this.lastZero;
          this.lastZero = this.e.zeroCutTotal;
          this.fx.toast(`ゼロカット：マイナスになった${yen(d)}円分は0円で止めました（借金にはなりません）`, 'zerocut', 500, 'warn long', 4500);
        }
        if (this.e.finished) {
          void this.finish();
          break;
        }
      }
      if (this.acc > TICK_MS) this.acc = TICK_MS;
    } else if (this.running) {
      this.acc = 0;
    }
    this.render(now);
  };

  private setText(el: HTMLElement, key: string, v: string) {
    if (this.cache.get(key) !== v) {
      this.cache.set(key, v);
      el.textContent = v;
    }
  }

  private render(now: number) {
    const e = this.e;
    const tNow = e.t + (this.stepping ? this.acc : 0);
    this.chart.draw(e, tNow, now);

    // 有効証拠金のカウントアップ／ダウン
    const eq = e.equity();
    const diff = eq - this.dispEq;
    this.dispEq = Math.abs(diff) < 1 ? eq : this.dispEq + diff * 0.2;
    this.setText(this.elEq, 'eq', '¥' + yen(this.dispEq));
    const eqCls = diff > 1 ? 'up' : diff < -1 ? 'down' : '';
    this.elEq.dataset.dir = eqCls;
    this.elEq.classList.toggle('rich', eq >= this.cfg.initialCash);

    const used = e.usedMargin();
    this.setText(this.elUsed, 'used', yen(used) + '円');
    this.setText(this.elReal, 'real', yen(e.realized, true) + '円');
    this.elReal.classList.toggle('plus', e.realized > 0);
    this.elReal.classList.toggle('minus', e.realized < 0);
    this.setText(this.elWins, 'w', `${e.wins}回`);
    this.setText(this.elLoses, 'l', `${e.losses}回`);

    // 連勝メーター
    const st = Math.max(0, e.streak);
    const feverOn = st >= JACKPOT_STREAK;
    this.elMeter.classList.toggle('on', feverOn);
    this.elFever.classList.toggle('hidden', !feverOn);
    this.setText(this.elFever, 'fv', `🔥${st}連勝中 フィーバー！`);
    this.dots.forEach((d, i) => d.classList.toggle('lit', i < st));

    // ボタンのバッジ・「いま○回押せる」・待つ理由
    const accepting = e.acceptingOrders;
    const afford = e.canAfford();
    const can = accepting ? Math.floor((e.freeMargin() + 1e-6) / this.cfg.marginPerShot) : 0;
    let shortText = '';
    if (!accepting) shortText = '時間切れ・決済待ち';
    else if (!afford) shortText = e.positions.length ? `決済待ち… あと${this.waitSec()}秒` : 'お金が足りない';
    for (const dir of [1, -1] as Dir[]) {
      let n = 0;
      for (const p of e.positions) if (p.dir === dir) n++;
      const badge = this.badges.get(dir)!;
      badge.classList.toggle('hidden', n === 0);
      this.setText(badge, 'badge' + dir, `かけ中 ${n}回・${yen(n * this.cfg.marginPerShot)}円`);
      const short = this.shorts.get(dir)!;
      short.classList.toggle('hidden', !shortText);
      this.setText(short, 'short' + dir, shortText);
      const ce = this.cans.get(dir)!;
      ce.classList.toggle('hidden', can <= 0);
      this.setText(ce, 'can' + dir, `いま${can}回押せる`);
      const btn = dir > 0 ? this.btnUp : this.btnDown;
      btn.classList.toggle('broke', !!shortText);
      btn.setAttribute('aria-disabled', shortText ? 'true' : 'false');
    }
    if (this.tutEl) this.placeTut();

    const remainMs = Math.max(0, this.cfg.roundMs - e.t);
    const sec = Math.ceil(remainMs / 1000);
    this.setText(this.elTime, 'time', remainMs <= 0 ? '決済待ち' : String(sec));
    const warn = remainMs > 0 && sec <= 10;
    this.elTime.classList.toggle('warn', warn);
    this.elTime.classList.toggle('spurt', warn);
    if (warn && this.stepping && !this.spurted) {
      this.spurted = true;
      this.fx.spurt();
      if (!this.fx.isCelebrating()) sfx.voice('ラストスパート！');
    }
    if (warn && this.stepping && sec !== this.lastTickSec) {
      this.lastTickSec = sec;
      sfx.tick();
    }

    // ロスカットまでの余裕（維持率 50%→0，300%→満タン）
    if (used > 0) {
      const ratio = eq / used;
      const pct = ratio * 100;
      const fill = clamp((pct - 50) / (300 - 50), 0, 1);
      this.elBar.style.width = fill * 100 + '%';
      this.setText(this.elBarText, 'bar', ratio < 0.7 ? 'あぶない!!' : ratio < 1 ? 'あぶない' : '余裕あり');
      this.mbar.dataset.lv = ratio < 0.7 ? 'red' : ratio < 1 ? 'yellow' : 'ok';
    } else {
      this.elBar.style.width = '100%';
      this.setText(this.elBarText, 'bar', '余裕たっぷり');
      this.mbar.dataset.lv = 'ok';
    }
  }

  dispose() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.tutTimer);
    window.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVis);
    sfx.bgmStop();
    this.fx.dispose();
    this.o.source.dispose();
    this.root.remove();
  }
}
