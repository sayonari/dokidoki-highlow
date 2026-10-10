import { Rng } from '../engine/rng';
import type { PriceSource, Steer } from './types';

/** 現実のドル円の1秒あたり標準偏差の目安 ≈ 0.0035円 = 3.5pt/√s */
const REAL_SIGMA_PT_PER_SQRT_S = 3.5;

export interface SyntheticOptions {
  rng: Rng;
  volMult: number; // ボラティリティ倍率
  spreadPt: number;
  start?: number; // 初期 mid [pt]
  /** 'walk' = 確率的ボラ＋ジャンプ（リアルっぽい），'coin' = ±1ステップの公平なコイン */
  style: 'walk' | 'coin';
}

/**
 * 合成相場．
 *   x_{t+Δ} = x_t + D + σ_t √Δ ε + J（D はディレクターのドリフト）
 * σ_t = σ0·exp(h_t)，h_t は平均0の OU 過程（ボラの塊），J は稀なジャンプ．
 * 'coin' は x ± step の公平なランダムウォーク（ドリフト・ジャンプなし）．
 */
export class SyntheticSource implements PriceSource {
  readonly kind = 'synthetic' as const;
  private x: number; // 連続値の内部状態 [pt]
  private h = 0; // 対数ボラ
  private readonly sigma0: number; // [pt/√ms]

  constructor(private readonly o: SyntheticOptions) {
    this.x = o.start ?? 150000 + Math.round(o.rng.next() * 10000);
    this.sigma0 = (REAL_SIGMA_PT_PER_SQRT_S * o.volMult) / Math.sqrt(1000);
  }

  spread(): number {
    return this.o.spreadPt;
  }

  sigmaPerSqrtMs(): number {
    return this.sigma0;
  }

  next(dtMs: number, steer?: Steer): number {
    const { rng } = this.o;
    if (this.o.style === 'coin') {
      const step = Math.max(1, Math.round(this.sigma0 * Math.sqrt(dtMs)));
      this.x = Math.round(this.x) + (rng.chance(0.5) ? step : -step);
      // コインでもドリフトは「表の出やすさ」として効かせる
      if (steer) this.x += steer.drift;
      return Math.round(this.x);
    }
    // ボラの OU 過程：時定数 20 秒，定常 SD 0.45
    const tau = 20000;
    this.h += (-this.h * dtMs) / tau + 0.45 * Math.sqrt((2 * dtMs) / tau) * rng.normal();
    const sigma = this.sigma0 * Math.exp(this.h - 0.1);
    let dx = sigma * Math.sqrt(dtMs) * rng.normal();
    // 平均 25 秒に1回のジャンプ（指標発表っぽい急変）
    if (rng.chance(dtMs / 25000)) dx += this.sigma0 * Math.sqrt(2000) * 1.5 * rng.normal();
    if (steer) dx += steer.drift;
    this.x += dx;
    return Math.round(this.x);
  }

  set(mid: number): void {
    this.x = mid;
  }

  status() {
    return 'ok' as const;
  }

  label(): string {
    return this.o.style === 'coin' ? '合成（完全ランダム）' : '合成相場';
  }

  dispose(): void {}
}
