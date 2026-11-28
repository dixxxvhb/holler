// The camera studio: camera -> WebGL (looks + mirror + overlay of scribbles and text) -> canvas,
// mic -> voice filter -> recorder. Falls back to recording the raw camera when the canvas path fails.
import { buildVoice, type VoiceId } from './voice';
import { LOOKS, VS, FS, lookOf, type LookId } from './looks';
import { Cutout, loadSegmenter } from './segment';
export { LOOKS, type LookId };

export type Stroke = { color: string; width: number; pts: [number, number][] };
export type TextLayer = { text: string; y: number; style: 'pill' | 'bold' | 'type'; color: string } | null;
/** A Play card drawn near the top of the picture, so it's part of the video. */
/** opts: answer choices drawn under the question (On The Spot); picked: the one locked in. */
export type CardLayer = { label: string; text: string; sub: string; opts?: string[]; picked?: number } | null;

export type Recording = {
  blob: Blob; mime: string; ext: string; duration: number; w: number; h: number; thumb: Blob | null;
  kind: 'video' | 'audio'; effects: Record<string, unknown>;
};

function pickMime(kind: 'video' | 'audio'): { mime: string; ext: string } {
  const R = typeof MediaRecorder !== 'undefined' ? MediaRecorder : null;
  const list = kind === 'video'
    ? [['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'mp4'], ['video/mp4;codecs=avc1,mp4a', 'mp4'], ['video/mp4', 'mp4'],
       ['video/webm;codecs=vp9,opus', 'webm'], ['video/webm;codecs=vp8,opus', 'webm'], ['video/webm', 'webm']]
    : [['audio/mp4;codecs=mp4a.40.2', 'm4a'], ['audio/mp4', 'm4a'], ['audio/webm;codecs=opus', 'webm'], ['audio/webm', 'webm']];
  for (const [m, e] of list) if (R?.isTypeSupported?.(m)) return { mime: m, ext: e };
  return { mime: '', ext: kind === 'video' ? 'mp4' : 'm4a' };
}

// ---- quality (11-28) ----
// One tier for everyone: a 720x1280 picture that lands at about 1.5 megabits a second in the file.
// Measured 11-27 with a real face clip (scripts/measure.mjs, and supabase/limits-survey.sql for what real phones wrote):
//   Chrome writes what it is asked for: asked 1,500 kbps, got 1,502, 11.7 MB a minute with sound.
//   Safari and every iPhone browser write about 1.7x what they are asked for (asked 900 at 540 wide, real phones
//   averaged 1,390 and peaked at 1,640; asked 1,500 at 720 wide, got 2,560). So those are asked for less.
// MAX_SEC is the longest holler: 3 minutes is about 35 MB, and still under the 50 MB per-file limit on a phone
// running at its measured worst. MAX_BYTES ends a take early if a recorder ever runs hotter than that, so no
// holler is too big to send.
export const TARGET_BITS = 1_500_000;
const RUNS_OVER = (() => {
  try { const ua = navigator.userAgent; return /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg\/|OPR\/|Android/.test(ua) ? 1.7 : 1; } catch { return 1; }
})();
export const VIDEO_BITS = Math.round(TARGET_BITS / RUNS_OVER);
export const AUDIO_BITS = 64_000;
export const MAX_SEC = 180;
export const MAX_BYTES = 46_000_000;

export class Studio {
  canvas: HTMLCanvasElement;
  overlay = document.createElement('canvas');
  video = document.createElement('video');
  stream: MediaStream | null = null;
  facing: 'user' | 'environment' = 'user';
  look: LookId = 'none';
  voice: VoiceId = 'none';
  strokes: Stroke[] = [];
  live: Stroke | null = null;
  text: TextLayer = null;
  card: CardLayer = null;
  glOk = false;
  simple = false;
  private gl: WebGLRenderingContext | null = null;
  private texV: WebGLTexture | null = null;
  private texO: WebGLTexture | null = null;
  private raf = 0;
  private ovDirty = true;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private t0 = 0;
  private audio: { ctx: AudioContext; stop: () => void } | null = null;
  private thumbP: Promise<Blob | null> | null = null;
  private stopping = false;
  private recKind: 'video' | 'audio' = 'video';
  onLevel?: (v: number) => void;
  private analyser: AnalyserNode | null = null;
  private swapping = false;
  /** strength of the current look, 0..1 */
  amt = 1;
  /** where warps are centered, in picture coordinates (0..1, top-left origin) */
  ctr: [number, number] = [0.5, 0.42];
  /** smoothed loudness, 0..1, drives the voice-reactive looks */
  level = 0;
  private texP: WebGLTexture | null = null;
  private texM: WebGLTexture | null = null;
  private cut = new Cutout();
  private hasMask = false;
  private meter: { ctx: AudioContext; an: AnalyserNode; src: MediaStreamAudioSourceNode } | null = null;
  private voiceNode: { inG: GainNode; outG: GainNode; stop: () => void } | null = null;
  private recSrc: MediaStreamAudioSourceNode | null = null;
  private bus: GainNode | null = null;
  /** every look used in this recording, for the record */
  looksUsed = new Set<string>();
  voicesUsed = new Set<string>();
  onCutout?: (state: 'loading' | 'ready' | 'failed') => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.video.muted = true; this.video.playsInline = true; this.video.setAttribute('playsinline', ''); this.video.autoplay = true;
  }

  /** One picture size for everyone (11-28): 720 wide. There is no lower tier; a phone that can't keep up uses Simple camera. */
  get size() { return { w: 720, h: 1280 }; }
  /** Bytes the running take has caught so far (the recorder hands over a piece every second). */
  get bytes() { let n = 0; for (const c of this.chunks) n += c.size; return this.rec ? n : 0; }

  /** true when this studio runs on the mic alone (no camera on this device, or the person chose voice only) */
  noCam = false;

  async open(opts: { facing?: 'user' | 'environment'; noCam?: boolean } = {}) {
    if (opts.facing) this.facing = opts.facing;
    if (opts.noCam !== undefined) this.noCam = opts.noCam;
    const { w, h } = this.size;
    if (this.noCam) { await acquireMic(); if (shared.cam) shared.cam.enabled = false; }
    else await acquire(this.facing);
    this.attach();
    // with no camera there is nothing to play, and play() on an empty video never settles
    if (!this.noCam) await this.video.play().catch(() => { /* iOS needs a gesture sometimes; frames still flow */ });
    this.canvas.width = w; this.canvas.height = h;
    this.overlay.width = w; this.overlay.height = h; this.ovDirty = true;
    if (!this.gl && !this.simple) this.initGL();
    cancelAnimationFrame(this.raf);
    const loop = () => { this.draw(); this.raf = requestAnimationFrame(loop); };
    loop();
  }

  private attach() {
    const cam = this.noCam ? null : shared.cam;
    this.stream = new MediaStream([cam, shared.mic].filter(Boolean) as MediaStreamTrack[]);
    this.video.srcObject = cam ? new MediaStream([cam]) : null;
  }

  /** Can the camera switch while recording? Not in Simple camera (the recorder holds the camera track itself). */
  get canFlipLive() { return !this.noCam && (!this.recording || (this.recKind === 'video' && this.glOk)); }

  /** Swap front/back. Works mid-recording: the recorder records the canvas, so only the picture source
   *  changes; the mic is never touched. The canvas holds its last frame until the new camera is up. */
  async flip() {
    if (!this.canFlipLive) return false;
    const next = this.facing === 'user' ? 'environment' : 'user';
    this.swapping = true;
    try {
      await acquire(next, true);
      this.facing = next;
      this.attach();
      await this.video.play().catch(() => {});
      await waitFrames(this.video);
      return true;
    } catch (e) {
      console.warn('flip failed', e);
      await acquire(this.facing, true).catch(() => {});
      this.attach(); void this.video.play().catch(() => {});
      return false;
    } finally { this.swapping = false; }
  }

  // One small program per look, built the first time it's used. A single program holding every look
  // would make some phones pay for all of them on every frame.
  private progs = new Map<number, { prog: WebGLProgram; uni: Record<string, WebGLUniformLocation | null> } | null>();
  private program(idx: number): { prog: WebGLProgram; uni: Record<string, WebGLUniformLocation | null> } {
    const gl = this.gl!;
    if (this.progs.has(idx)) return this.progs.get(idx) || this.progs.get(0)!;
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader'); return s; };
    try {
      const prog = gl.createProgram()!;
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS.replace('uniform int look;', `const int look = ${idx};`)));
      gl.bindAttribLocation(prog, 0, 'p');
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
      const uni: Record<string, WebGLUniformLocation | null> = {};
      for (const n of ['vid', 'ov', 'prev', 'mask', 'crop', 'mirror', 't', 'res', 'amt', 'lvl', 'ctr', 'hasMask']) uni[n] = gl.getUniformLocation(prog, n);
      gl.useProgram(prog);
      gl.uniform1i(uni.vid, 0); gl.uniform1i(uni.ov, 1); gl.uniform1i(uni.prev, 2); gl.uniform1i(uni.mask, 3);
      const out = { prog, uni }; this.progs.set(idx, out); return out;
    } catch (e) {
      console.warn('shader', LOOKS[idx]?.id, e);
      if (idx === 0) throw e;
      this.progs.set(idx, null); return this.program(0);
    }
  }

  private initGL() {
    const gl = this.canvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false });
    if (!gl) return;
    try {
      this.gl = gl;
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const mk = (unit: number) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
      this.texV = mk(0); this.texO = mk(1); this.texP = mk(2); this.texM = mk(3);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array([255]));
      this.program(0);
      this.glOk = true;
    } catch (e) { console.warn('webgl off', e); this.glOk = false; this.gl = null; }
  }

  private drawOverlay() {
    const c = this.overlay.getContext('2d')!; const { width: W, height: H } = this.overlay;
    c.clearRect(0, 0, W, H);
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const s of [...this.strokes, ...(this.live ? [this.live] : [])]) {
      if (!s.pts.length) continue;
      c.strokeStyle = s.color; c.lineWidth = s.width * (W / 540);
      c.shadowColor = 'rgba(0,0,0,.25)'; c.shadowBlur = 6;
      c.beginPath(); c.moveTo(s.pts[0][0] * W, s.pts[0][1] * H);
      for (let i = 1; i < s.pts.length; i++) {
        const [x0, y0] = s.pts[i - 1], [x1, y1] = s.pts[i];
        c.quadraticCurveTo(x0 * W, y0 * H, ((x0 + x1) / 2) * W, ((y0 + y1) / 2) * H);
      }
      if (s.pts.length === 1) c.lineTo(s.pts[0][0] * W + 0.1, s.pts[0][1] * H);
      c.stroke();
    }
    c.shadowBlur = 0;
    const t = this.text;
    if (t && t.text.trim()) {
      const scale = W / 540; const y = t.y * H;
      const font = t.style === 'type' ? `700 ${30 * scale}px "Chivo Mono", ui-monospace, Menlo, monospace` : t.style === 'bold' ? `400 ${52 * scale}px "Tilt Warp", "Arial Black", system-ui, sans-serif` : `700 ${34 * scale}px Figtree, system-ui, sans-serif`;
      c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle';
      const lines = wrap(c, t.text.trim(), W * 0.84);
      const lh = (t.style === 'bold' ? 58 : 42) * scale;
      lines.forEach((ln, i) => {
        const ly = y + (i - (lines.length - 1) / 2) * lh;
        if (t.style === 'pill' || t.style === 'type') {
          const mw = c.measureText(ln).width + 28 * scale;
          c.fillStyle = t.style === 'type' ? 'rgba(0,0,0,.72)' : t.color;
          roundRect(c, W / 2 - mw / 2, ly - lh / 2 + 2 * scale, mw, lh - 4 * scale, 12 * scale); c.fill();
          c.fillStyle = t.style === 'type' ? '#fff' : contrast(t.color);
          c.fillText(ln, W / 2, ly + 1);
        } else {
          c.lineWidth = 8 * scale; c.strokeStyle = 'rgba(0,0,0,.55)'; c.strokeText(ln, W / 2, ly);
          c.fillStyle = t.color; c.fillText(ln, W / 2, ly);
        }
      });
    }
    const k = this.card;
    if (k) {
      // phones crop the sides of the 9:16 frame and the side rail covers the right, so keep the card left of centre
      const s = W / 540, x = 0.12 * W, y = 190 * s, w = 0.64 * W, pad = 20 * s;
      c.save(); c.translate(x + w / 2, y); c.rotate(-0.03); c.translate(-(x + w / 2), -y);
      c.textAlign = 'left'; c.textBaseline = 'alphabetic';
      // long cards (a Poker Face question) step the type down so every word fits in six lines
      let fs = 32, lines: string[] = [];
      for (fs of [32, 27, 23]) {
        c.font = `400 ${fs * s}px "Tilt Warp", "Arial Black", system-ui, sans-serif`;
        lines = wrap(c, k.text, w - pad * 2, 12);
        if (lines.length <= 6) break;
      }
      lines = lines.slice(0, 7);
      const lh = (fs + 3) * s, ofs = 19, olh = 30 * s, opts = k.opts || [];
      const oh = opts.length ? opts.length * olh + 10 * s : 0;
      const h = pad + 22 * s + 14 * s + lines.length * lh + oh + 34 * s + pad * 0.6;
      c.fillStyle = '#f7f6fb'; roundRect(c, x, y, w, h, 18 * s); c.fill();
      c.lineWidth = 3 * s; c.strokeStyle = '#15121c'; c.stroke();
      c.fillStyle = 'rgba(21,18,28,.72)'; c.font = `700 ${17 * s}px Figtree, system-ui, sans-serif`;
      c.fillText(k.label.toUpperCase().split('').join(String.fromCharCode(8202)), x + pad, y + pad + 16 * s);
      c.fillStyle = '#15121c'; c.font = `400 ${fs * s}px "Tilt Warp", "Arial Black", system-ui, sans-serif`;
      lines.forEach((ln, i) => c.fillText(ln, x + pad, y + pad + 22 * s + 14 * s + (i + 0.8) * lh));
      const oy = y + pad + 22 * s + 14 * s + lines.length * lh + 10 * s;
      opts.forEach((o, i) => {
        const on = k.picked === i, ry = oy + i * olh;
        if (on) { c.fillStyle = '#15121c'; roundRect(c, x + pad - 8 * s, ry, w - pad * 2 + 16 * s, olh - 4 * s, 10 * s); c.fill(); }
        c.fillStyle = on ? '#f7f6fb' : '#15121c'; c.font = `700 ${ofs * s}px Figtree, system-ui, sans-serif`;
        const label = `${'ABCD'[i]}  ${o}`;
        let t = label; while (t.length > 4 && c.measureText(t).width > w - pad * 2) t = t.slice(0, -2);
        c.fillText(t === label ? t : t + '...', x + pad, ry + olh * 0.66);
      });
      c.fillStyle = 'rgba(21,18,28,.62)'; c.font = `500 ${18 * s}px Figtree, system-ui, sans-serif`;
      c.fillText(k.sub, x + pad, y + h - pad * 0.9);
      c.restore();
    }
  }

  markDirty() { this.ovDirty = true; }
  /** Switch to the plain camera right now (no effects). */
  goSimple() { this.simple = true; this.glOk = false; }

  private draw() {
    this.meterTick();
    const v = this.video; const gl = this.gl;
    if (!v.videoWidth || this.swapping) return;
    const { width: W, height: H } = this.canvas;
    if (this.ovDirty) { this.drawOverlay(); }
    if (gl && this.glOk) {
      gl.viewport(0, 0, W, H);
      // cover-crop the camera into the portrait frame
      const va = v.videoWidth / v.videoHeight, ca = W / H;
      let cw = 1, ch = 1;
      if (va > ca) cw = ca / va; else ch = va / ca;
      const L = lookOf(this.look);
      const pr = this.program(Math.max(0, LOOKS.indexOf(L))); const U = pr.uni;
      gl.useProgram(pr.prog);
      gl.uniform4f(U.crop, (1 - cw) / 2, (1 - ch) / 2, cw, ch);
      gl.uniform1f(U.mirror, this.facing === 'user' ? 1 : 0);
      gl.uniform1f(U.t, (performance.now() / 1000) % 1000);
      gl.uniform2f(U.res, W, H);
      gl.uniform1f(U.amt, this.amt);
      gl.uniform1f(U.lvl, this.level);
      gl.uniform2f(U.ctr, this.ctr[0], 1 - this.ctr[1]);
      if (L.seg) {
        this.cut.tick(v);
        if (this.cut.fresh && this.cut.data) {
          gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.texM);
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, this.cut.w, this.cut.h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, this.cut.data);
          this.cut.fresh = false; this.hasMask = true;
        }
      }
      gl.uniform1f(U.hasMask, L.seg && this.hasMask ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texV);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, v);
      if (this.ovDirty) {
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texO);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.overlay);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (L.history) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.texP); gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGB, 0, 0, W, H, 0); }
    }
    this.ovDirty = false;
  }

  private meterBuf: Uint8Array<ArrayBuffer> | null = null;
  private meterTick() {
    const an = this.analyser || this.meter?.an;
    if (an) {
      if (!this.meterBuf || this.meterBuf.length !== an.fftSize) this.meterBuf = new Uint8Array(an.fftSize);
      const a = this.meterBuf; an.getByteTimeDomainData(a);
      let m = 0; for (const x of a) m = Math.max(m, Math.abs(x - 128));
      const raw = Math.min(1, (m / 128) * 2.2);
      this.level = raw > this.level ? this.level * 0.4 + raw * 0.6 : this.level * 0.9 + raw * 0.1;
      if (this.analyser) this.onLevel?.(m / 128);
    } else this.level *= 0.9;
  }

  /** One second of silent canvas recording, decoded and checked for real pixels. Some phones record
   *  black from a canvas; on those we fall back to the plain camera. true = safe, false = black, null = couldn't tell. */
  private testP: Promise<boolean | null> | null = null;
  /** The one-time check below records too; a real take waits for it rather than running two recorders at once. */
  selfTest(): Promise<boolean | null> {
    if (!this.testP) this.testP = this.runSelfTest().finally(() => { this.testP = null; });
    return this.testP;
  }
  private async runSelfTest(): Promise<boolean | null> {
    if (!this.glOk || !this.canvas.captureStream || typeof MediaRecorder === 'undefined') return true;
    try {
      const avg = (src: CanvasImageSource, w: number, h: number) => {
        const c = document.createElement('canvas'); c.width = 32; c.height = 32;
        const g = c.getContext('2d')!; g.drawImage(src, 0, 0, w, h, 0, 0, 32, 32);
        const d = g.getImageData(0, 0, 32, 32).data; let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
        return sum / (32 * 32 * 3);
      };
      const live = avg(this.canvas, this.canvas.width, this.canvas.height);
      if (live < 12) return true; // camera itself is dark (lens covered): can't judge
      const { mime } = pickMime('video');
      const cs = this.canvas.captureStream(30);
      const rec = new MediaRecorder(cs, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = []; rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      rec.start(300); await new Promise(r => setTimeout(r, 1300));
      await new Promise<void>(r => { rec.onstop = () => r(); rec.stop(); });
      cs.getTracks().forEach(t => t.stop());
      const url = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType || mime }));
      const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.src = url;
      try {
        // iPhones won't load a video's frames until it plays, so play it (muted is always allowed)
        const ready = new Promise<boolean>(res => { v.onplaying = () => res(true); v.onerror = () => res(false); setTimeout(() => res(false), 5000); });
        v.play().catch(() => {});
        if (!(await ready) || !v.videoWidth) return null;
        await new Promise(r => setTimeout(r, 450));
        v.pause();
        const got = avg(v, v.videoWidth, v.videoHeight);
        return got > Math.min(10, live * 0.3);
      } finally { URL.revokeObjectURL(url); }
    } catch { return null; }
  }

  get recording() { return !!this.rec && this.rec.state !== 'inactive'; }
  /** A take exists, even one the phone stopped on its own (a camera swap or a hiccup can end an iPhone
   *  recorder mid-take); what it caught can still be sent. */
  get hasTake() { return !!this.rec; }
  /** When the phone stopped the take by itself, so the length is what was really caught. */
  private endedAt = 0;
  get paused() { return !!this.rec && this.rec.state === 'paused'; }
  private pausedMs = 0;
  private pausedAt = 0;
  /** Seconds recorded so far, not counting time spent paused. */
  elapsed() {
    if (!this.rec) return 0;
    const now = this.endedAt || this.pausedAt || performance.now();
    return (now - this.t0 - this.pausedMs) / 1000;
  }
  pause() {
    if (!this.rec || this.rec.state !== 'recording') return false;
    try { this.rec.pause(); this.pausedAt = performance.now(); return true; } catch { return false; }
  }
  resume() {
    if (!this.rec || this.rec.state !== 'paused') return false;
    try { this.rec.resume(); this.pausedMs += performance.now() - this.pausedAt; this.pausedAt = 0; return true; } catch { return false; }
  }
  get canPause() { return typeof MediaRecorder !== 'undefined' && 'pause' in MediaRecorder.prototype; }

  async start(kind: 'video' | 'audio' = 'video', opts: { videoBits?: number } = {}) {
    if (this.testP) await this.testP.catch(() => null);
    if (!this.stream) throw new Error('camera off');
    if (this.noCam) kind = 'audio';
    if (this.recording) throw new Error('already recording');
    this.recKind = kind;
    const mic = this.stream.getAudioTracks()[0];
    let audioTrack: MediaStreamTrack | undefined = mic;
    this.looksUsed = new Set([this.look]); this.voicesUsed = new Set([this.voice]);
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      if (ctx.state === 'suspended') await ctx.resume();
      if (ctx.state !== 'running') throw new Error('audio asleep');
      const src = ctx.createMediaStreamSource(new MediaStream([mic]));
      const an = ctx.createAnalyser(); an.fftSize = 512; this.analyser = an;
      const dest = ctx.createMediaStreamDestination();
      const bus = ctx.createGain(); bus.connect(dest); bus.connect(an);
      this.recSrc = src; this.bus = bus;
      this.audio = { ctx, stop: () => { this.voiceNode?.stop(); this.voiceNode = null; this.recSrc = null; this.bus = null; } };
      await this.routeVoice(this.voice);
      audioTrack = dest.stream.getAudioTracks()[0];
    } catch (e) { console.warn('voice off', e); audioTrack = mic; this.audio?.ctx.close().catch(() => {}); this.audio = null; this.analyser = null; }

    let tracks: MediaStreamTrack[] = [];
    if (kind === 'video') {
      let vt: MediaStreamTrack | undefined;
      if (this.glOk && this.canvas.captureStream) { vt = this.canvas.captureStream(30).getVideoTracks()[0]; this.capTrack = vt || null; }
      if (!vt) vt = this.stream.getVideoTracks()[0];
      tracks = [vt];
    }
    if (audioTrack) tracks.push(audioTrack);
    const { mime, ext } = pickMime(kind);
    const bits = kind === 'audio' ? { audioBitsPerSecond: AUDIO_BITS } : { videoBitsPerSecond: opts.videoBits ?? VIDEO_BITS, audioBitsPerSecond: AUDIO_BITS };
    const rec = new MediaRecorder(new MediaStream(tracks), mime ? { mimeType: mime, ...bits } : bits);
    // each recorder keeps its own pieces, so one take can never pick up (or wipe) another's
    const chunks: Blob[] = []; this.chunks = chunks; (rec as unknown as { _chunks: Blob[] })._chunks = chunks;
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    // the phone ending the take by itself (error, a track that died): note when, so the length is right
    const ended = () => { if (this.rec === rec && !this.endedAt && !this.stopping) this.endedAt = performance.now(); };
    rec.addEventListener('stop', ended); rec.addEventListener('error', ended);
    rec.start(1000);
    this.rec = rec; this.t0 = performance.now(); this.pausedMs = 0; this.pausedAt = 0; this.endedAt = 0;
    (rec as unknown as { _ext: string })._ext = ext;
    this.thumbP = kind === 'video' ? new Promise(res => setTimeout(() => this.snapshot().then(res), 450)) : Promise.resolve(null);
  }

  /** Put a voice chain between the mic and the recorder; swaps cleanly mid-recording. */
  private async routeVoice(voice: VoiceId) {
    const ctx = this.audio?.ctx; const src = this.recSrc; const bus = this.bus;
    if (!ctx || !src || !bus) return;
    const inG = ctx.createGain(); const outG = ctx.createGain(); outG.connect(bus);
    const stop = await buildVoice(ctx, inG, outG, voice);
    src.connect(inG);
    const old = this.voiceNode; this.voiceNode = { inG, outG, stop };
    if (old) { try { src.disconnect(old.inG); } catch { /* */ } old.outG.disconnect(); old.stop(); }
  }
  async setVoice(v: VoiceId) {
    this.voice = v;
    if (this.recording && this.recSrc) { this.voicesUsed.add(v); await this.routeVoice(v); }
  }
  setLook(id: LookId) {
    this.look = id;
    if (this.recording) this.looksUsed.add(id);
    const L = lookOf(id);
    if (L.seg) { this.onCutout?.('loading'); void loadSegmenter().then(sg => this.onCutout?.(sg ? 'ready' : 'failed')); }
    if (L.voice) this.ensureMeter(); else this.stopMeter();
  }
  /** A light mic meter for voice-reactive looks while not recording. Needs a tap first on iPhone. */
  ensureMeter() {
    if (this.meter || !this.stream?.getAudioTracks()[0]) return;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC(); const src = ctx.createMediaStreamSource(new MediaStream([this.stream.getAudioTracks()[0]]));
      const an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
      this.meter = { ctx, an, src };
    } catch { /* no meter, looks still work */ }
  }
  wake() { if (this.meter?.ctx.state === 'suspended') void this.meter.ctx.resume(); }
  private stopMeter() { if (this.meter) { this.meter.ctx.close().catch(() => {}); this.meter = null; } }

  snapshot(q = 0.72): Promise<Blob | null> {
    let src: HTMLCanvasElement = this.canvas;
    if (!this.glOk) {
      // plain camera: cover-crop a frame from the video itself
      const v = this.video; const { w, h } = this.size;
      if (!v.videoWidth) return Promise.resolve(null);
      const c = document.createElement('canvas'); c.width = w / 2; c.height = h / 2;
      const s = Math.max(c.width / v.videoWidth, c.height / v.videoHeight);
      const g = c.getContext('2d')!;
      if (this.facing === 'user') { g.translate(c.width, 0); g.scale(-1, 1); }
      g.drawImage(v, (c.width - v.videoWidth * s) / 2, (c.height - v.videoHeight * s) / 2, v.videoWidth * s, v.videoHeight * s);
      src = c;
    }
    return new Promise(res => { try { src.toBlob(b => res(b), 'image/jpeg', q); } catch { res(null); } });
  }

  async stop(): Promise<Recording | null> {
    const rec = this.rec; if (!rec) return null;
    const duration = this.elapsed();
    this.stopping = true;
    // never hang here: a recorder the phone already stopped fires no second 'stop', and an iPhone
    // recorder has been seen to never answer at all, which left the screen stuck on recording
    if (rec.state !== 'inactive') {
      if (rec.state === 'paused') { try { rec.resume(); } catch { /* */ } }
      const done = new Promise<void>(r => { rec.addEventListener('stop', () => r(), { once: true }); setTimeout(r, 3000); });
      try { rec.stop(); } catch { /* already stopped */ }
      await done;
    }
    this.stopping = false;
    if (this.rec === rec) {
      this.rec = null; this.endedAt = 0; this.analyser = null; this.dropCapTrack();
      this.audio?.stop(); this.audio?.ctx.close().catch(() => {}); this.audio = null;
    }
    const chunks = (rec as unknown as { _chunks?: Blob[] })._chunks || this.chunks;
    const mime = (rec.mimeType || chunks[0]?.type || (this.recKind === 'video' ? 'video/mp4' : 'audio/mp4')).split(';')[0];
    const blob = new Blob(chunks, { type: mime });
    const ext = mime.includes('webm') ? 'webm' : this.recKind === 'audio' ? 'm4a' : 'mp4';
    const thumb = await Promise.race([this.thumbP, new Promise<null>(r => setTimeout(() => r(null), 1500))]);
    const { w, h } = this.size;
    return { blob, mime, ext, duration, w, h, thumb, kind: this.recKind,
      effects: { look: this.look, voice: this.voice, looks: [...this.looksUsed], voices: [...this.voicesUsed], text: this.text?.text || null, card: this.card ? this.card.text : undefined, scribbles: this.strokes.length > 0 } };
  }

  // the canvas track made for a take; stopped after it so they don't pile up over a session
  private capTrack: MediaStreamTrack | null = null;
  private dropCapTrack() { this.capTrack?.stop(); this.capTrack = null; }

  cancel() {
    this.dropCapTrack();
    if (this.rec) { this.rec.ondataavailable = null; this.stopping = true; try { this.rec.stop(); } catch { /* */ } this.stopping = false; this.rec = null; this.endedAt = 0; }
    this.audio?.stop(); this.audio?.ctx.close().catch(() => {}); this.audio = null; this.analyser = null;
  }

  /** Leave the camera. Tracks are paused, not stopped, so coming back never asks for permission again. */
  close() {
    cancelAnimationFrame(this.raf); this.cancel(); this.stopMeter(); this.video.srcObject = null; this.stream = null; pauseMedia();
  }
  /** Leaving the chat for good: also hand the WebGL context back (iPhone only allows a few, and every chat opened makes one). */
  dispose() {
    this.close();
    try { this.gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* */ }
  }
}

