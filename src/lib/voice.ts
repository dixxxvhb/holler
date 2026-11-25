// Voice filters, applied live to the mic while recording. Pitch uses a small granular
// shifter in an AudioWorklet (two crossfaded taps on a delay line).

export const VOICES = [
  { id: 'none', label: 'Normal' },
  { id: 'chipmunk', label: 'Chipmunk' },
  { id: 'deep', label: 'Deep' },
  { id: 'robot', label: 'Robot' },
  { id: 'alien', label: 'Alien' },
  { id: 'echo', label: 'Canyon' },
  { id: 'hall', label: 'Stadium' },
  { id: 'phone', label: 'Old phone' },
] as const;
export type VoiceId = (typeof VOICES)[number]['id'];

const WORKLET = `
class Shift extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'pitch', defaultValue: 1, minValue: 0.25, maxValue: 4 }]; }
  constructor() { super(); this.N = 16384; this.buf = new Float32Array(this.N); this.w = 0; this.ph = 0; this.G = 2400; }
  read(d) { let p = this.w - d; while (p < 0) p += this.N; const i = Math.floor(p), f = p - i; const a = this.buf[i % this.N], b = this.buf[(i + 1) % this.N]; return a + (b - a) * f; }
  process(inputs, outputs, params) {
    const inp = inputs[0] && inputs[0][0]; const outs = outputs[0]; if (!outs || !outs[0]) return true;
    const out = outs[0]; const pitch = params.pitch[0]; const G = this.G; const step = (1 - pitch) / G;
    for (let i = 0; i < out.length; i++) {
      this.buf[this.w] = inp ? inp[i] : 0;
      this.ph += step; if (this.ph >= 1) this.ph -= 1; if (this.ph < 0) this.ph += 1;
      const p2 = (this.ph + 0.5) % 1;
      const s = this.read(this.ph * G + 2) * Math.sin(Math.PI * this.ph) + this.read(p2 * G + 2) * Math.sin(Math.PI * p2);
      out[i] = s;
      this.w = (this.w + 1) % this.N;
    }
    for (let c = 1; c < outs.length; c++) outs[c].set(out);
    return true;
  }
}
registerProcessor('holler-shift', Shift);
`;

const loaded = new WeakSet<BaseAudioContext>();
async function shifter(ctx: AudioContext, pitch: number): Promise<AudioNode> {
  if (!loaded.has(ctx)) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    loaded.add(ctx);
  }
  const n = new AudioWorkletNode(ctx, 'holler-shift', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  n.parameters.get('pitch')!.value = pitch;
  return n;
}

function impulse(ctx: AudioContext, seconds: number, decay: number) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return b;
}

function curve(amount: number) {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / n) * 2 - 1; c[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x)); }
  return c;
}

/** Builds the voice chain from a mic source into a destination. Returns a stop function. */
export async function buildVoice(ctx: AudioContext, src: AudioNode, dest: AudioNode, voice: VoiceId): Promise<() => void> {
  const stops: (() => void)[] = [];
  const chain = (...nodes: AudioNode[]) => { nodes.reduce((a, b) => { a.connect(b); return b; }); };
  const gain = (v: number) => { const g = ctx.createGain(); g.gain.value = v; return g; };

  switch (voice) {
    case 'chipmunk': { const s = await shifter(ctx, 1.65); chain(src, s, gain(1.1), dest); break; }
    case 'deep': {
      const s = await shifter(ctx, 0.68);
      const low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 220; low.gain.value = 5;
      chain(src, s, low, gain(1.2), dest); break;
    }
    case 'robot': {
      const ring = ctx.createGain(); ring.gain.value = 0;
      const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 55; osc.connect(ring.gain); osc.start();
      stops.push(() => osc.stop());
      const shape = ctx.createWaveShaper(); shape.curve = curve(6);
      const s = await shifter(ctx, 0.92);
      chain(src, s, ring, shape, gain(0.9), dest);
      break;
    }
    case 'alien': {
      const s = await shifter(ctx, 1.35);
      const vib = ctx.createDelay(0.05); vib.delayTime.value = 0.012;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 7; const depth = gain(0.004);
      lfo.connect(depth); depth.connect(vib.delayTime); lfo.start(); stops.push(() => lfo.stop());
      const bp = ctx.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = 1800; bp.gain.value = 8; bp.Q.value = 2;
      chain(src, s, vib, bp, gain(1), dest);
      break;
    }
    case 'echo': {
      const d = ctx.createDelay(1); d.delayTime.value = 0.28; const fb = gain(0.42); const wet = gain(0.55);
      src.connect(dest); src.connect(d); d.connect(fb); fb.connect(d); d.connect(wet); wet.connect(dest);
      break;
    }
    case 'hall': {
      const conv = ctx.createConvolver(); conv.buffer = impulse(ctx, 2.6, 2.4);
      const wet = gain(0.7);
      src.connect(gain(0.85)).connect(dest); src.connect(conv); conv.connect(wet); wet.connect(dest);
      break;
    }
    case 'phone': {
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 450;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2800;
      const shape = ctx.createWaveShaper(); shape.curve = curve(12);
      chain(src, hp, lp, shape, gain(0.7), dest);
      break;
    }
    default: chain(src, dest);
  }
  return () => stops.forEach(f => { try { f(); } catch { /* already stopped */ } });
}
