import type { Engine, Position } from '../engine/engine';
import { bigYen, px, yen } from './util';

const WINDOW_MS = 30000;
const BUY = '#ff3b5c';
const SELL = '#2f8bff';
const GOLD = '#ffd23f';
/** 建玉を束ねる条件：表示上の距離 [px] と最小件数 */
const BUNDLE_PX = 14;
const BUNDLE_MIN = 3;

/** 直近30秒のチャート（Canvas 2D）．y 軸は滑らかに追従． */
export class Chart {
  private ts: number[] = [];
  private vs: number[] = [];
  private lo = 0;
  private hi = 0;
  private inited = false;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private ctx: CanvasRenderingContext2D;
  private padR = 120;
  private plotW = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  push(t: number, mid: number) {
    this.ts.push(t);
    this.vs.push(mid);
    // 古い点を間引く（ウィンドウ + 余白）
    if (this.ts.length > 800) {
      const cut = this.ts.findIndex((x) => x >= t - WINDOW_MS - 2000);
      if (cut > 0) {
        this.ts.splice(0, cut);
        this.vs.splice(0, cut);
      }
    }
  }

  private fit() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(10, Math.round(r.width));
    const h = Math.max(10, Math.round(r.height));
    if (w !== this.w || h !== this.h || dpr !== this.dpr) {
      this.w = w;
      this.h = h;
      this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.padR = w < 600 ? 112 : 150;
    this.plotW = w - this.padR;
  }

  private yOf(v: number): number {
    const top = 14;
    const bot = this.h - 14;
    return bot - ((v - this.lo) / (this.hi - this.lo)) * (bot - top);
  }

  /** 現在値の先端位置（canvas の CSS 座標） */
  tip(mid: number): { x: number; y: number } {
    return { x: this.plotW, y: this.lo === this.hi ? this.h / 2 : this.yOf(mid) };
  }
  priceY(v: number): number {
    return this.yOf(v);
  }

  /** 残り時間の円形プログレス（近い位置に既にあれば右へずらす） */
  private ring(ctx: CanvasRenderingContext2D, plotW: number, placed: number[], y: number, dir: number, frac: number, col: string, glow: boolean) {
    let col2 = 0;
    for (const py of placed) if (Math.abs(py - y) < 28) col2++;
    placed.push(y);
    const cx = plotW + 18 + Math.min(col2, 2) * 28;
    ctx.save();
    ctx.fillStyle = 'rgba(11,11,26,0.85)';
    ctx.beginPath();
    ctx.arc(cx, y, 12.5, 0, 6.283);
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.arc(cx, y, 10, 0, 6.283);
    ctx.stroke();
    ctx.strokeStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = glow ? 10 : 0;
    ctx.beginPath();
    ctx.arc(cx, y, 10, -Math.PI / 2, -Math.PI / 2 + frac * 6.283);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#fff';
    ctx.font = '800 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(dir > 0 ? '▲' : '▼', cx, y + 0.5);
  }

  draw(e: Engine, tNow: number, tick: number) {
    this.fit();
    const { ctx, w, h, dpr, plotW } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (this.ts.length < 1) return;

    // 表示範囲
    const t0 = tNow - WINDOW_MS;
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = 0; i < this.ts.length; i++) {
      if (this.ts[i] < t0) continue;
      mn = Math.min(mn, this.vs[i]);
      mx = Math.max(mx, this.vs[i]);
    }
    for (const p of e.positions) {
      mn = Math.min(mn, p.entryMid);
      mx = Math.max(mx, p.entryMid);
    }
    const span = Math.max(30, (mx - mn) * 1.3);
    const c = (mx + mn) / 2;
    const tl = c - span / 2;
    const th = c + span / 2;
    if (!this.inited) {
      this.lo = tl;
      this.hi = th;
      this.inited = true;
    } else {
      // 広がるときは速く，縮むときはゆっくり
      const kLo = tl < this.lo ? 0.25 : 0.04;
      const kHi = th > this.hi ? 0.25 : 0.04;
      this.lo += (tl - this.lo) * kLo;
      this.hi += (th - this.hi) * kHi;
    }
    const xOf = (t: number) => plotW - ((tNow - t) / WINDOW_MS) * plotW;

    // グリッド
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    const step = niceStep((this.hi - this.lo) / 4);
    for (let v = Math.ceil(this.lo / step) * step; v < this.hi; v += step) {
      const y = Math.round(this.yOf(v)) + 0.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.w, y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillText(px(v), this.w - 46, y - 8);
    }

