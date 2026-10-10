import type { ReplayData } from './replay';

/**
 * 実データ再生用データ（Dukascopy の過去ティックから作成，個人利用の扱い）．
 * replay_data.json が無い環境（公開版リポジトリ）では空になり，実データ再生モードは自動的に隠れる．
 */
const found = import.meta.glob('./replay_data.json', { eager: true, import: 'default' });
export const REPLAY: ReplayData = (Object.values(found)[0] as ReplayData | undefined) ?? { source: '', stepMs: 250, sessions: [] };
export const HAS_REPLAY = REPLAY.sessions.length > 0;
