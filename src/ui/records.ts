import { HAS_REPLAY } from '../market/replayData';
import type { Engine, GameConfig, Rule } from '../engine/engine';
import type { ModeId } from '../engine/modes';
import type { RoundLog } from './roundlog';

const KEY = 'dfx_records_v1';

export interface CfgRecord {
  bestBalance: number;
  bestStreak: number;
  plays: number;
}

export interface Records {
  plays: number;
  jackpots: number;
  bestBalance: number;
  bestStreak: number;
  byCfg: Record<string, CfgRecord>;
  /** ヒミツ以外で遊んだモード */
  modes: ModeId[];
  /** 解除済み実績 id → 解除時刻 */
  ach: Record<string, number>;
}

function empty(): Records {
  return { plays: 0, jackpots: 0, bestBalance: 0, bestStreak: 0, byCfg: {}, modes: [], ach: {} };
}

export function loadRecords(): Records {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...empty(), ...(JSON.parse(raw) as Partial<Records>) };
  } catch {
    /* 読めなくても動く */
  }
  return empty();
}

function saveRecords(r: Records): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    /* 無視 */
  }
}

/** 設定別記録のキー．FX式は従来のキーのまま（互換） */
export function cfgKey(mode: ModeId, leverage: number, rule: Rule = 'fx'): string {
  return rule === 'fx' ? `${mode}|${leverage}` : `${mode}|${rule}`;
}

/** 実績判定に使うラウンドの情報 */
export interface Ctx {
  engine: Engine;
  cfg: GameConfig;
  log: RoundLog;
  secret: boolean;
  guessCorrect: boolean;
}

export interface Achievement {
  id: string;
  icon: string;
  name: string;
  desc: string;
  hint: string;
  test: (c: Ctx, rec: Records) => boolean;
}

const ALL_MODES: ModeId[] = (['live', 'replay', 'realistic', 'random', 'loseish', 'mustlose', 'winish', 'mustwin'] as ModeId[]).filter((m) => m !== 'replay' || HAS_REPLAY);
const pnlOf = (c: Ctx) => c.engine.realized;
/** 発注数（RoundLog の記録が無くてもエンジンの数で補う） */
const fxOnly = (c: Ctx) => !c.engine.isBinary;
const shotsOf = (c: Ctx) => Math.max(c.engine.shots, c.log.taps.up + c.log.taps.down);

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first', icon: '🌱', name: 'はじめての取引', desc: '1回以上発注した', hint: 'ボタンを1回おしてみよう', test: (c) => shotsOf(c) >= 1 },
  { id: 'jackpot', icon: '🎰', name: '大当たり！', desc: '5連勝した', hint: '連勝をねらえ', test: (c) => c.engine.maxWinStreak >= 5 },
  { id: 'streak10', icon: '🔥', name: '10連勝', desc: '10連勝した', hint: '大当たりのその先へ', test: (c) => c.engine.maxWinStreak >= 10 },
  { id: 'bigwin', icon: '💥', name: '爆益', desc: '1発で証拠金の半分以上勝った', hint: '倍率が高いと1発が大きい…', test: (c) => fxOnly(c) && c.log.biggestWin >= c.cfg.marginPerShot * 0.5 },
  { id: 'losscut', icon: '🚨', name: 'ロスカットを経験', desc: 'ロスカットを体験した', hint: '大きく逆行すると起きるかも', test: (c) => c.engine.losscuts > 0 },
  { id: 'zerocut', icon: '🛟', name: 'ゼロカットを経験', desc: 'ゼロカットが発動した', hint: '値が急に飛ぶと…', test: (c) => c.engine.zeroCutTotal > 0 },
  { id: 'lev1000', icon: '🚀', name: '1000倍で生還', desc: '1000倍で10回以上取引し，ロスカット0で終了', hint: '超危険な倍率で，無傷で終えられる？', test: (c) => fxOnly(c) && c.cfg.leverage === 1000 && c.engine.shots >= 10 && c.engine.losscuts === 0 },
  { id: 'jp25', icon: '🗾', name: '日本の上限でプラス', desc: '25倍でプラス終了', hint: '日本の上限の倍率で勝とう', test: (c) => fxOnly(c) && c.cfg.leverage === 25 && pnlOf(c) > 0 },
  { id: 'double', icon: '💰', name: '資産2倍', desc: '20万円以上で終了', hint: '初期資金の2倍をめざせ', test: (c) => c.engine.balance >= c.cfg.initialCash * 2 },
  { id: 'allmodes', icon: '🧭', name: 'モード制覇', desc: `ヒミツ以外の${ALL_MODES.length}モードをすべて遊んだ`, hint: 'ヒミツ以外の全モードを遊ぼう（ライブは平日のみ）', test: (_c, rec) => ALL_MODES.every((m) => rec.modes.includes(m)) },
  { id: 'detective', icon: '🕵️', name: '名探偵', desc: 'ヒミツの正体を当てた', hint: 'ヒミツモードで予想しよう', test: (c) => c.guessCorrect },
  { id: 'lucky', icon: '🍀', name: '運も実力', desc: '完全ランダムでプラス', hint: 'コイン投げ相場で勝とう', test: (c) => c.cfg.mode.id === 'random' && pnlOf(c) > 0 },
  { id: 'real', icon: '📈', name: '本物で勝つ', desc: HAS_REPLAY ? '実データ再生かライブでプラス' : 'ライブ（本物のレート）でプラス', hint: '本物の値動きで勝とう', test: (c) => (c.cfg.mode.id === 'replay' || c.cfg.mode.id === 'live') && pnlOf(c) > 0 },
  { id: 'minloss', icon: '🩹', name: '被害最小', desc: '必ず負け越しで損失1万円未満', hint: '勝てない相場でも，傷は浅く', test: (c) => c.cfg.mode.id === 'mustlose' && pnlOf(c) < 0 && pnlOf(c) > -10000 },
  { id: 'rapid', icon: '👆', name: '連打王', desc: '1ラウンドで100回以上発注', hint: 'とにかく連打！', test: (c) => shotsOf(c) >= 100 },
  { id: 'sec30', icon: '⏱️', name: '30秒チャレンジ成功', desc: '30秒ラウンドでプラス', hint: '30秒のラウンドで勝とう', test: (c) => c.cfg.roundMs === 30000 && pnlOf(c) > 0 },
  { id: 'hilo', icon: '🎯', name: 'ハイロー体験', desc: 'ハイロー（本物・倍賭け）を1回遊んだ', hint: 'スタートで「ハイロー」を選ぼう', test: (c) => c.engine.isBinary },
  { id: 'mgfear', icon: '😱', name: '倍賭けの恐怖', desc: '倍賭けで賭け金が1発の8倍以上にふくらんだ', hint: '倍賭けハイローで連敗してみよう…', test: (c) => c.engine.rule === 'martingale' && c.engine.maxStake >= c.cfg.marginPerShot * 8 },
  { id: 'hilowin', icon: '🎲', name: 'ハイローで勝ち越し', desc: 'ハイロー系でプラス終了', hint: '勝率54%以上が必要…運をつかめ', test: (c) => c.engine.isBinary && pnlOf(c) > 0 },
];