// ---- one camera + mic for the whole app session ----
// iPhones ask for camera and mic again whenever a page stops its tracks and asks anew. So the app asks
// once and keeps the tracks for as long as the page lives. The camera is switched off (enabled = false,
// which turns the camera light off) when no chat is open. The mic is never switched off and on: on
// iPhone every mic mute and unmute plays a loud system sound, which rang out each time Holler opened
// or a chat closed (11-27). Flipping swaps the camera track only.
const shared: { cam: MediaStreamTrack | null; mic: MediaStreamTrack | null; facing: string } = { cam: null, mic: null, facing: '' };
const live = (t: MediaStreamTrack | null): boolean => !!t && t.readyState === 'live';
const camConstraints = (facing: string): MediaTrackConstraints =>
  ({ facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } });
const micConstraints: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

async function acquire(facing: string, forceCam = false) {
  cancelRelease();
  const camOk = live(shared.cam) && shared.facing === facing && !forceCam;
  if (camOk && live(shared.mic)) { shared.cam!.enabled = true; return; }
  if (live(shared.mic)) {
    // mic is still held, so this page is still capturing: a camera-only ask doesn't prompt again.
    // Phones can only run one camera at a time, so stop the old one first.
    if (!camOk) {
      shared.cam?.stop(); shared.cam = null;
      const s = await navigator.mediaDevices.getUserMedia({ video: camConstraints(facing) });
      shared.cam = s.getVideoTracks()[0];
    }
    shared.cam!.enabled = true; shared.facing = facing;
    return;
  }
  shared.cam?.stop(); shared.mic?.stop(); shared.cam = shared.mic = null;
  const s = await navigator.mediaDevices.getUserMedia({ video: camConstraints(facing), audio: micConstraints });
  shared.cam = s.getVideoTracks()[0]; shared.mic = s.getAudioTracks()[0]; shared.facing = facing;
}

