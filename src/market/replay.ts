import type { PriceSource } from './types';

export interface ReplaySession {
  id: string;
  label: string;
  startUtc: string;
  base: number;
  spread: number;
  range: number;
  d: number[];
}

export interface ReplayData {
  source: string;
  stepMs: number;
  sessions: ReplaySession[];
}

/**
 * 実データ再生．差分配列を累積して mid [pt] 列を復元し，速度倍率つきで線形補間しながら進める．
 * 末尾に達したら先頭の差分から繋ぎ直す（価格は連続のまま）．
 */
export class ReplaySource implements PriceSource {
  readonly kind = 'replay' as const;
  private readonly mids: number[];
  private pos: number; // 小数インデックス
  private offset = 0; // ループ時の価格の継ぎ足し
  private readonly sigma: number;

  constructor(
    private readonly session: ReplaySession,
    private readonly stepMs: number,
    private readonly speed: number,
    startFrac = 0,
  ) {
    let x = session.base;
    this.mids = session.d.map((dd) => (x += dd));
    this.pos = Math.floor(startFrac * (this.mids.length - 1));
    // 実データの1ステップ変化の標準偏差から σ[pt/√ms] を推定（再生速度込み）
    let s2 = 0;
    for (const dd of session.d) s2 += dd * dd;
    const perStep = Math.sqrt(s2 / Math.max(1, session.d.length));
    this.sigma = (perStep / Math.sqrt(stepMs)) * Math.sqrt(speed);
  }

  spread(): number {
    return Math.max(1, this.session.spread);
  }

  sigmaPerSqrtMs(): number {
    return this.sigma;
  }

  next(dtMs: number): number {
    this.pos += (dtMs * this.speed) / this.stepMs;
    const n = this.mids.length;
    while (this.pos >= n - 1) {
      this.offset += this.mids[n - 1] - this.mids[0];
      this.pos -= n - 1;
    }
    const i = Math.floor(this.pos);
    const f = this.pos - i;
    return Math.round(this.offset + this.mids[i] * (1 - f) + this.mids[i + 1] * f);
  }

  set(): void {}

  status() {
    return 'ok' as const;
  }

  label(): string {
    return `${this.session.label}（${this.speed}倍速）`;
  }

  dispose(): void {}
}
