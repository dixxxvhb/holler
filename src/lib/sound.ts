// Tiny synthesized sounds: no audio files to load.
let ctx: AudioContext | null = null;
function ac() {
  if (!ctx) { const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext; ctx = new AC(); }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}
function tone(freqs: number[], dur = 0.12, type: OscillatorType = 'sine', vol = 0.08) {
  try {
    const c = ac(); let t = c.currentTime;
    for (const f of freqs) {
      const o = c.createOscillator(); const g = c.createGain(); o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02); t += dur * 0.7;
    }
  } catch { /* no audio */ }
}
export const ding = (on = true) => { if (on) tone([880, 1320], 0.14, 'sine', 0.07); };
export const recStart = () => tone([520, 780], 0.08, 'triangle', 0.06);
export const recStop = () => tone([780, 520], 0.08, 'triangle', 0.06);
export const pop = () => tone([660], 0.06, 'sine', 0.05);