    // 価格ライン
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < this.ts.length; i++) {
      if (this.ts[i] < t0 - 1000) continue;
      const x = xOf(this.ts[i]);
      const y = this.yOf(this.vs[i]);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else ctx.lineTo(x, y);
    }
    const yNow = this.yOf(e.mid);
    ctx.lineTo(plotW, yNow);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#2fe6ff';
    ctx.lineWidth = 3.5;
    ctx.shadowColor = '#2fe6ff';
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;
    // 面グラデ
    ctx.lineTo(plotW, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(47,230,255,0.18)');
    g.addColorStop(1, 'rgba(47,230,255,0)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();

    // 建玉
    const pulse = 0.5 + 0.5 * Math.sin(tick / 120);
    // 近い価格（表示上 BUNDLE_PX 以内）・同方向の建玉が3件以上重なるときは1つに束ねる
    const sorted = e.positions.map((p) => ({ p, y: this.yOf(p.entryMid) })).sort((a, b) => a.y - b.y);
    const groups: { p: Position; y: number }[][] = [];
    for (const dir of [1, -1]) {
      let cur: { p: Position; y: number }[] = [];
      for (const it of sorted) {
        if (it.p.dir !== dir) continue;
        if (cur.length && it.y - cur[0].y > BUNDLE_PX) {
          groups.push(cur);
          cur = [];
        }
        cur.push(it);
      }
      if (cur.length) groups.push(cur);
    }
    const placed: number[] = [];
    const tags: { y: number; label: string; gain: boolean; ord: number }[] = [];
    for (const g of groups) {
      const bundled = g.length >= BUNDLE_MIN;
      let sumPnl = 0;
      let minDue = Infinity;
      let sumY = 0;
      let ord = 0;
      let anyProfit = false;
      for (const { p, y } of g) {
        const pnl = e.pnlAt(p, e.mid);
        const profit = pnl > 0;
        sumPnl += pnl;
        sumY += y;
        minDue = Math.min(minDue, p.dueT);
        ord = Math.max(ord, p.id);
        anyProfit = anyProfit || profit;
        const xs = Math.max(0, xOf(p.openT));
        const base = p.dir > 0 ? BUY : SELL;
        const col = profit ? GOLD : base;
        ctx.save();
        ctx.strokeStyle = col;
        ctx.lineWidth = profit ? 3 : 2;
        ctx.shadowColor = col;
        ctx.shadowBlur = profit ? 10 + pulse * 12 : 4;
        ctx.setLineDash(profit ? [] : [8, 5]);
        ctx.beginPath();
        ctx.moveTo(xs, y);
        ctx.lineTo(plotW + 18, y);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(xs, y, 4, 0, 6.283);
        ctx.fill();
        if (!bundled) {
          const head = `${p.dir > 0 ? '▲' : '▼'}${bigYen(p.margin)}`;
          const state = e.isBinary ? (pnl > 0 ? ' 当たり中' : pnl < 0 ? ' ハズレ中' : ' 同値') : '';
          tags.push({ y, label: `${head}${state} ${yen(pnl, true)}円`, gain: profit, ord: p.id });
          this.ring(ctx, plotW, placed, y, p.dir, Math.max(0, Math.min(1, (p.dueT - e.t) / e.cfg.holdMs)), col, profit);
        }
      }
      if (bundled) {
        const y = sumY / g.length;
        const dir = g[0].p.dir;
        const profit = sumPnl > 0;
        const col = profit ? GOLD : dir > 0 ? BUY : SELL;
        const sec = Math.ceil(Math.max(0, minDue - e.t) / 1000);
        tags.push({ y, label: `${dir > 0 ? '▲' : '▼'}×${g.length} ${yen(sumPnl, true)}円 あと${sec}秒`, gain: profit, ord });
        this.ring(ctx, plotW, placed, y, dir, Math.max(0, Math.min(1, (minDue - e.t) / e.cfg.holdMs)), col, anyProfit && profit);
      }
    }

    // 建玉タグ（新しい8件まで）：「▲1万円 +230円」．重ならないよう縦にずらす
    const MAXTAG = 8;
    const shown = tags.sort((a, b) => a.ord - b.ord).slice(-MAXTAG).sort((a, b) => a.y - b.y);
    const GAP = 20;
    const ys: number[] = [];
    shown.forEach((t, i) => ys.push(Math.max(t.y - 12, i ? ys[i - 1] + GAP : 14)));
    const over = ys.length ? ys[ys.length - 1] + GAP - (h - 4) : 0;
    if (over > 0) for (let i = 0; i < ys.length; i++) ys[i] = Math.max(14 + i * GAP * 0.5, ys[i] - over);
    ctx.font = '800 12px system-ui, sans-serif';
    ctx.textAlign = 'right';
    shown.forEach((t, i) => {
      const tw2 = ctx.measureText(t.label).width + 12;
      const bx = plotW - 8 - tw2;
      const by = ys[i] - 9;
      ctx.fillStyle = 'rgba(11,11,26,0.85)';
      ctx.strokeStyle = t.gain ? GOLD : '#8fa3c4';
      ctx.lineWidth = 1.5;
      roundRect(ctx, bx, by, tw2, 18, 9);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = t.gain ? GOLD : '#a9bbd8';
      ctx.fillText(t.label, plotW - 14, ys[i] + 0.5);
    });
    if (tags.length > MAXTAG) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.fillText(`ほか ${tags.length - MAXTAG}件`, plotW - 8, 10);
    }

    // 現在値の先端と値札
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.shadowColor = '#2fe6ff';
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(plotW, yNow, 5 + pulse * 1.5, 0, 6.283);
    ctx.fill();
    ctx.restore();
    const ty = Math.max(18, Math.min(h - 40, yNow));
    const tw = 74;
    const tx = w - tw - 2;
    ctx.fillStyle = 'rgba(11,11,26,0.82)';
    ctx.strokeStyle = '#2fe6ff';
    ctx.lineWidth = 1.5;
    roundRect(ctx, tx, ty - 14, tw, 28, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '800 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(px(e.mid), tx + tw / 2, ty);
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.fillStyle = SELL;
    ctx.fillText('B ' + px(e.bid), tx + tw / 2, ty + 22);
    ctx.fillStyle = BUY;
    ctx.fillText('A ' + px(e.ask), tx + tw / 2, ty + 33);
  }
}

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
