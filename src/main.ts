import './style.css';
import './ui/meta.css';
import { Engine } from './engine/engine';
import type { GameConfig } from './engine/engine';
import { MODES, SECRET_POOL, modeDef } from './engine/modes';
import { Rng } from './engine/rng';
import { LiveSource } from './market/live';
import { ReplaySource } from './market/replay';
import { SyntheticSource } from './market/synthetic';
import type { PriceSource } from './market/types';
import { sfx } from './audio/sfx';
import { Game } from './ui/game';
import type { GameResult } from './ui/game';
import { ResultScreen } from './ui/result';
import { loadSettings, saveSettings } from './ui/settings';
import type { Settings } from './ui/settings';
import { REPLAY, TitleScreen } from './ui/title';
import { HAS_REPLAY } from './market/replayData';
import { h } from './ui/util';

const app = document.getElementById('app')!;
const ALT = HAS_REPLAY ? '『実データ再生』' : '『リアルっぽい』相場';
const settings = loadSettings();
if (!['fx', 'binary', 'martingale'].includes(settings.rule)) settings.rule = 'fx';
if (!MODES.some((m) => m.id === settings.mode) || (settings.mode === 'replay' && !HAS_REPLAY)) settings.mode = 'realistic';

type Current = { dispose(): void } | null;
let current: Current = null;
let launching = false;

function show(next: Current) {
  current?.dispose();
  current = next;
}

function showTitle(notice?: string) {
  show(new TitleScreen(app, settings, (s) => void launch(s), notice));
}

/** 相場ソースとエンジンを組み立てる．失敗したら理由の文字列を返す */
async function build(s: Settings): Promise<{ engine: Engine; source: PriceSource; cfg: GameConfig; secret: boolean } | string> {
  const rng = new Rng((Date.now() ^ ((Math.random() * 0x7fffffff) | 0)) >>> 0);
  const secret = s.mode === 'secret';
  const realId = secret ? SECRET_POOL[Math.floor(rng.next() * SECRET_POOL.length)] : s.mode;
  const mode = modeDef(realId);
  let source: PriceSource;
  if (realId === 'live') {
    const live = new LiveSource();
    const ok = await live.ready();
    if (!ok || live.status() === 'error') {
      live.dispose();
      return `ライブ相場につなげませんでした．${ALT}で遊ぼう！`;
    }
    if (live.status() === 'closed') {
      live.dispose();
      return `いまは為替市場がお休み（土日など）です．${ALT}で遊ぼう！`;
    }
    source = live;
  } else if (realId === 'replay') {
    const list = REPLAY.sessions;
    if (!list.length) return '再生データが入っていません';
    const se = list.find((x) => x.id === s.session) ?? list[Math.floor(rng.next() * list.length)];
    source = new ReplaySource(se, REPLAY.stepMs, s.speed, rng.next() * 0.5);
  } else {
    const coin = realId === 'random';
    source = new SyntheticSource({ rng, volMult: s.vol, spreadPt: coin ? 0 : 2, style: coin ? 'coin' : 'walk' });
  }
  const cfg: GameConfig = {
    mode,
    leverage: s.leverage,
    marginPerShot: s.margin,
    holdMs: s.holdSec * 1000,
    roundMs: s.roundSec * 1000,
    initialCash: 100000,
    rule: s.rule,
  };
  return { engine: new Engine(cfg, source, rng), source, cfg, secret };
}

async function launch(s: Settings) {
  if (launching) return;
  launching = true;
  saveSettings(s);
  sfx.unlock();
  let wait: HTMLElement | null = null;
  if (s.mode === 'live') {
    wait = h('div', 'wait-overlay', 'ライブ相場に接続中…');
    document.body.append(wait);
  }
  const r = await build(s);
  wait?.remove();
  launching = false;
  if (typeof r === 'string') {
    if (s.mode === 'live') {
      showFallback(r);
    } else {
      showTitle(r);
    }
    return;
  }
  const play = () => {
    show(
      new Game(app, {
        settings: s,
        cfg: r.cfg,
        engine: r.engine,
        source: r.source,
        secret: r.secret,
        onFinish: (res) => showResult(res, s),
        onAbort: () => showTitle(),
      }),
    );
  };
  play();
}

/** ライブが使えないとき：実データ再生への切替ボタンつきの案内 */
function showFallback(msg: string) {
  showTitle();
  const ov = h('div', 'modal');
  const box = h('div', 'modal-box');
  box.append(h('div', 'modal-title', '📴 ライブはおやすみ中'), h('p', '', msg));
  const go = h('button', 'big-btn pink', HAS_REPLAY ? '📼 実データ再生で遊ぶ' : '📈 リアルっぽい相場で遊ぶ');
  go.onclick = () => {
    ov.remove();
    settings.mode = HAS_REPLAY ? 'replay' : 'realistic';
    saveSettings(settings);
    showTitle();
  };
  const close = h('button', 'big-btn ghost', 'とじる');
  close.onclick = () => ov.remove();
  box.append(go, close);
  ov.append(box);
  document.body.append(ov);
}

function showResult(res: GameResult, s: Settings) {
  show(
    new ResultScreen(
      app,
      res,
      s,
      () => void launch(s),
      () => showTitle(),
      (lev) => {
        // 倍率だけ変えて，他の設定そのままで即スタート
        settings.leverage = lev;
        void launch(settings);
      },
      (rule) => {
        // ルールだけ変えて，相場モード・他の設定そのままで即スタート
        settings.rule = rule;
        void launch(settings);
      },
    ),
  );
}

// 音声の自動再生制限：最初の操作で unlock
window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });
showTitle();