/** Mic only (voice-only mode): asks for the mic alone, and never for the camera. */
async function acquireMic() {
  cancelRelease();
  if (live(shared.mic)) return;
  shared.mic?.stop(); shared.mic = null;
  const s = await navigator.mediaDevices.getUserMedia({ audio: micConstraints });
  shared.mic = s.getAudioTracks()[0];
}

/** Let go of the camera and mic altogether (notes-only mode). Stopping is not muting, so no mute sound. */
export function releaseMedia() { shared.cam?.stop(); shared.mic?.stop(); shared.cam = shared.mic = null; shared.facing = ''; }

// ---- letting go after a quiet spell (11-27 round two) ----
// Stopping both tracks puts the mic dot out, but the next ask after that prompts again on iPhone. So the app lets
// go only once the camera has slept for a while: a wake (acquire) before then cancels it. The timer lives here, not
// in a room, so it outlives the room. It never lets go while anything registered with holdWhile says it is busy
// (an open camera, a take): it waits another spell and checks again.
let relT = 0;
const busy = new Set<() => boolean>();
/** Register a check that holds the tracks while it returns true. Returns the unregister. */
export function holdWhile(fn: () => boolean): () => void { busy.add(fn); return () => { busy.delete(fn); }; }
export function cancelRelease() { if (relT) clearTimeout(relT); relT = 0; }
/** Stop both tracks after ms of quiet, unless a wake cancels it first. */
export function releaseSoon(ms: number) {
  cancelRelease();
  const fire = () => {
    relT = 0;
    if ([...busy].some(f => { try { return f(); } catch { return false; } })) { relT = window.setTimeout(fire, ms); return; }
    releaseMedia();
  };
  relT = window.setTimeout(fire, ms);
}

