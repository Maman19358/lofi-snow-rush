// Tiny WebAudio synth SFX — no audio files, everything synthesized.
// All calls are guarded: if AudioContext is unavailable/suspended, they no-op.
let ctx = null;
let muted = false;

function ac() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch { return null; }
}

function tone(freq, dur, type = 'sine', vol = 0.12, when = 0, slideTo = null) {
  const c = ac();
  if (!c || muted) return;
  try {
    const t0 = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  } catch { /* ignore */ }
}

function noise(dur, vol = 0.15, freq = 800) {
  const c = ac();
  if (!c || muted) return;
  try {
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = freq;
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(c.destination);
    src.start();
  } catch { /* ignore */ }
}

export const audio = {
  unlock() { ac(); },
  setMuted(m) { muted = m; },
  isMuted() { return muted; },
  coin(combo = 1) {
    const base = 660 + Math.min(combo, 8) * 40;
    tone(base, 0.09, 'sine', 0.12);
    tone(base * 1.5, 0.14, 'sine', 0.1, 0.06);
  },
  jump() { tone(280, 0.16, 'sine', 0.1, 0, 620); },
  slide() { noise(0.18, 0.07, 1200); },
  hit() { noise(0.25, 0.22, 500); tone(140, 0.25, 'sawtooth', 0.12, 0, 60); },
  shield() { tone(880, 0.12, 'triangle', 0.12); tone(1320, 0.2, 'triangle', 0.1, 0.08); },
  shieldBreak() { tone(520, 0.2, 'square', 0.1, 0, 180); noise(0.15, 0.1, 2000); },
  click() { tone(520, 0.06, 'sine', 0.08); },
  gameOver() {
    tone(392, 0.22, 'triangle', 0.12);
    tone(311, 0.22, 'triangle', 0.12, 0.2);
    tone(233, 0.4, 'triangle', 0.12, 0.4);
  },
  start() {
    tone(523, 0.1, 'triangle', 0.1);
    tone(659, 0.1, 'triangle', 0.1, 0.08);
    tone(784, 0.18, 'triangle', 0.12, 0.16);
  },
};
