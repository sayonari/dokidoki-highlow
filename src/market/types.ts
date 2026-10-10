/**
 * 価格はすべて整数ポイント（1pt = 0.001円）で扱う．表示時のみ ÷1000．
 * mid を返し，bid/ask は mid ∓ spread/2．
 */
/** stale = ライブで受信が途絶えている（古い価格のまま） */
export type SourceStatus = 'ok' | 'connecting' | 'closed' | 'error' | 'stale';

/** ディレクターが合成相場に与える誘導 */
export interface Steer {
  drift: number; // このティックに加えるドリフト [pt]
}

export interface PriceSource {
  readonly kind: 'synthetic' | 'replay' | 'live';
  /** 現在のスプレッド [pt] */
  spread(): number;
  /** dtMs 進めて新しい mid [pt] を返す */
  next(dtMs: number, steer?: Steer): number;
  /** ディレクターが価格を書き換えた場合に呼ぶ（合成のみ有効） */
  set(mid: number): void;
  /** 1ティック（50ms）あたりの典型的な値動き [pt]（目標値幅の目安） */
  sigmaPerSqrtMs(): number;
  status(): SourceStatus;
  label(): string;
  dispose(): void;
}

export const PT = 1000; // 1円 = 1000pt
export const TICK_MS = 50;
