/** DOM 要素を作る小さなヘルパー */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** 整数にして桁区切り．sign=true なら +/− を付ける */
export function yen(v: number, sign = false): string {
  const r = Math.round(v);
  const s = Math.abs(r).toLocaleString('ja-JP');
  if (!sign) return (r < 0 ? '−' : '') + s;
  return (r > 0 ? '+' : r < 0 ? '−' : '±') + s;
}

/** pt → 円の文字列（小数3桁） */
export function px(pt: number): string {
  return (pt / 1000).toFixed(3);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

/** 読みやすい金額：12,000→「1.2万円」，100,000,000→「1億円」，9,500→「9,500円」 */
export function bigYen(v: number): string {
  const r = Math.round(v);
  const f = (x: number) => String(+x.toFixed(x < 10 ? 1 : 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (r >= 1e8) return f(r / 1e8) + '億円';
  if (r >= 1e4) return f(r / 1e4) + '万円';
  return r.toLocaleString('ja-JP') + '円';
}
