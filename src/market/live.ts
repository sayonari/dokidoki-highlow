import type { PriceSource, SourceStatus } from './types';
import { PT } from './types';

const WS_URL = 'wss://forex-api.coin.z.com/ws/public/v1';

/**
 * GMO コイン外国為替FX の公開 WebSocket（APIキー不要）から USD/JPY を受信する．
 * REST は CORS 非対応のため使わない．市場クローズ中は status='closed'．
 */
export class LiveSource implements PriceSource {
  readonly kind = 'live' as const;
  private ws: WebSocket | null = null;
  private mid = 0;
  private spr = 2;
  private st: SourceStatus = 'connecting';
  private disposed = false;
  private retry = 0;
  private lastRecv = 0; // 最後に値を受け取った時刻（Date.now）
  // 直近の変化から σ を推定
  private lastMid = 0;
  private var = 4;

  constructor() {
    this.connect();
  }

  private connect() {
    if (this.disposed) return;
    this.st = this.mid ? this.st : 'connecting';
    const ws = new WebSocket(WS_URL);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      // 購読は1秒に1回までの制限あり
      ws.send(JSON.stringify({ command: 'subscribe', channel: 'ticker', symbol: 'USD_JPY' }));
    };
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(String(e.data));
        if (m.symbol !== 'USD_JPY') return;
        const bid = Math.round(Number(m.bid) * PT);
        const ask = Math.round(Number(m.ask) * PT);
        if (!(bid > 0 && ask >= bid)) return;
        this.mid = Math.round((bid + ask) / 2);
        this.lastRecv = Date.now();
        this.spr = Math.max(1, ask - bid);
        this.st = m.status === 'OPEN' ? 'ok' : 'closed';
      } catch {
        /* 無視 */
      }
    };
    ws.onerror = () => {
      if (!this.mid) this.st = 'error';
    };
    ws.onclose = () => {
      if (this.disposed) return;
      if (this.st === 'ok') this.st = 'connecting';
      this.retry++;
      setTimeout(() => this.connect(), Math.min(10000, 1000 * this.retry));
    };
  }

  /** 最初の値が来るまで待つ（タイムアウトで false） */
  ready(timeoutMs = 8000): Promise<boolean> {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (this.mid > 0) {
          clearInterval(iv);
          resolve(true);
        } else if (Date.now() - t0 > timeoutMs) {
          clearInterval(iv);
          resolve(false);
        }
      }, 100);
    });
  }

  spread(): number {
    return this.spr;
  }

  sigmaPerSqrtMs(): number {
    return Math.sqrt(this.var / 50);
  }

  next(): number {
    if (this.lastMid) {
      const d = this.mid - this.lastMid;
      this.var = 0.995 * this.var + 0.005 * d * d;
    }
    this.lastMid = this.mid;
    return this.mid;
  }

  set(): void {}

  status(): SourceStatus {
    // 3 秒以上受信が無ければ「止まっている」（通常は約 0.1 秒ごとに届く）
    if (this.mid && this.st !== 'closed' && Date.now() - this.lastRecv > 3000) return 'stale';
    return this.st;
  }

  label(): string {
    return 'ライブ（GMOコイン外為FX USD/JPY）';
  }

  dispose(): void {
    this.disposed = true;
    this.ws?.close();
  }
}
