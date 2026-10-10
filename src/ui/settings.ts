import type { Rule } from '../engine/engine';
import type { ModeId } from '../engine/modes';

export type FxLevel = 0 | 1 | 2; // 0=控えめ 1=ふつう 2=ド派手

export interface Settings {
  mode: ModeId;
  rule: Rule; // 最後に遊んだ決済ルール
  leverage: number;
  margin: number;
  holdSec: number;
  roundSec: number;
  vol: number; // 合成モードのボラ倍率
  session: string; // 'random' か セッション id
  speed: number; // 再生速度
  fx: FxLevel;
  sound: boolean;
  voice: boolean;
}

const KEY = 'dokidoki-fx:settings:v1';

export function defaultSettings(): Settings {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    mode: 'realistic',
    rule: 'fx',
    leverage: 100,
    margin: 10000,
    holdSec: 5,
    roundSec: 60,
    vol: 5,
    session: 'random',
    speed: 5,
    fx: reduced ? 0 : 2,
    sound: true,
    voice: true,
  };
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...d, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* 保存できない環境でも動く */
  }
  return d;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 無視 */
  }
}
