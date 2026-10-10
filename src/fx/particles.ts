/** 全画面 Canvas 1枚にまとめたパーティクル（コイン・紙吹雪・火花）．粒がある間だけ rAF を回す． */
interface P {
  kind: 0 | 1 | 2; // 0=コイン 1=紙吹雪 2=火花
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number; // 大きさ
  rot: number;
  vr: number;
  life: number; // 残り秒
  max: number;
  color: string;
  floor: boolean; // 床で跳ねるか
}

const MAX = 700;
const CONFETTI = ['#ff3b8d', '#2fe6ff', '#ffd23f', '#7dff6b', '#b46bff', '#ffffff'];

export class Particles {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private ps: P[] = [];
  private raf = 0;
  private last = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'fx-particles';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', this.onResize);
  }

  private onResize = () => this.resize();

  private resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  get count(): number {
    return this.ps.length;
  }

  private push(p: P) {
    if (this.ps.length >= MAX) this.ps.shift();
    this.ps.push(p);
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.loop);
    }
  }

  /** コイン噴水：(x,y) から上向きに扇状に噴き出す */
  coinFountain(x: number, y: number, n: number, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
      const v = (600 + Math.random() * 700) * power;
      this.push({
        kind: 0, x, y,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        r: 9 + Math.random() * 9, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 20,
        life: 3.5 + Math.random() * 1.5, max: 5, color: '', floor: true,
      });
    }
  }

  /** 紙吹雪：上から降らせる（全幅） */
  confettiRain(n: number) {
    for (let i = 0; i < n; i++) {
      this.push({
        kind: 1, x: Math.random() * this.w, y: -20 - Math.random() * this.h * 0.3,
        vx: (Math.random() - 0.5) * 160, vy: 120 + Math.random() * 260,
        r: 5 + Math.random() * 6, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 14,
        life: 4 + Math.random() * 2, max: 6, color: CONFETTI[(Math.random() * CONFETTI.length) | 0], floor: false,
      });
    }
  }

  /** 紙吹雪：一点から破裂 */
  confettiBurst(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 200 + Math.random() * 600;
      this.push({
        kind: 1, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 200,
        r: 5 + Math.random() * 6, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 16,
        life: 2.5 + Math.random() * 1.5, max: 4, color: CONFETTI[(Math.random() * CONFETTI.length) | 0], floor: false,
      });
    }
  }

  /** 火花（チップが飛んだ先・決済位置など） */
  sparks(x: number, y: number, n: number, color: string) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 80 + Math.random() * 280;
      this.push({
        kind: 2, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        r: 2 + Math.random() * 3, rot: 0, vr: 0, life: 0.5 + Math.random() * 0.4, max: 0.9, color, floor: false,
      });
    }
  }

  clear() {
    this.ps.length = 0;
  }

  private loop = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const { ctx, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const g = 1500;
    let j = 0;
    for (const p of this.ps) {
      p.life -= dt;
      if (p.life <= 0 || p.y > this.h + 60) continue;
      if (p.kind === 1) {
        // 紙吹雪はひらひら：空気抵抗が大きい
        p.vy += 380 * dt;
        p.vx *= 1 - 1.2 * dt;
        p.vy = Math.min(p.vy, 320);
        p.x += p.vx * dt + Math.sin(p.rot * 1.3) * 30 * dt;
      } else {
        p.vy += (p.kind === 0 ? g : 300) * dt;
        p.x += p.vx * dt;
      }
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.floor && p.y > this.h - p.r && p.vy > 0) {
        p.y = this.h - p.r;
        p.vy *= -0.45;
        p.vx *= 0.8;
      }
      this.ps[j++] = p;
      const a = Math.min(1, p.life / Math.min(0.6, p.max));
      ctx.globalAlpha = a;
      if (p.kind === 0) {
        // コイン：横幅を |cos| で潰して回転を表現，反射光つき
        const sx = Math.abs(Math.cos(p.rot));
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(Math.max(0.12, sx), 1);
        ctx.fillStyle = '#c8860a';
        ctx.beginPath();
        ctx.arc(0, 0, p.r, 0, 6.283);
        ctx.fill();
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath();
        ctx.arc(0, 0, p.r * 0.82, 0, 6.283);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,' + (0.35 + 0.5 * Math.max(0, Math.sin(p.rot * 2))) + ')';
        ctx.beginPath();
        ctx.arc(-p.r * 0.25, -p.r * 0.3, p.r * 0.28, 0, 6.283);
        ctx.fill();
        ctx.restore();
      } else if (p.kind === 1) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.abs(Math.sin(p.rot * 1.7)) * 0.9 + 0.1);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.r, -p.r * 0.6, p.r * 2, p.r * 1.2);
        ctx.restore();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * a + 0.5, 0, 6.283);
        ctx.fill();
      }
    }
    this.ps.length = j;
    ctx.globalAlpha = 1;
    if (j > 0) {
      this.raf = requestAnimationFrame(this.loop);
    } else {
      this.raf = 0;
      ctx.clearRect(0, 0, this.w, this.h);
    }
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.removeEventListener('resize', this.onResize);
    this.canvas.remove();
  }
}
