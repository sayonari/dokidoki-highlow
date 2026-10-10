import { MODES } from '../engine/modes';
import type { ModeId } from '../engine/modes';
import { sfx } from '../audio/sfx';
import { HAS_REPLAY, REPLAY } from '../market/replayData';
import { saveSettings } from './settings';
import type { FxLevel, Settings } from './settings';
import { ACHIEVEMENTS, loadRecords } from './records';
import { h, yen } from './util';

export { REPLAY };

const SYNTH: ModeId[] = ['realistic', 'random', 'loseish', 'mustlose', 'winish', 'mustwin', 'secret'];

interface Opt<T> {
  v: T;
  label: string;
  badge?: string;
  danger?: boolean;
}

export class TitleScreen {
  private root: HTMLElement;
  private bg: HTMLCanvasElement;
  private raf = 0;
  private alive = true;
  private refreshers: (() => void)[] = [];

  constructor(
    parent: HTMLElement,
    private readonly s: Settings,
    private readonly onStart: (s: Settings) => void,
    notice?: string,
  ) {
    this.root = h('div', 'screen title');
    this.bg = h('canvas', 'title-bg');
    this.root.append(this.bg);
    const inner = h('div', 'title-inner');
    this.root.append(inner);
    parent.appendChild(this.root);
    this.build(inner, notice);
    this.startBg();
    this.refresh();
  }

  private refresh() {
    saveSettings(this.s);
    for (const f of this.refreshers) f();
  }

  private section(parent: HTMLElement, title: string, show?: () => boolean): HTMLElement {
    const sec = h('section', 'set');
    sec.append(h('h3', '', title));
    parent.append(sec);
    if (show) this.refreshers.push(() => sec.classList.toggle('hidden', !show()));
    return sec;
  }

  private chips<K extends keyof Settings>(sec: HTMLElement, key: K, opts: Opt<Settings[K]>[]) {
    const row = h('div', 'chips');
    const btns = opts.map((o) => {
      const b = h('button', 'chip' + (o.danger ? ' danger' : ''));
      b.type = 'button';
      b.append(h('span', 'chip-label', o.label));
      if (o.badge) b.append(h('span', 'badge' + (o.danger ? ' danger' : ''), o.badge));
      b.onclick = () => {
        sfx.unlock();
        sfx.click('up');
        this.s[key] = o.v;
        this.refresh();
      };
      row.append(b);
      return b;
    });
    this.refreshers.push(() => btns.forEach((b, i) => b.setAttribute('aria-pressed', String(this.s[key] === opts[i].v))));
    sec.append(row);
  }

  private build(inner: HTMLElement, notice?: string) {
    const s = this.s;
    const logo = h('div', 'logo');
    logo.append(h('div', 'logo-main', 'ドキドキFX'), h('div', 'logo-sub', '〜爆益チャレンジ〜'));
    inner.append(logo);
    inner.append(h('p', 'lead', '上がる？ 下がる？ ボタンを連打して連勝をねらえ！（ゲームです．本物のお金は動きません）'));
    if (notice) inner.append(h('div', 'notice', notice));

    // スタートはタイトル直下：設定を触らなくてもすぐ遊べるように
    const start = h('button', 'start-btn');
    start.type = 'button';
    start.append(h('span', '', 'スタート！'));
    start.onclick = () => {
      sfx.unlock();
      sfx.click('up');
      this.refresh();
      this.onStart(s);
    };
    inner.append(start);
    const summary = h('p', 'start-summary', '');
    this.refreshers.push(() => {
      const m = MODES.find((x) => x.id === s.mode)!;
      summary.textContent = `いまの設定：${m.icon}${m.name}／${s.leverage}倍／1回${s.margin.toLocaleString('ja-JP')}円／${s.holdSec}秒で決済／${s.roundSec}秒`;
    });
    inner.append(summary);
    const recLine = this.recordLine();
    if (recLine) inner.append(recLine);
    inner.append(h('p', 'settings-hint', '▼ 設定を変えたいときは下へ'));

    // 相場モード
    const ms = this.section(inner, '相場モード');
    const grid = h('div', 'mode-grid');
    const modes = MODES.filter((m) => m.id !== 'replay' || HAS_REPLAY);
    const cards = modes.map((m) => {
      const c = h('button', 'mode-card');
      c.type = 'button';
      c.append(h('div', 'mode-icon', m.icon), h('div', 'mode-name', m.name), h('div', 'mode-desc', m.desc));
      if (m.id === 'live') c.append(h('div', 'badge weekday', '平日のみ'));
      c.onclick = () => {
        sfx.unlock();
        sfx.click('up');
        s.mode = m.id;
        this.refresh();
      };
      grid.append(c);
      return c;
    });
    this.refreshers.push(() => cards.forEach((c, i) => c.setAttribute('aria-pressed', String(s.mode === modes[i].id))));
    ms.append(grid);

    const lev = [1, 5, 10, 25, 100, 500, 1000];
    this.chips(
      this.section(inner, 'レバレッジ'),
      'leverage',
      lev.map((v) => ({ v, label: `${v}倍`, badge: v === 25 ? '日本の上限' : v >= 500 ? '海外業者風・超危険' : undefined, danger: v >= 500 })),
    );
    const det = h('details', 'more-settings');
    det.append(h('summary', '', '⚙ くわしい設定'));
    const more = h('div', 'more-body');
    det.append(more);
    inner.append(det);

    this.chips(this.section(more, '1発の証拠金'), 'margin', [5000, 10000, 30000].map((v) => ({ v, label: `${v.toLocaleString('ja-JP')}円` })));
    this.chips(this.section(more, '自動決済までの秒数'), 'holdSec', [3, 5, 10].map((v) => ({ v, label: `${v}秒` })));
    this.chips(this.section(more, 'ラウンド時間'), 'roundSec', [30, 60, 90, 180].map((v) => ({ v, label: `${v}秒`, badge: v === 30 ? '30秒チャレンジ' : undefined })));
    this.chips(
      this.section(more, 'ボラティリティ（値動きの激しさ）', () => SYNTH.includes(s.mode)),
      'vol',
      [{ v: 1, label: '1x', badge: '本物並み' }, { v: 5, label: '5x' }, { v: 20, label: '20x' }],
    );

    // 実データ再生
    const rs = this.section(more, '実データ：どの日にする？', () => s.mode === 'replay');
    const sel = h('select', 'select');
    sel.append(new Option('ランダム', 'random'));
    for (const se of REPLAY.sessions) sel.append(new Option(`${se.label}（値幅 ${se.range.toFixed(3)}円）`, se.id));
    sel.onchange = () => {
      s.session = sel.value;
      this.refresh();
    };
    this.refreshers.push(() => {
      if (!REPLAY.sessions.some((x) => x.id === s.session)) s.session = 'random';
      sel.value = s.session;
    });
    rs.append(sel);
    this.chips(this.section(more, '再生速度', () => s.mode === 'replay'), 'speed', [1, 5, 20].map((v) => ({ v, label: `${v}x` })));

    // 演出・音
    const lvOpts: Opt<FxLevel>[] = [{ v: 0, label: '控えめ' }, { v: 1, label: 'ふつう' }, { v: 2, label: 'ド派手' }];
    const fxSec = this.section(more, '演出');
    this.chips(fxSec, 'fx', lvOpts);
    fxSec.append(h('p', 'fx-note', '3連勝からカウント！5連勝で大当たり！（演出だけで，勝ちやすさは変わりません）'));
    const snd = this.section(more, 'サウンド');
    const sRow = h('div', 'chips');
    sRow.append(this.toggle('サウンド', 'sound', (v) => sfx.setEnabled(v)), this.toggle('ボイス', 'voice', (v) => sfx.setVoiceEnabled(v)));
    snd.append(sRow);
    sfx.setEnabled(s.sound);
    sfx.setVoiceEnabled(s.voice);

    inner.append(this.achievementBook());

    inner.append(h('p', 'foot', '初期資金は 100,000 円（ゲーム内のおもちゃのお金）'));
  }

