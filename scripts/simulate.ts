/**
 * モードごとの値動き生成を検証するシミュレーション．
 *   npx tsx scripts/simulate.ts [ラウンド数=1000] [出力JSON] [ルール fx|binary|martingale]
 * 「必ず負け越し／必ず勝ち越し」は，各決済の直後に不変条件を毎回チェックし，違反を数える．
 */
import { writeFileSync } from 'node:fs';
import { Engine, type Dir, type Rule } from '../src/engine/engine';
import { modeDef, type ModeId } from '../src/engine/modes';
import { Rng } from '../src/engine/rng';
import { SyntheticSource } from '../src/market/synthetic';
import { ReplaySource, type ReplayData } from '../src/market/replay';

const ROUNDS = Number(process.argv[2] ?? 1000);
const OUT = process.argv[3] || undefined;
const RULE = (process.argv[4] ?? 'fx') as Rule;

type Bot = { name: string; rate: number; decide: (hist: number[], rng: Rng, n: number) => Dir };
const sgn = (v: number): Dir => (v >= 0 ? 1 : -1);
const BOTS: Bot[] = [
  { name: 'ランダム連打', rate: 4, decide: (_h, r) => (r.chance(0.5) ? 1 : -1) },
  { name: '順張り', rate: 3, decide: (h) => sgn(h[h.length - 1] - h[Math.max(0, h.length - 20)]) },
  { name: '逆張り', rate: 3, decide: (h) => sgn(h[Math.max(0, h.length - 20)] - h[h.length - 1]) },
  { name: '上だけ連打', rate: 6, decide: () => 1 },
  { name: '両建て交互', rate: 10, decide: (_h, _r, n) => (n % 2 ? 1 : -1) },
  { name: '最大速度連打', rate: 20, decide: (_h, r) => (r.chance(0.5) ? 1 : -1) },
];

const LEVS = [1, 5, 10, 25, 100, 500, 1000];
const MARGINS = [5000, 10000, 30000];
const HOLDS = [3000, 5000, 10000];
const ROUNDS_MS = [60000, 90000, 180000];
const VOLS = [1, 5, 20];

let replay: ReplayData | null = null;
try {
  // 公開版リポジトリには再生データが無いので，パスを変数にして型解決させない
  const dataPath = '../src/market/replay_data.json';
  replay = (await import(dataPath, { with: { type: 'json' } })).default as ReplayData;
} catch {
  /* 再生データ未作成なら replay はスキップ */
}

const MODE_IDS: ModeId[] = ['realistic', 'random', 'loseish', 'mustlose', 'winish', 'mustwin', ...(replay ? (['replay'] as ModeId[]) : [])];

interface Agg {
  rounds: number;
  winOver: number; // 勝ち越し（勝ち>負け かつ 損益>0）
  loseOver: number; // 負け越し（勝ち<負け かつ 損益<0）
  trades: number;
  tradeWins: number;
  pnlSum: number;
  losscutRounds: number;
  bankrupt: number;
  violations: number; // 不変条件違反（決済直後のチェック）
  deferred: number;
  forced: number;
  maxJumpPt: number; // 1ティックの最大価格変化
  ticks: number;
  bigJumps: number; // σ の6倍を超える1ティックの跳び
}

