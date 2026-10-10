import { h, yen } from './util';

/** 1回の掛け金の段階（スライダーの index に対応） */
export const STAKES = [1000, 2000, 5000, 10000, 20000, 30000, 50000, 100000];

/** いちばん近い段の index */
export function stakeIndex(v: number): number {
  let best = 0;
  for (let i = 1; i < STAKES.length; i++) if (Math.abs(STAKES[i] - v) < Math.abs(STAKES[best] - v)) best = i;
  return best;
}

export interface StakeSlider {
  el: HTMLElement;
  input: HTMLInputElement;
  /** 値を反映（イベントは出さない） */
  set(v: number): void;
  /** 隣の段へ（範囲外は無視）．変わったら true */
  step(d: number): boolean;
  /** 目盛りを暗くする：その段の額が avail（払える額）を超えるなら dim．fn は段の額→必要額 */
  dim(avail: number, need?: (v: number) => number): void;
  /** 金額表示を弾ませる */
  bump(): void;
  /** 補助ラベル（倍賭けの「次は…」など）．空なら非表示 */
  setSub(text: string): void;
}

export interface StakeOpts {
  label: string;
  value: number;
  /** 動かしたとき（v=新しい金額） */
  onChange: (v: number) => void;
  compact?: boolean;
}

/** 1回の掛け金スライダー（プレイ画面・タイトル画面で共通） */
export function createStakeSlider(o: StakeOpts): StakeSlider {
  const el = h('div', 'stake-bar' + (o.compact ? ' compact' : ''));
  const lab = h('div', 'stake-lab');
  const labMain = h('span', 'stake-lab-main', o.label);
  const labSub = h('span', 'stake-lab-sub hidden');
  lab.append(labMain, labSub);
  const track = h('div', 'stake-track');
  const input = h('input', 'stake-range');
  input.type = 'range';
  input.min = '0';
  input.max = String(STAKES.length - 1);
  input.step = '1';
  input.setAttribute('aria-label', o.label);
  const ticks = h('div', 'stake-ticks');
  const tickEls = STAKES.map((_, i) => {
    const t = h('span', 'stake-tick');
    t.style.setProperty('--i', String(i));
    ticks.append(t);
    return t;
  });
  track.append(ticks, input);
  const amt = h('div', 'stake-amt');
  el.append(lab, track, amt);

  let idx = stakeIndex(o.value);
  const show = () => {
    input.value = String(idx);
    input.setAttribute('aria-valuetext', `${yen(STAKES[idx])}円`);
    amt.textContent = `${yen(STAKES[idx])}円`;
    el.style.setProperty('--p', String(idx / (STAKES.length - 1)));
  };
  const apply = (i: number) => {
    if (i === idx) return false;
    idx = i;
    show();
    o.onChange(STAKES[idx]);
    return true;
  };
  input.addEventListener('input', () => apply(Number(input.value)));
  // マウス・タッチで触ったあとは，キー入力が発注に回るようフォーカスを外す
  input.addEventListener('pointerup', () => input.blur());
  show();

  return {
    el,
    input,
    set(v) {
      idx = stakeIndex(v);
      show();
    },
    step(d) {
      const n = Math.min(STAKES.length - 1, Math.max(0, idx + d));
      return apply(n);
    },
    dim(avail, need = (v) => v) {
      tickEls.forEach((t, i) => t.classList.toggle('dim', need(STAKES[i]) > avail + 1e-6));
    },
    bump() {
      amt.classList.remove('bump');
      void amt.offsetWidth;
      amt.classList.add('bump');
    },
    setSub(text) {
      labSub.classList.toggle('hidden', !text);
      if (labSub.textContent !== text) labSub.textContent = text;
    },
  };
}
