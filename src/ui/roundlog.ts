import type { ModeId } from '../engine/modes';

/**
 * 1ラウンドの記録（プレイ画面 game.ts が書き，結果画面・記録帳 result.ts / records.ts が読む）．
 * エンジンの集計（勝ち数・負け数など）とは別に，体験の振り返り用に UI 側で集める．
 */
export interface RoundLog {
  /** 途中でやめた（記録・実績の対象外） */
  aborted: boolean;
  /** 今回払ったスプレッド（売値と買値の差）の合計 [円]．建てた時と決済時に半分ずつ加算 */
  spreadCost: number;
  /** 発注した回数（上がる / 下がる） */
  taps: { up: number; down: number };
  /** 通常決済の損益の一覧（ロスカットは含まない） */
  settles: number[];
  /** ロスカットごとの損益と強制決済した件数 */
  losscuts: { pnl: number; count: number }[];
  /** 5連勝（大当たり）に到達した回数 */
  jackpots: number;
  /** 最大の1発の勝ち・負け [円]（負けは負の値） */
  biggestWin: number;
  biggestLoss: number;
  /** 最も多く同時に持っていた建玉数 */
  maxOpen: number;
  /** ゼロカットで免除された額 [円]（engine.zeroCutTotal の写し） */
  zeroCut: number;
  /** ヒミツモードで結果画面で選んだ予想（未回答なら undefined） */
  secretGuess?: ModeId;
}

export function newRoundLog(): RoundLog {
  return { aborted: false, spreadCost: 0, taps: { up: 0, down: 0 }, settles: [], losscuts: [], jackpots: 0, biggestWin: 0, biggestLoss: 0, maxOpen: 0, zeroCut: 0 };
}