function runRound(mode: ModeId, bot: Bot, seed: number, agg: Agg) {
  const rng = new Rng(seed);
  const cfg = {
    mode: modeDef(mode),
    leverage: rng.pick(LEVS),
    marginPerShot: rng.pick(MARGINS),
    holdMs: rng.pick(HOLDS),
    roundMs: rng.pick(ROUNDS_MS),
    initialCash: 100000,
    rule: RULE,
  };
  const src =
    mode === 'replay'
      ? new ReplaySource(rng.pick(replay!.sessions), replay!.stepMs, rng.pick([1, 5, 20]), rng.next())
      : new SyntheticSource({ rng: new Rng(seed ^ 0x9e3779b9), volMult: rng.pick(VOLS), spreadPt: mode === 'random' ? 0 : 2, style: mode === 'random' ? 'coin' : 'walk' });
  const eng = new Engine(cfg, src, new Rng(seed ^ 0x51ed270b));
  const botRng = new Rng(seed ^ 0x2545f491);
  const hist: number[] = [eng.mid];
  const pPress = bot.rate / 20;
  const inv = cfg.mode.director?.invariant ?? 'none';
  let n = 0;
  let prev = eng.mid;
  let guard = 0;
  const sigTick = src.sigmaPerSqrtMs() * Math.sqrt(50);
  while (!eng.finished && guard++ < 200000) {
    if (eng.acceptingOrders && botRng.chance(pPress)) eng.open(bot.decide(hist, botRng, n++));
    const evs = eng.step();
    agg.maxJumpPt = Math.max(agg.maxJumpPt, Math.abs(eng.mid - prev));
    agg.ticks++;
    if (Math.abs(eng.mid - prev) > 6 * sigTick) agg.bigJumps++;
    prev = eng.mid;
    hist.push(eng.mid);
    for (const e of evs) {
      if (e.k === 'settle' || e.k === 'losscut') {
        if (inv === 'lose' && !(eng.wins < eng.losses && eng.realized < 0)) agg.violations++;
        if (inv === 'win' && !(eng.wins > eng.losses && eng.realized > 0)) agg.violations++;
      }
    }
    // 期日を過ぎても決済されない建玉（必ず勝ち越しの見送り）を数える
    if (eng.positions.some((p) => p.dueT < eng.t)) agg.deferred++;
  }
  agg.forced += eng.forcedSettles;
  agg.rounds++;
  const traded = eng.wins + eng.losses + eng.draws > 0;
  if (traded && eng.wins > eng.losses && eng.realized > 0) agg.winOver++;
  if (traded && eng.wins < eng.losses && eng.realized < 0) agg.loseOver++;
  agg.trades += eng.wins + eng.losses + eng.draws;
  agg.tradeWins += eng.wins;
  agg.pnlSum += eng.realized;
  if (eng.losscuts) agg.losscutRounds++;
  if (eng.endReason === 'bankrupt') agg.bankrupt++;
}

const results: Record<string, Record<string, Agg & { winRate: number; avgPnl: number }>> = {};
const t0 = Date.now();
for (const mode of MODE_IDS) {
  results[mode] = {};
  for (const bot of BOTS) {
    const agg: Agg = { rounds: 0, winOver: 0, loseOver: 0, trades: 0, tradeWins: 0, pnlSum: 0, losscutRounds: 0, bankrupt: 0, violations: 0, deferred: 0, forced: 0, maxJumpPt: 0, ticks: 0, bigJumps: 0 };
    for (let i = 0; i < ROUNDS; i++) runRound(mode, bot, (i + 1) * 7919 + bot.rate * 104729 + mode.length * 13, agg);
    results[mode][bot.name] = { ...agg, winRate: agg.tradeWins / Math.max(1, agg.trades), avgPnl: agg.pnlSum / agg.rounds };
    const r = results[mode][bot.name];
    console.log(
      `${mode.padEnd(9)} ${bot.name.padEnd(8)} 勝越 ${(100 * r.winOver / r.rounds).toFixed(1).padStart(5)}% 負越 ${(100 * r.loseOver / r.rounds).toFixed(1).padStart(5)}% 1発勝率 ${(100 * r.winRate).toFixed(1).padStart(5)}% 平均損益 ${Math.round(r.avgPnl).toString().padStart(8)} LC ${r.losscutRounds} 破産 ${r.bankrupt} 違反 ${r.violations} 見送り ${r.deferred} 強制 ${r.forced} 最大跳び ${r.maxJumpPt}pt 6σ超 ${(1e4 * r.bigJumps / r.ticks).toFixed(1)}/万tick`,
    );
  }
}
console.log(`rule=${RULE} elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (OUT) writeFileSync(OUT, JSON.stringify({ rounds: ROUNDS, date: new Date().toISOString(), results }, null, 1));
