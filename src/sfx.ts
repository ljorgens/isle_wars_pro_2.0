// Synthesized sound effects — WebAudio only, no assets.
// The AudioContext is created lazily on first use (after a user gesture).

const MUTE_KEY = 'tempest-isles-muted';
let muted = localStorage.getItem(MUTE_KEY) === '1';
let ctx: AudioContext | null = null;

export function isMuted() {
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  localStorage.setItem(MUTE_KEY, m ? '1' : '0');
}

function ac(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(
  c: AudioContext,
  type: OscillatorType,
  freq: number,
  start: number,
  dur: number,
  peak: number,
  endFreq?: number,
) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime + start);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, c.currentTime + start + dur);
  g.gain.setValueAtTime(0.0001, c.currentTime + start);
  g.gain.exponentialRampToValueAtTime(peak, c.currentTime + start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.05);
}

function noise(c: AudioContext, start: number, dur: number, peak: number, lowpass: number) {
  const len = Math.ceil(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = lowpass;
  const g = c.createGain();
  g.gain.setValueAtTime(peak, c.currentTime + start);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  src.connect(f).connect(g).connect(c.destination);
  src.start(c.currentTime + start);
}

export const sfx = {
  /** soft UI tick — buttons, steppers */
  tick() {
    const c = ac();
    if (c) noise(c, 0, 0.04, 0.08, 2600);
  },
  /** dice clash — battle roll */
  clash() {
    const c = ac();
    if (!c) return;
    noise(c, 0, 0.09, 0.16, 1400);
    tone(c, 'square', 130, 0, 0.08, 0.05, 70);
  },
  /** parchment chime — conquest, gold banners */
  chime() {
    const c = ac();
    if (!c) return;
    tone(c, 'sine', 660, 0, 0.22, 0.12);
    tone(c, 'sine', 880, 0.1, 0.3, 0.1);
  },
  /** storm rumble — disasters */
  rumble() {
    const c = ac();
    if (!c) return;
    noise(c, 0, 0.7, 0.18, 240);
    tone(c, 'sine', 55, 0, 0.65, 0.16, 38);
  },
  /** descending rout / war banners */
  rout() {
    const c = ac();
    if (!c) return;
    tone(c, 'sawtooth', 220, 0, 0.4, 0.09, 78);
    noise(c, 0.05, 0.3, 0.1, 900);
  },
  /** victory fanfare */
  fanfare() {
    const c = ac();
    if (!c) return;
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => tone(c, 'triangle', f, i * 0.14, 0.5, 0.12));
  },
};