/** Camera light off, permission kept. The mic is left alone (see above): nothing records unless a take is running. */
export function pauseMedia() { if (shared.cam) shared.cam.enabled = false; }

function waitFrames(v: HTMLVideoElement) {
  return new Promise<void>(res => {
    const t = setTimeout(res, 1500);
    const r = v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    if (r.requestVideoFrameCallback) r.requestVideoFrameCallback(() => { clearTimeout(t); res(); });
    else { const tick = () => { if (v.videoWidth && v.readyState >= 2) { clearTimeout(t); setTimeout(res, 120); } else requestAnimationFrame(tick); }; tick(); }
  });
}

function wrap(c: CanvasRenderingContext2D, text: string, max: number, limit = 5) {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const w of para.split(' ')) {
      const test = line ? line + ' ' + w : w;
      if (c.measureText(test).width > max && line) { out.push(line); line = w; } else line = test;
    }
    out.push(line);
  }
  return out.slice(0, limit);
}
function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function contrast(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16); const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111' : '#fff';
}

/** Make a poster frame + duration for a picked file. */
export async function probeFile(file: File): Promise<{ duration: number; w: number; h: number; thumb: Blob | null }> {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.src = url;
  try {
    await new Promise<void>((res, rej) => { v.onloadedmetadata = () => res(); v.onerror = () => rej(new Error('cannot read that video')); setTimeout(res, 6000); });
    v.currentTime = Math.min(0.3, (v.duration || 1) / 2);
    await new Promise<void>(res => { v.onseeked = () => res(); setTimeout(res, 2500); });
    const c = document.createElement('canvas'); const s = 540 / Math.max(1, v.videoWidth);
    c.width = Math.round(v.videoWidth * s) || 540; c.height = Math.round(v.videoHeight * s) || 960;
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
    const thumb = await new Promise<Blob | null>(r => c.toBlob(b => r(b), 'image/jpeg', 0.72));
    return { duration: isFinite(v.duration) ? v.duration : 0, w: v.videoWidth, h: v.videoHeight, thumb };
  } finally { URL.revokeObjectURL(url); }
}
