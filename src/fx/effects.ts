import type { FxLevel } from '../ui/settings';
import { clamp, h, yen } from '../ui/util';
import { Particles } from './particles';

const MAX_POPUPS = 12;

/** 演出レイヤ（pointer-events:none の全画面オーバーレイ）の管理．強さ（控えめ/ふつう/ド派手）で出す演出を切り替える． */
export class Effects {
  readonly particles: Particles;
  private popups: HTMLElement[] = [];
  private timers = new Set<number>();
  private jackpotBusy = false;
  private toastAt = new Map<string, number>();
  private cracks: SVGSVGElement | null = null;
  private jpRoot: HTMLElement | null = null;
  private celebrateUntil = 0;

  constructor(
    private readonly layer: HTMLElement,
    private readonly stage: HTMLElement, // 揺らす／モノクロにする対象
    private readonly level: () => FxLevel,
  ) {
    this.particles = new Particles(layer);
  }

  private later(fn: () => void, ms: number) {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
  }

  private temp(el: HTMLElement, ms: number) {
    this.layer.appendChild(el);
    this.later(() => el.remove(), ms);
  }

  // ---------- 基本部品 ----------

  shake(px: number, ms = 450) {
    try {
      const k: Keyframe[] = [];
      for (let i = 0; i < 10; i++) {
        const f = 1 - i / 10;
        k.push({ transform: `translate(${(Math.random() - 0.5) * 2 * px * f}px, ${(Math.random() - 0.5) * 2 * px * f}px) rotate(${(Math.random() - 0.5) * 0.6 * f}deg)` });
      }
      k.push({ transform: 'none' });
      this.stage.animate(k, { duration: ms, easing: 'linear' });
    } catch {
      /* Web Animations 非対応は無視 */
    }
  }

  flash(color = '#fff', ms = 450, alpha = 0.9) {
    const f = h('div', 'fx-flash');
    f.style.background = color;
    f.style.setProperty('--a', String(alpha));
    f.style.animationDuration = ms + 'ms';
    this.temp(f, ms + 50);
  }

  /** 画面中央付近の小さな案内（控えめ演出・トースト用）．key ごとに間引く */
  toast(text: string, key = text, cooldown = 1200, cls = '', ms = 1600) {
    const now = performance.now();
    if (now - (this.toastAt.get(key) ?? -1e9) < cooldown) return;
    this.toastAt.set(key, now);
    const t = h('div', 'fx-toast ' + cls, text);
    if (ms !== 1600) t.style.animationDuration = ms - 100 + 'ms';
    this.temp(t, ms);
  }

  /** 大当たりの祝福中か（約3.5秒）．格下のボイス・帯を出さない判断に使う */
  isCelebrating(): boolean {
    return performance.now() < this.celebrateUntil;
  }

  /** 祝福中に負けたとき：祝福を早めにフェードアウトする */
  fadeCelebration() {
    this.celebrateUntil = 0;
    const root = this.jpRoot;
    if (!root) return;
    this.jpRoot = null;
    root.classList.add('out');
    this.later(() => {
      root.remove();
      this.jackpotBusy = false;
    }, 450);
  }

  /** ラストスパートの帯 */
  spurt() {
    if (this.level() < 1) return this.toast('ラストスパート!!', 'spurt', 3000, 'gold');
    this.temp(h('div', 'fx-spurt', 'ラストスパート!!'), 2000);
  }

  // ---------- 決済ポップアップ ----------

  popup(x: number, y: number, pnl: number, margin: number, bin = false): HTMLElement {
    const sub = `${yen(margin)}円 → ${yen(margin + pnl)}円`;
    const win = pnl > 0;
    const draw = bin && Math.abs(pnl) < 1e-9;
    const ratio = clamp(Math.abs(pnl) / margin, 0, 2);
    const size = win ? 22 + ratio * 30 : bin ? 26 + ratio * 8 : 18 + ratio * 14;
    const e = h('div', 'fx-pop ' + (win ? 'win' : draw ? 'draw' : bin ? 'lose bin' : 'lose'));
    const main = draw ? '引き分け（返金）' : win ? `${yen(pnl, true)}円!!` : bin ? `${yen(pnl)}円 没収!!` : `${yen(pnl)}円`;
    e.append(h('div', 'pop-main', main));
    if (!(bin && !win && !draw)) e.append(h('div', 'pop-sub', draw ? `${yen(margin)}円 そのまま戻る` : sub));
    e.style.left = clamp(x, 70, window.innerWidth - 70) + 'px';
    e.style.top = clamp(y, 40, window.innerHeight - 40) + 'px';
    e.style.setProperty('--s', size + 'px');
    this.layer.appendChild(e);
    this.popups.push(e);
    while (this.popups.length > MAX_POPUPS) this.popups.shift()!.remove();
    this.later(() => {
      e.remove();
      this.popups = this.popups.filter((p) => p !== e);
    }, 1500);
    if (win && this.level() >= 1) this.particles.sparks(x, y, 6 + Math.round(ratio * 10), '#ffd23f');
    return e;
  }

