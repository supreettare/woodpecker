// Synthesized sound effects via the Web Audio API — no audio files, so the app
// stays fully offline and self-contained. The AudioContext is created lazily
// and resumed on first use (browsers require a user gesture before audio).

let ctx = null;
function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// A single decaying oscillator "blip".
function tone(freq, dur, { type = 'sine', gain = 0.2, slideTo = null, delay = 0 } = {}) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// A short filtered noise burst — gives moves/captures a percussive "click".
function noise(dur, { gain = 0.15, cutoff = 1800, delay = 0 } = {}) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + delay;
  const frames = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = cutoff;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filt).connect(g).connect(c.destination);
  src.start(t);
  src.stop(t + dur);
}

export const sound = {
  enabled: true,
  setEnabled(on) { this.enabled = !!on; },
  // Prime the audio context from a user gesture (called on first interaction).
  unlock() { if (this.enabled) ac(); },

  move() {
    if (!this.enabled) return;
    noise(0.055, { gain: 0.12, cutoff: 1400 });
    tone(300, 0.05, { type: 'triangle', gain: 0.06, slideTo: 200 });
  },
  capture() {
    if (!this.enabled) return;
    noise(0.08, { gain: 0.18, cutoff: 1000 });
    tone(180, 0.07, { type: 'square', gain: 0.06, slideTo: 110 });
  },
  check() {
    if (!this.enabled) return;
    tone(760, 0.09, { type: 'sine', gain: 0.12 });
    tone(1015, 0.09, { type: 'sine', gain: 0.10, delay: 0.06 });
  },
  success() {
    if (!this.enabled) return;
    [523.25, 659.25, 783.99].forEach((f, i) => tone(f, 0.16, { type: 'sine', gain: 0.14, delay: i * 0.09 }));
  },
  error() {
    if (!this.enabled) return;
    tone(160, 0.16, { type: 'square', gain: 0.12, slideTo: 120 });
  },
};