  private recordLine(): HTMLElement | null {
    const rec = loadRecords();
    if (!rec.plays) return null;
    return h('p', 'rec-line', `🏅 最高残高 ${yen(rec.bestBalance)}円・最大連勝 ${rec.bestStreak}　（遊んだ回数 ${rec.plays}・大当たり ${rec.jackpots}回）`);
  }

  private achievementBook(): HTMLElement {
    const rec = loadRecords();
    const got = ACHIEVEMENTS.filter((a) => rec.ach[a.id]).length;
    const det = h('details', 'ach-book');
    det.append(h('summary', '', `🏆 達成帳 ${got}/${ACHIEVEMENTS.length}`));
    const list = h('div', 'ach-list');
    for (const a of ACHIEVEMENTS) {
      const on = !!rec.ach[a.id];
      const it = h('div', 'ach-item' + (on ? ' on' : ''));
      it.append(h('div', 'ach-icon', on ? a.icon : '❔'));
      const tx = h('div', 'ach-text');
      tx.append(h('div', 'ach-name', on ? a.name : '？？？'), h('div', 'ach-desc', on ? a.desc : `ヒント：${a.hint}`));
      it.append(tx);
      list.append(it);
    }
    det.append(list);
    return det;
  }

  private toggle(label: string, key: 'sound' | 'voice', apply: (v: boolean) => void): HTMLElement {
    const b = h('button', 'chip toggle');
    b.type = 'button';
    const st = h('span', 'chip-label', '');
    b.append(st);
    b.onclick = () => {
      sfx.unlock();
      this.s[key] = !this.s[key];
      apply(this.s[key]);
      if (this.s[key]) sfx.click('up');
      this.refresh();
    };
    this.refreshers.push(() => {
      st.textContent = `${label} ${this.s[key] ? 'ON' : 'OFF'}`;
      b.setAttribute('aria-pressed', String(this.s[key]));
    });
    return b;
  }

  /** 背景：うっすら流れる合成チャート */
  private startBg() {
    const cv = this.bg;
    const ctx = cv.getContext('2d')!;
    const N = 160;
    const ys: number[] = [0];
    for (let i = 1; i < N; i++) ys.push(ys[i - 1] + (Math.random() - 0.5));
    let phase = 0;
    let last = performance.now();
    const f = (now: number) => {
      if (!this.alive) return;
      this.raf = requestAnimationFrame(f);
      const dt = Math.min(100, now - last);
      last = now;
      phase += dt / 140;
      while (phase >= 1) {
        phase -= 1;
        ys.shift();
        ys.push(ys[ys.length - 1] + (Math.random() - 0.5) * 1.1);
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = window.innerWidth;
      const hh = window.innerHeight;
      if (cv.width !== Math.round(w * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(hh * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, hh);
      const mn = Math.min(...ys);
      const mx = Math.max(...ys);
      ctx.beginPath();
      ys.forEach((y, i) => {
        const X = ((i - phase) / (N - 1)) * w;
        const Y = hh * 0.8 - ((y - mn) / (mx - mn || 1)) * hh * 0.6;
        i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
      });
      ctx.strokeStyle = 'rgba(47,230,255,0.22)';
      ctx.lineWidth = 4;
      ctx.shadowColor = '#2fe6ff';
      ctx.shadowBlur = 16;
      ctx.stroke();
    };
    this.raf = requestAnimationFrame(f);
  }

  dispose() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    this.root.remove();
  }
}