  /** ハイローのハズレ：コインがチャリンと散って消える＋軽い揺れ */
  coinScatter(x: number, y: number) {
    const lv = this.level();
    if (lv < 1) return;
    this.shake(lv >= 2 ? 6 : 3, 320);
    const n = lv >= 2 ? 7 : 4;
    for (let i = 0; i < n; i++) {
      if (this.layer.querySelectorAll('.fx-coin').length > 24) return;
      const c = h('div', 'fx-coin', '¥');
      c.style.left = x + 'px';
      c.style.top = y + 'px';
      this.layer.appendChild(c);
      const dx = (Math.random() - 0.5) * 220;
      const up = -(40 + Math.random() * 60);
      const down = 90 + Math.random() * 80;
      try {
        const a = c.animate(
          [
            { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
            { transform: `translate(calc(-50% + ${dx * 0.6}px), calc(-50% + ${up}px)) scale(1)`, opacity: 1, offset: 0.35 },
            { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${down}px)) scale(0.6) rotate(${dx}deg)`, opacity: 0 },
          ],
          { duration: 800 + i * 40, easing: 'ease-in' },
        );
        a.onfinish = () => c.remove();
      } catch {
        c.remove();
      }
    }
  }

  /** 短時間に決済が重なったときの小ポップアップ「＋4件 合計 +1,200円」．返した要素の textContent 更新で件数を増やせる */
  batchPopup(x: number, y: number, count: number, total: number): { el: HTMLElement; update: (count: number, total: number) => void } {
    const e = h('div', 'fx-pop batch ' + (total > 0 ? 'win' : 'lose'));
    const main = h('div', 'pop-main');
    e.append(main);
    const update = (c: number, t: number) => {
      main.textContent = `＋${c}件 合計 ${yen(t, true)}円`;
      e.classList.toggle('win', t > 0);
      e.classList.toggle('lose', t <= 0);
    };
    update(count, total);
    e.style.left = clamp(x, 90, window.innerWidth - 90) + 'px';
    e.style.top = clamp(y, 40, window.innerHeight - 40) + 'px';
    e.style.setProperty('--s', '20px');
    this.layer.appendChild(e);
    this.popups.push(e);
    this.later(() => {
      e.remove();
      this.popups = this.popups.filter((p) => p !== e);
    }, 1800);
    return { el: e, update };
  }

  removePopups(els: HTMLElement[]) {
    for (const e of els) e.remove();
    this.popups = this.popups.filter((p) => !els.includes(p));
  }

  /** ボタンからチャートの現在値へ飛ぶ「取引中 1万円」の札（支出ではなく拘束）．ボタン付近に小さなコインも散らす */
  chip(fromX: number, fromY: number, toX: number, toY: number, up: boolean, label: string) {
    const lv = this.level();
    if (this.layer.querySelectorAll('.fx-chip').length > (lv < 1 ? 6 : 10)) return;
    const c = h('div', 'fx-chip ' + (up ? 'up' : 'down'), label);
    c.style.left = fromX + 'px';
    c.style.top = fromY + 'px';
    this.layer.appendChild(c);
    if (lv >= 1) {
      this.particles.coinFountain(fromX, fromY, lv >= 2 ? 4 : 2, 0.4);
      this.particles.sparks(fromX, fromY, lv >= 2 ? 8 : 4, '#ffd23f');
    }
    try {
      const a = c.animate(
        [
          { transform: 'translate(-50%,-50%) scale(1.25)', opacity: 1 },
          { transform: `translate(calc(-50% + ${toX - fromX}px), calc(-50% + ${toY - fromY}px)) scale(0.7)`, opacity: 0.25 },
        ],
        { duration: 520, easing: 'cubic-bezier(.2,.7,.3,1)' },
      );
      a.onfinish = () => {
        c.remove();
        if (this.level() >= 1) this.particles.sparks(toX, toY, 5, up ? '#ff3b5c' : '#2f8bff');
      };
    } catch {
      c.remove();
    }
  }

  /** 勝ち：コインがチャートから「いまのお金」へ吸い込まれる */
  coinsToHud(fromX: number, fromY: number, toX: number, toY: number) {
    const lv = this.level();
    if (lv < 1) return;
    const n = lv >= 2 ? 6 : 3;
    for (let i = 0; i < n; i++) {
      if (this.layer.querySelectorAll('.fx-coin').length > 24) return;
      const c = h('div', 'fx-coin', '¥');
      c.style.left = fromX + (Math.random() - 0.5) * 30 + 'px';
      c.style.top = fromY + (Math.random() - 0.5) * 30 + 'px';
      this.layer.appendChild(c);
      const dx = toX - parseFloat(c.style.left);
      const dy = toY - parseFloat(c.style.top);
      try {
        const a = c.animate(
          [
            { transform: 'translate(-50%,-50%) scale(1.1)', opacity: 1 },
            { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.5)`, opacity: 0.4 },
          ],
          { duration: 650 + i * 70, delay: i * 60, easing: 'cubic-bezier(.5,0,.8,.4)', fill: 'backwards' },
        );
        a.onfinish = () => c.remove();
      } catch {
        c.remove();
      }
    }
    this.later(() => this.particles.sparks(toX, toY, 6, '#ffd23f'), 700);
  }

  /** 負け：チップが割れて散る */
  chipBreak(x: number, y: number, label: string) {
    if (this.level() < 1) return;
    if (this.layer.querySelectorAll('.fx-chipbreak').length > 6) return;
    const box = h('div', 'fx-chipbreak');
    box.style.left = x + 'px';
    box.style.top = y + 'px';
    box.append(h('span', 'cb-l', label), h('span', 'cb-r', label));
    this.temp(box, 900);
    this.particles.sparks(x, y, this.level() >= 2 ? 10 : 5, '#8fa3c4');
  }

  // ---------- 連勝演出 ----------

  /** 連勝の帯（3・4・6〜9連勝）．tier=1 小，2 大きく揺れる */
  streakBand(main: string, sub: string, tier: 1 | 2) {
    const lv = this.level();
    if (lv < 1) return this.toast(`${main} ${sub}`, 'streak', 800, 'gold');
    // 前の帯・大当たりの文字が残っていたら消してから出す（重なり防止）
    this.layer.querySelector('.fx-streak')?.remove();
    this.layer.querySelectorAll('.fx-jackpot .jp-text, .fx-jackpot .jp-sub').forEach((e) => e.remove());
    const b = h('div', 'fx-streak t' + tier);
    b.append(h('div', 'st-main', main), h('div', 'st-sub', sub));
    this.temp(b, 1900);
    if (lv >= 2) {
      this.flash(tier === 2 ? '#fff' : '#ffd23f', tier === 2 ? 350 : 300, tier === 2 ? 0.5 : 0.3);
      if (tier === 2) {
        this.shake(8, 400);
        this.particles.confettiBurst(window.innerWidth / 2, window.innerHeight * 0.45, 40);
      }
    }
  }

  /** フィーバー中：背景の虹色脈動と画面端の光 */
  fever(on: boolean) {
    this.stage.classList.toggle('fever', on && this.level() >= 1);
    this.stage.classList.toggle('fever-full', on && this.level() >= 2);
    const old = this.layer.querySelector('.fx-edge');
    if (on && this.level() >= 1) {
      if (!old) this.layer.appendChild(h('div', 'fx-edge'));
    } else old?.remove();
  }

  /** 全画面の祝福（5連勝の大当たり／10連勝ごとの超大当たり）．super=true でより派手 */
  celebrate(main: string, sub: string, isSuper: boolean) {
    const lv = this.level();
    this.celebrateUntil = performance.now() + 3500;
    if (lv < 1) return this.toast(main, 'jackpot', 1000, 'gold');
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (this.jackpotBusy) {
      this.particles.coinFountain(W / 2, H, 60, 1);
      return;
    }
    this.jackpotBusy = true;
    const root = h('div', 'fx-jackpot' + (isSuper ? ' super' : ''));
    // 「5連勝!!! 大当たり!!」は空白で2行に分け，単語の途中で折り返さないようにする
    const txt = h('div', 'jp-text', main.replace(' ', '\n'));
    root.append(h('div', 'jp-dim'), txt, h('div', 'jp-sub', sub));
    this.layer.appendChild(root);
    this.jpRoot = root;
    this.flash(isSuper ? '#fff' : '#fff6b0', 600, 1);
    const n = (lv >= 2 ? 22 : 8) * (isSuper ? 2 : 1);
    const bursts = isSuper ? 9 : 6;
    for (let k = 0; k < bursts; k++)
      this.later(() => this.particles.coinFountain(W / 2 + (k - (bursts - 1) / 2) * W * (isSuper ? 0.09 : 0.12), H + 10, n, 0.9 + Math.random() * 0.3), k * 170);
    this.particles.confettiRain((lv >= 2 ? 160 : 50) * (isSuper ? 2 : 1));
    this.particles.confettiBurst(W / 2, H * 0.45, lv >= 2 ? 80 : 30);
    if (lv >= 2) this.shake(isSuper ? 16 : 10, 600);
    this.later(() => {
      if (this.jpRoot === root) root.classList.add('out');
    }, 3300);
    this.later(() => {
      if (this.jpRoot !== root) return;
      root.remove();
      this.jpRoot = null;
      this.jackpotBusy = false;
    }, 3700);
  }

  bakueki() {
    const lv = this.level();
    if (lv < 1) return this.toast('爆益!!', 'bakueki', 800, 'gold');
    const t = h('div', 'fx-bakueki', '爆益');
    this.temp(t, 1600);
    this.later(() => this.shake(lv >= 2 ? 16 : 6, 500), 150);
    if (lv >= 2) {
      this.later(() => this.flash('#ffd23f', 400, 0.7), 150);
      this.later(() => this.particles.coinFountain(window.innerWidth / 2, window.innerHeight * 0.6, 50, 0.8), 150);
    }
  }

  // ---------- 負け ----------

  lose(big: boolean) {
    const lv = this.level();
    if (lv < 1) return;
    const e = h('div', 'fx-rededge');
    this.temp(e, 650);
    if (big) {
      this.shake(lv >= 2 ? 12 : 5, 450);
      this.temp(h('div', 'fx-gunu', 'ぐぬぬ…'), 1500);
    }
  }

  losscut(detail = '') {
    const lv = this.level();
    if (lv < 1) return this.toast(detail ? `ロスカット!! ${detail}` : 'ロスカット!!', 'losscut', 800, 'blue', 3000);
    this.stage.classList.add('mono');
    this.later(() => this.stage.classList.remove('mono'), lv >= 2 ? 1400 : 800);
    this.shake(lv >= 2 ? 18 : 8, 600);
    this.addCracks();
    const t = h('div', 'fx-losscut');
    t.append(h('div', 'lc-main', 'ロスカット!!'));
    if (detail) t.append(h('div', 'lc-sub', detail));
    this.temp(t, 2200);
    if (lv >= 2) this.flash('#fff', 200, 0.7);
  }

  private addCracks() {
    this.cracks?.remove();
    const W = window.innerWidth;
    const H = window.innerHeight;
    const cx = W * (0.3 + Math.random() * 0.4);
    const cy = H * (0.3 + Math.random() * 0.4);
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'fx-cracks');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const n = 14 + ((Math.random() * 6) | 0);
    for (let i = 0; i < n; i++) {
      let a = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      let x = cx;
      let y = cy;
      let d = `M${x.toFixed(0)},${y.toFixed(0)}`;
      const len = Math.max(W, H) * (0.35 + Math.random() * 0.5);
      let run = 0;
      while (run < len) {
        const s = 25 + Math.random() * 60;
        a += (Math.random() - 0.5) * 0.7;
        x += Math.cos(a) * s;
        y += Math.sin(a) * s;
        run += s;
        d += ` L${x.toFixed(0)},${y.toFixed(0)}`;
      }
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('style', `stroke-width:${(1 + Math.random() * 2.5).toFixed(1)}px;animation-delay:${(Math.random() * 0.12).toFixed(2)}s`);
      svg.appendChild(p);
    }
    this.layer.appendChild(svg);
    this.cracks = svg;
    this.later(() => svg.classList.add('out'), 1800);
    this.later(() => {
      svg.remove();
      if (this.cracks === svg) this.cracks = null;
    }, 2400);
  }

  /** 終了・破産などの大きな一言 */
  headline(text: string, cls = '', sub = '') {
    const e = h('div', 'fx-headline ' + cls);
    e.append(h('div', 'hl-main', text));
    if (sub) e.append(h('div', 'hl-sub', sub));
    if (sub) e.style.animationDuration = '2.6s';
    this.temp(e, sub ? 2700 : 1800);
  }

  dispose() {
    for (const id of this.timers) {
      window.clearTimeout(id);
      window.clearInterval(id);
    }
    this.timers.clear();
    this.stage.classList.remove('mono', 'fever', 'fever-full');
    this.particles.dispose();
    this.layer.replaceChildren();
  }
}
