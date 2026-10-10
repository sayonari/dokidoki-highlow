// 効果音・BGM（WebAudio でその場合成．音声ファイルは使わない）
export type BgmKind = 'normal' | 'kakuhen';

type OscOpts = {
  type?: OscillatorType;
  end?: number;      // 終端周波数（指数スイープ）
  attack?: number;
  detune?: number;
  dest?: AudioNode;
};

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private bgmOut: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private enabled = true;
  private voiceOn = true;
  private volume = 0.8;
  private lastClick = 0;
  private activeClicks = 0;

  // BGM
  private bgmKind: BgmKind | null = null;
  private bgmTimer: ReturnType<typeof setInterval> | null = null;
  private bgmGain: GainNode | null = null;
  private bgmStep = 0;
  private bgmNext = 0;

  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.knee.value = 12;
        comp.ratio.value = 6;
        comp.attack.value = 0.003;
        comp.release.value = 0.2;
        const master = ctx.createGain();
        master.gain.value = this.enabled ? this.volume : 0;
        const sfxBus = ctx.createGain();
        sfxBus.gain.value = 0.8;
        const bgmOut = ctx.createGain();
        bgmOut.gain.value = 0.35;
        sfxBus.connect(master);
        bgmOut.connect(master);
        master.connect(comp);
        comp.connect(ctx.destination);
        this.ctx = ctx;
        this.master = master;
        this.sfxBus = sfxBus;
        this.bgmOut = bgmOut;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch { /* 何もしない */ }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.applyMaster();
    if (!on) {
      this.stopBgmInternal(true);
      this.cancelVoice();
    }
  }

  setVoiceEnabled(on: boolean): void {
    this.voiceOn = on;
    if (!on) this.cancelVoice();
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    this.applyMaster();
  }

  // ---------- 効果音 ----------

  click(dir: 'up' | 'down'): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    // 連打対策：同時発音数と最短間隔を制限
    if (t - this.lastClick < 0.03 || this.activeClicks > 6) return;
    this.lastClick = t;
    this.activeClicks++;
    const f = dir === 'up' ? 1320 : 520;
    this.osc(t, 0.06, f, 0.16, { type: 'square', end: dir === 'up' ? f * 1.25 : f * 0.8 });
    window.setTimeout(() => { this.activeClicks = Math.max(0, this.activeClicks - 1); }, 80);
  }

  settleWin(strength: number): void {
    const c = this.ready();
    if (!c) return;
    const s = clamp01(strength);
    const t = c.currentTime;
    // チャリン
    this.osc(t, 0.25, 1760, 0.25, { type: 'triangle' });
    this.osc(t + 0.07, 0.4, 2637, 0.25, { type: 'triangle' });
    if (s > 0.3) {
      const n = 4 + Math.round(s * 8);
      const scale = [72, 76, 79, 84, 88, 91, 96];
      for (let i = 0; i < n; i++) {
        const m = scale[i % scale.length] + (i >= scale.length ? 12 : 0);
        const tt = t + 0.12 + i * 0.055;
        this.osc(tt, 0.3, mtof(Math.min(m, 100)), 0.12 + 0.08 * s, { type: 'sine' });
        this.osc(tt, 0.12, mtof(Math.min(m, 100)) * 2, 0.05, { type: 'triangle' });
      }
      this.coins(Math.round(3 + s * 15), t + 0.1);
    }
  }

  settleLose(strength: number): void {
    const c = this.ready();
    if (!c) return;
    const s = clamp01(strength);
    const t = c.currentTime;
    if (s < 0.4) {
      this.osc(t, 0.15, 150, 0.3, { type: 'square', end: 110 });
    } else {
      const d = 0.5 + s * 0.5;
      this.osc(t, d, 330, 0.3, { type: 'sawtooth', end: 70 });
      this.osc(t, d, 313, 0.25, { type: 'sawtooth', end: 66 });
      this.osc(t + 0.05, 0.3, 110, 0.35, { type: 'square', end: 55 });
    }
  }

  tick(): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    this.noise(t, 0.03, 0.25, 'highpass', 4000, 4000, 1);
    this.osc(t, 0.03, 1800, 0.08, { type: 'square' });
  }

  reach(): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    this.osc(t, 1.0, 330, 0.18, { type: 'sawtooth', end: 1320, attack: 0.05 });
    this.osc(t, 1.0, 332, 0.12, { type: 'square', end: 1328, attack: 0.05 });
    // ドクドク脈打ち
    for (let i = 0; i < 6; i++) this.osc(t + i * 0.16, 0.12, 110 + i * 12, 0.3, { type: 'sine', end: 70 });
    this.noise(t, 1.0, 0.1, 'bandpass', 800, 5000, 3);
  }

  gekiatsu(): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    // ドーン
    this.osc(t, 0.6, 140, 0.6, { type: 'sine', end: 38 });
    this.noise(t, 0.35, 0.5, 'lowpass', 2500, 200, 0.7);
    // キュイーン
    this.osc(t + 0.1, 0.7, 500, 0.2, { type: 'sawtooth', end: 3000, attack: 0.02 });
    this.osc(t + 0.1, 0.7, 505, 0.15, { type: 'square', end: 3010, attack: 0.02 });
    this.osc(t + 0.75, 0.4, 2400, 0.12, { type: 'triangle', end: 3600 });
  }

  jackpot(): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    // ドラムロール（0〜0.9秒，加速）
    let tt = t;
    let gap = 0.09;
    while (tt < t + 0.9) {
      this.noise(tt, 0.05, 0.28, 'bandpass', 2200, 2200, 1.2);
      this.osc(tt, 0.06, 180, 0.15, { type: 'sine', end: 100 });
      tt += gap;
      gap = Math.max(0.035, gap * 0.93);
    }
    // ファンファーレ（ブラス風和音）
    const chord = (at: number, dur: number, notes: number[], g: number) => {
      for (const m of notes) {
        this.osc(at, dur, mtof(m), g, { type: 'sawtooth', attack: 0.02, detune: -6 });
        this.osc(at, dur, mtof(m), g, { type: 'sawtooth', attack: 0.02, detune: 6 });
      }
    };
    chord(t + 0.9, 0.18, [67, 72, 76], 0.07);
    chord(t + 1.1, 0.18, [67, 72, 76], 0.07);
    chord(t + 1.3, 0.25, [69, 74, 77], 0.07);
    chord(t + 1.6, 1.4, [72, 76, 79, 84], 0.08);
    this.osc(t + 1.6, 1.4, mtof(48), 0.25, { type: 'square' });
    this.noise(t + 1.6, 0.8, 0.3, 'highpass', 6000, 6000, 0.7); // シンバル
    // キラキラ
    for (let i = 0; i < 18; i++) {
      const m = 84 + [0, 4, 7, 12, 16, 19][i % 6] + (i > 11 ? 5 : 0);
      this.osc(t + 1.6 + i * 0.07, 0.25, mtof(Math.min(m, 108)), 0.08, { type: 'sine' });
    }
    this.coins(20, t + 2.0);
  }

  coins(n: number, at?: number): void {
    const c = this.ready();
    if (!c) return;
    const t0 = at ?? c.currentTime;
    const count = Math.max(1, Math.min(Math.round(n), 40));
    const span = Math.min(1.8, 0.25 + count * 0.07);
    for (let i = 0; i < count; i++) {
      const tt = t0 + (i / count) * span + Math.random() * 0.02;
      const f = 3200 + Math.random() * 2600;
      this.osc(tt, 0.09, f, 0.07, { type: 'square', end: f * 0.9 });
      this.osc(tt + 0.012, 0.12, f * 1.5, 0.05, { type: 'triangle' });
      this.noise(tt, 0.04, 0.1, 'highpass', 5000, 5000, 1);
    }
  }

  bakueki(): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    this.osc(t, 0.8, 120, 0.7, { type: 'sine', end: 30 });
    this.noise(t, 0.5, 0.6, 'lowpass', 6000, 300, 0.7);
    // ジャーン
    for (const m of [60, 64, 67, 72]) this.osc(t + 0.05, 0.9, mtof(m), 0.08, { type: 'sawtooth', attack: 0.01 });
    this.osc(t + 0.15, 0.5, 880, 0.15, { type: 'square', end: 1760 });
    this.noise(t + 0.05, 0.9, 0.3, 'highpass', 7000, 7000, 0.7);
    for (let i = 0; i < 8; i++) this.osc(t + 0.3 + i * 0.06, 0.25, mtof(88 + i * 2), 0.07, { type: 'sine' });
    this.coins(12, t + 0.3);
  }

  losscut(): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    // ガラスが割れる
    this.noise(t, 0.6, 0.55, 'highpass', 3500, 9000, 0.8);
    for (let i = 0; i < 14; i++) {
      const f = 3000 + Math.random() * 5000;
      this.osc(t + Math.random() * 0.4, 0.08, f, 0.08, { type: 'triangle', end: f * 0.7 });
    }
    // ガーン
    this.osc(t + 0.1, 1.0, 110, 0.4, { type: 'sawtooth', end: 45 });
    this.osc(t + 0.1, 1.0, 116, 0.3, { type: 'square', end: 48 });
    this.noise(t + 0.1, 0.3, 0.4, 'lowpass', 800, 150, 0.7);
  }

  countdown(n: number): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    if (n <= 0) {
      this.osc(t, 0.5, 1568, 0.25, { type: 'square', attack: 0.005 });
      this.osc(t, 0.5, 784, 0.2, { type: 'triangle' });
      this.osc(t + 0.08, 0.45, 2093, 0.15, { type: 'sine' });
    } else {
      this.osc(t, 0.2, 660, 0.25, { type: 'square' });
      this.osc(t, 0.2, 330, 0.2, { type: 'triangle' });
    }
  }

  gameEnd(win: boolean): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    if (win) {
      [72, 76, 79, 84].forEach((m, i) => {
        this.osc(t + i * 0.13, 0.25, mtof(m), 0.14, { type: 'square' });
        this.osc(t + i * 0.13, 0.25, mtof(m - 12), 0.12, { type: 'sawtooth' });
      });
      for (const m of [72, 76, 79, 84]) this.osc(t + 0.6, 1.0, mtof(m), 0.08, { type: 'sawtooth', attack: 0.01 });
      for (let i = 0; i < 6; i++) this.osc(t + 0.6 + i * 0.08, 0.3, mtof(96 + i), 0.07, { type: 'sine' });
    } else {
      [67, 64, 60, 55].forEach((m, i) => {
        this.osc(t + i * 0.22, 0.3, mtof(m), 0.16, { type: 'triangle', end: mtof(m) * 0.95 });
      });
      this.osc(t + 0.9, 0.9, 98, 0.25, { type: 'sawtooth', end: 49 });
    }
  }

  // ---------- BGM ----------

  bgmStart(kind: BgmKind): void {
    const c = this.ready();
    if (!c || !this.bgmOut) return;
    if (this.bgmKind === kind && this.bgmTimer !== null) return;
    this.stopBgmInternal(false);
    this.bgmKind = kind;
    const g = c.createGain();
    g.gain.value = 1;
    g.connect(this.bgmOut);
    this.bgmGain = g;
    this.bgmStep = 0;
    this.bgmNext = c.currentTime + 0.05;
    this.bgmPump();
    this.bgmTimer = setInterval(() => this.bgmPump(), 25);
  }

  bgmStop(): void {
    this.stopBgmInternal(true);
  }

  // ---------- ボイス ----------

  voice(text: string): void {
    if (!this.enabled || !this.voiceOn) return;
    try {
      const ss = window.speechSynthesis;
      if (!ss || typeof SpeechSynthesisUtterance === 'undefined') return;
      ss.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      u.rate = 1.25;
      u.pitch = 1.6;
      u.volume = this.volume;
      ss.speak(u);
    } catch { /* 未対応環境では何もしない */ }
  }

  // ---------- 内部 ----------

  private cancelVoice(): void {
    try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
  }

  private applyMaster(): void {
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime, 0.01);
    }
  }

  private ready(): AudioContext | null {
    if (!this.ctx || !this.enabled || !this.sfxBus) return null;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private stopBgmInternal(fade: boolean): void {
    if (this.bgmTimer !== null) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
    this.bgmKind = null;
    const g = this.bgmGain;
    this.bgmGain = null;
    if (g && this.ctx) {
      const t = this.ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + (fade ? 0.15 : 0.03));
      // 予約済みの音が鳴り終わった頃に切断
      window.setTimeout(() => { try { g.disconnect(); } catch { /* noop */ } }, 3000);
    }
  }

  private bgmPump(): void {
    const c = this.ctx;
    const kind = this.bgmKind;
    const g = this.bgmGain;
    if (!c || !kind || !g) return;
    const bpm = kind === 'normal' ? 140 : 170;
    const stepDur = 60 / bpm / 4; // 16分
    while (this.bgmNext < c.currentTime + 0.1) {
      this.bgmSchedule(kind, this.bgmStep, this.bgmNext, stepDur, g);
      this.bgmNext += stepDur;
      this.bgmStep++;
    }
  }

  private bgmSchedule(kind: BgmKind, step: number, t: number, sd: number, g: GainNode): void {
    const kak = kind === 'kakuhen';
    // 4小節ループ：Am F C G（kakuhen は C G Am F の上昇感）
    const roots = kak ? [48, 55, 57, 53] : [57, 53, 48, 55];
    const bar = Math.floor(step / 16) % 4;
    const s = step % 16;
    const root = roots[bar];
    const minor = !kak ? bar < 1 : bar === 2;
    const chord = [0, minor ? 3 : 4, 7, 12];

    // ベース（8分）
    if (s % 2 === 0) {
      const bm = root - 12 + (s % 8 === 6 ? 12 : 0);
      this.osc(t, sd * 1.8, mtof(bm), kak ? 0.3 : 0.26, { type: 'triangle', dest: g });
    }
    // アルペジオ（16分）
    const pat = kak ? [0, 1, 2, 3, 2, 1, 2, 3] : [0, 2, 1, 2, 3, 2, 1, 2];
    const am = root + 12 + chord[pat[s % 8]] + (kak && s >= 8 ? 12 : 0);
    this.osc(t, sd * 0.9, mtof(am), kak ? 0.1 : 0.08, { type: 'square', dest: g });

    // ドラム
    if (s % 4 === 0) this.osc(t, 0.12, 150, kak ? 0.5 : 0.35, { type: 'sine', end: 45, dest: g });
    if (s % 4 === 2 || (kak && s % 2 === 1)) {
      this.noise(t, 0.03, kak ? 0.1 : 0.07, 'highpass', 7000, 7000, 0.7, g);
    }
    if (s === 4 || s === 12) this.noise(t, 0.1, 0.16, 'bandpass', 1800, 1800, 1, g);

    // 確変：リードのファンファーレ風メロディ
    if (kak && s % 4 === 0) {
      const lead = root + 24 + chord[[2, 3, 2, 1][(s / 4) | 0]];
      this.osc(t, sd * 3.5, mtof(lead), 0.07, { type: 'sawtooth', attack: 0.01, dest: g });
    }
    // 小節頭のキラッ
    if (kak && s === 0 && bar === 3) {
      for (let i = 0; i < 4; i++) this.osc(t + i * sd * 0.5, 0.2, mtof(96 + i * 3), 0.06, { type: 'sine', dest: g });
    }
  }

  private osc(t: number, dur: number, freq: number, gain: number, o: OscOpts = {}): void {
    const c = this.ctx;
    const dest = o.dest ?? this.sfxBus;
    if (!c || !dest) return;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.end) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.end), t + dur);
    if (o.detune) osc.detune.value = o.detune;
    const a = Math.min(o.attack ?? 0.004, dur * 0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
  }

  private noise(
    t: number, dur: number, gain: number,
    ftype: BiquadFilterType, f0: number, f1: number, q: number, dest?: AudioNode,
  ): void {
    const c = this.ctx;
    const out = dest ?? this.sfxBus;
    if (!c || !out) return;
    if (!this.noiseBuf) {
      const len = c.sampleRate * 1;
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = ftype;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
    src.onended = () => {
      src.disconnect();
      f.disconnect();
      g.disconnect();
    };
  }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export const sfx = new Sfx();