export interface Update {
  /** 更新前の，この設定の記録（初めてなら null） */
  prev: CfgRecord | null;
  now: CfgRecord;
  newBest: boolean;
  unlocked: Achievement[];
}

/** ラウンド終了を記録して実績を判定する．途中でやめたラウンドは何もしない */
export function recordRound(c: Ctx): Update | null {
  if (c.log.aborted) return null;
  const rec = loadRecords();
  const key = cfgKey(c.cfg.mode.id, c.cfg.leverage, c.cfg.rule);
  const prev = rec.byCfg[key] ? { ...rec.byCfg[key] } : null;
  const bal = Math.round(c.engine.balance);
  const streak = c.engine.maxWinStreak;
  const now: CfgRecord = {
    bestBalance: Math.max(prev?.bestBalance ?? bal, bal),
    bestStreak: Math.max(prev?.bestStreak ?? 0, streak),
    plays: (prev?.plays ?? 0) + 1,
  };
  const newBest = !!prev && (bal > prev.bestBalance || streak > prev.bestStreak);
  rec.byCfg[key] = now;
  rec.plays++;
  rec.jackpots += c.log.jackpots;
  rec.bestBalance = Math.max(rec.bestBalance, bal);
  rec.bestStreak = Math.max(rec.bestStreak, streak);
  if (!c.secret && !rec.modes.includes(c.cfg.mode.id)) rec.modes.push(c.cfg.mode.id);
  const unlocked = unlock(rec, c);
  saveRecords(rec);
  return { prev, now, newBest, unlocked };
}

function unlock(rec: Records, c: Ctx): Achievement[] {
  const out: Achievement[] = [];
  for (const a of ACHIEVEMENTS) {
    if (rec.ach[a.id] || !a.test(c, rec)) continue;
    rec.ach[a.id] = Date.now();
    out.push(a);
  }
  return out;
}

/** 結果画面で後から条件が満たされたもの（ヒミツの予想）を判定する */
export function recheckAchievements(c: Ctx): Achievement[] {
  if (c.log.aborted) return [];
  const rec = loadRecords();
  const out = unlock(rec, c);
  if (out.length) saveRecords(rec);
  return out;
}
