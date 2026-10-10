export type ModeId =
  | 'live'
  | 'replay'
  | 'realistic'
  | 'random'
  | 'loseish'
  | 'mustlose'
  | 'winish'
  | 'mustwin'
  | 'secret';

export interface ModeDef {
  id: ModeId;
  icon: string;
  name: string;
  desc: string;
  /** ディレクター設定（null = 値動きは操作しない） */
  director: null | {
    pWin: number; // 各発の勝ち目標の確率
    kappa: number; // 胴元ドリフトの強さ（決済までに σ_H の何倍ずらすか）
    clamp: boolean; // 決済の瞬間に目標領域へ強制するか
    invariant: 'none' | 'lose' | 'win';
  };
}

export const MODES: ModeDef[] = [
  { id: 'live', icon: '🔴', name: 'リアル（ライブ）', desc: '本物のドル円を今この瞬間のレートで！（平日のみ）', director: null },
  { id: 'replay', icon: '📼', name: '実データ再生', desc: '過去の本物の値動き（雇用統計など）を早送りで', director: null },
  { id: 'realistic', icon: '📈', name: 'リアルっぽい', desc: '本物そっくりの作り物相場．期待値はスプレッド分マイナス', director: null },
  { id: 'random', icon: '🎲', name: '完全ランダム', desc: '上か下かコイン投げ．手数料ゼロで期待値ぴったり0', director: null },
  { id: 'loseish', icon: '😈', name: '負け越しがち', desc: '胴元がこっそり逆に動かしてくる…', director: { pWin: 0.4, kappa: 0.3, clamp: false, invariant: 'none' } },
  { id: 'mustlose', icon: '💀', name: '必ず負け越し', desc: '何をしても最後は負け越す．胴元が本気を出すとこうなる', director: { pWin: 0.3, kappa: 0.8, clamp: true, invariant: 'lose' } },
  { id: 'winish', icon: '😇', name: '勝ち越しがち', desc: '相場の神様がちょっと味方してくれる', director: { pWin: 0.6, kappa: 0.7, clamp: false, invariant: 'none' } },
  { id: 'mustwin', icon: '👑', name: '必ず勝ち越し', desc: '絶対に勝ち越す夢のモード（現実には存在しません）', director: { pWin: 0.7, kappa: 1.2, clamp: true, invariant: 'win' } },
  { id: 'secret', icon: '🎁', name: 'ヒミツ', desc: 'どのモードかは終わってからのお楽しみ', director: null },
];

export const SECRET_POOL: ModeId[] = ['realistic', 'random', 'loseish', 'mustlose', 'winish', 'mustwin'];

export function modeDef(id: ModeId): ModeDef {
  return MODES.find((m) => m.id === id)!;
}
