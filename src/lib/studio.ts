// The camera studio: camera -> WebGL (looks + mirror + overlay of scribbles and text) -> canvas,
// mic -> voice filter -> recorder. Falls back to recording the raw camera when the canvas path fails.
import { buildVoice, type VoiceId } from './voice';

export const LOOKS = [
  { id: 'none', label: 'Natural' },
  { id: 'warm', label: 'Golden hour' },
  { id: 'film', label: 'Film' },
  { id: 'vivid', label: 'Vivid' },
  { id: 'cool', label: 'Blue hour' },
  { id: 'mono', label: 'Mono' },
  { id: 'noir', label: 'Noir' },
  { id: 'dream', label: 'Dreamy' },
  { id: 'retro', label: 'VHS' },
  { id: 'pop', label: 'Comic' },
] as const;
export type LookId = (typeof LOOKS)[number]['id'];

export type Stroke = { color: string; width: number; pts: [number, number][] };
export type TextLayer = { text: string; y: number; style: 'pill' | 'bold' | 'type'; color: string } | null;

export type Recording = {
  blob: Blob; mime: string; ext: string; duration: number; w: number; h: number; thumb: Blob | null;
  kind: 'video' | 'audio'; effects: Record<string, unknown>;
};

const VS = `attribute vec2 p; varying vec2 uv; void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`;
const FS = `precision mediump float;
varying vec2 uv; uniform sampler2D vid; uniform sampler2D ov; uniform vec4 crop; uniform float mirror; uniform int look; uniform float t; uniform vec2 res;
float lum(vec3 c){ return dot(c, vec3(.299,.587,.114)); }
float rnd(vec2 co){ return fract(sin(dot(co, vec2(12.9898,78.233)) + t) * 43758.5453); }
vec3 sat(vec3 c, float s){ return mix(vec3(lum(c)), c, s); }
vec3 sampleV(vec2 q){ vec2 u = vec2(q.x, 1.-q.y); if (mirror > .5) u.x = 1.-u.x; return texture2D(vid, crop.xy + u*crop.zw).rgb; }
void main(){
  vec2 q = uv; vec3 c;
  if (look == 8) { float o = 2.5/res.x; c = vec3(sampleV(q+vec2(o,0.)).r, sampleV(q).g, sampleV(q-vec2(o,0.)).b); }
  else c = sampleV(q);
  float vig = smoothstep(1.15, .35, length(q-.5)*1.4);
  if (look == 1) { c = c*vec3(1.08,1.0,.86) + vec3(.03,.015,0.); c = sat(c,1.12); c *= mix(.8,1.,vig); }
  else if (look == 2) { c = mix(vec3(.08,.06,.07), vec3(.97,.93,.86), c); c = sat(c,.82); c.r = pow(c.r,.95); c.b = pow(c.b,1.08); c += (rnd(q*res)-.5)*.07; c *= mix(.72,1.,vig); }
  else if (look == 3) { c = sat(c,1.45); c = (c-.5)*1.12+.5; }
  else if (look == 4) { c = c*vec3(.88,.98,1.12) + vec3(0.,.01,.04); c = sat(c,.9); }
  else if (look == 5) { float l = lum(c); l = (l-.5)*1.1+.5; c = vec3(l); }
  else if (look == 6) { float l = lum(c); l = smoothstep(.12,.88,l); c = vec3(l)*mix(.45,1.,vig); c += (rnd(q*res)-.5)*.06; }
  else if (look == 7) { vec3 b = vec3(0.); float k = 3./res.x; for (int i=-2;i<=2;i++) for (int j=-2;j<=2;j++) b += sampleV(q+vec2(float(i),float(j))*k*2.); b/=25.; c = max(c, b*1.1); c = mix(c, vec3(1.,.86,.92), .12); c = sat(c,.9)*1.04; }
  else if (look == 8) { c = sat(c,1.25); c *= .9 + .1*sin(q.y*res.y*1.6); c += (rnd(vec2(q.y*40., t))-.5)*.05; c = mix(c, c*vec3(1.05,.95,1.1), .5); c *= mix(.7,1.,vig); }
  else if (look == 9) { c = sat(c,1.6); c = floor(c*5.)/5.; float e = length(sampleV(q+vec2(1.5/res.x,0.)) - sampleV(q-vec2(1.5/res.x,0.))) + length(sampleV(q+vec2(0.,1.5/res.y)) - sampleV(q-vec2(0.,1.5/res.y))); c *= 1. - smoothstep(.18,.4,e); }
  vec4 o = texture2D(ov, vec2(q.x, 1.-q.y));
  gl_FragColor = vec4(mix(c, o.rgb, o.a), 1.);
}`;

function pickMime(kind: 'video' | 'audio'): { mime: string; ext: string } {
  const R = typeof MediaRecorder !== 'undefined' ? MediaRecorder : null;
  const list = kind === 'video'
    ? [['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'mp4'], ['video/mp4;codecs=avc1,mp4a', 'mp4'], ['video/mp4', 'mp4'],
       ['video/webm;codecs=vp9,opus', 'webm'], ['video/webm;codecs=vp8,opus', 'webm'], ['video/webm', 'webm']]
    : [['audio/mp4;codecs=mp4a.40.2', 'm4a'], ['audio/mp4', 'm4a'], ['audio/webm;codecs=opus', 'webm'], ['audio/webm', 'webm']];
  for (const [m, e] of list) if (R?.isTypeSupported?.(m)) return { mime: m, ext: e };
  return { mime: '', ext: kind === 'video' ? 'mp4' : 'm4a' };
}

export class Studio {
  canvas: HTMLCanvasElement;
  overlay = document.createElement('canvas');
  video = document.createElement('video');
  stream: MediaStream | null = null;
  facing: 'user' | 'environment' = 'user';
  hd = false;
  look: LookId = 'none';
  voice: VoiceId = 'none';
  strokes: Stroke[] = [];
  live: Stroke | null = null;
  text: TextLayer = null;
  glOk = false;
  private gl: WebGLRenderingContext | null = null;
  private texV: WebGLTexture | null = null;
  private texO: WebGLTexture | null = null;
  private uni: Record<string, WebGLUniformLocation | null> = {};
  private raf = 0;
  private ovDirty = true;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private t0 = 0;
  private audio: { ctx: AudioContext; stop: () => void } | null = null;
  private thumbP: Promise<Blob | null> | null = null;
  private recKind: 'video' | 'audio' = 'video';
  onLevel?: (v: number) => void;
  private analyser: AnalyserNode | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.video.muted = true; this.video.playsInline = true; this.video.setAttribute('playsinline', ''); this.video.autoplay = true;
  }

  get size() { return this.hd ? { w: 720, h: 1280 } : { w: 540, h: 960 }; }

  async open(opts: { facing?: 'user' | 'environment'; hd?: boolean } = {}) {
    if (opts.facing) this.facing = opts.facing;
    if (opts.hd !== undefined) this.hd = opts.hd;
    this.stopTracks();
    const { w, h } = this.size;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: this.facing, width: { ideal: this.hd ? 1280 : 960 }, height: { ideal: this.hd ? 720 : 540 }, frameRate: { ideal: 30 } },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.stream = stream;
    this.video.srcObject = stream;
    await this.video.play().catch(() => { /* iOS needs a gesture sometimes; frames still flow */ });
    this.canvas.width = w; this.canvas.height = h;
    this.overlay.width = w; this.overlay.height = h; this.ovDirty = true;
    if (!this.gl) this.initGL();
    cancelAnimationFrame(this.raf);
    const loop = () => { this.draw(); this.raf = requestAnimationFrame(loop); };
    loop();
  }

  async flip() { await this.open({ facing: this.facing === 'user' ? 'environment' : 'user' }); }
  async setHD(hd: boolean) { if (hd !== this.hd) await this.open({ hd }); }

  private initGL() {
    const gl = this.canvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false });
    if (!gl) return;
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader'); return s; };
    try {
      const prog = gl.createProgram()!;
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
      gl.useProgram(prog);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const mk = (unit: number) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
      this.texV = mk(0); this.texO = mk(1);
      for (const n of ['vid', 'ov', 'crop', 'mirror', 'look', 't', 'res']) this.uni[n] = gl.getUniformLocation(prog, n);
      gl.uniform1i(this.uni.vid, 0); gl.uniform1i(this.uni.ov, 1);
      this.gl = gl; this.glOk = true;
    } catch (e) { console.warn('webgl off', e); this.glOk = false; }
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
      const font = t.style === 'type' ? `600 ${30 * scale}px ui-monospace, Menlo, monospace` : `800 ${t.style === 'bold' ? 52 * scale : 34 * scale}px "Bricolage Grotesque", system-ui, sans-serif`;
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
  }

  markDirty() { this.ovDirty = true; }

  private draw() {
    const v = this.video; const gl = this.gl;
    if (!v.videoWidth) return;
    const { width: W, height: H } = this.canvas;
    if (this.ovDirty) { this.drawOverlay(); }
    if (gl && this.glOk) {
      gl.viewport(0, 0, W, H);
      // cover-crop the camera into the portrait frame
      const va = v.videoWidth / v.videoHeight, ca = W / H;
      let cw = 1, ch = 1;
      if (va > ca) cw = ca / va; else ch = va / ca;
      gl.uniform4f(this.uni.crop, (1 - cw) / 2, (1 - ch) / 2, cw, ch);
      gl.uniform1f(this.uni.mirror, this.facing === 'user' ? 1 : 0);
      gl.uniform1i(this.uni.look, Math.max(0, LOOKS.findIndex(l => l.id === this.look)));
      gl.uniform1f(this.uni.t, (performance.now() / 1000) % 100);
      gl.uniform2f(this.uni.res, W, H);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texV);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, v);
      if (this.ovDirty) {
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texO);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.overlay);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    this.ovDirty = false;
    if (this.analyser && this.onLevel) {
      const a = new Uint8Array(this.analyser.fftSize); this.analyser.getByteTimeDomainData(a);
      let m = 0; for (const x of a) m = Math.max(m, Math.abs(x - 128)); this.onLevel(m / 128);
    }
  }

  get recording() { return !!this.rec && this.rec.state === 'recording'; }
  elapsed() { return this.rec ? (performance.now() - this.t0) / 1000 : 0; }

  async start(kind: 'video' | 'audio' = 'video') {
    if (!this.stream) throw new Error('camera off');
    this.recKind = kind;
    const mic = this.stream.getAudioTracks()[0];
    let audioTrack: MediaStreamTrack | undefined = mic;
    // audio graph: voice filter + level meter
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      if (ctx.state === 'suspended') await ctx.resume();
      const src = ctx.createMediaStreamSource(new MediaStream([mic]));
      const an = ctx.createAnalyser(); an.fftSize = 512; this.analyser = an;
      if (this.voice !== 'none') {
        const dest = ctx.createMediaStreamDestination();
        const out = ctx.createGain(); out.connect(dest); out.connect(an);
        const stop = await buildVoice(ctx, src, out, this.voice);
        audioTrack = dest.stream.getAudioTracks()[0];
        this.audio = { ctx, stop };
      } else {
        src.connect(an);
        this.audio = { ctx, stop: () => {} };
      }
    } catch (e) { console.warn('voice off', e); audioTrack = mic; }

    let tracks: MediaStreamTrack[] = [];
    if (kind === 'video') {
      let vt: MediaStreamTrack | undefined;
      if (this.glOk && this.canvas.captureStream) vt = this.canvas.captureStream(30).getVideoTracks()[0];
      if (!vt) vt = this.stream.getVideoTracks()[0];
      tracks = [vt];
    }
    if (audioTrack) tracks.push(audioTrack);
    const { mime, ext } = pickMime(kind);
    const bits = kind === 'audio' ? { audioBitsPerSecond: 64000 } : { videoBitsPerSecond: this.hd ? 2_500_000 : 900_000, audioBitsPerSecond: 64000 };
    const rec = new MediaRecorder(new MediaStream(tracks), mime ? { mimeType: mime, ...bits } : bits);
    this.chunks = [];
    rec.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data); };
    rec.start(1000);
    this.rec = rec; this.t0 = performance.now();
    (rec as unknown as { _ext: string })._ext = ext;
    this.thumbP = kind === 'video' ? new Promise(res => setTimeout(() => this.snapshot().then(res), 450)) : Promise.resolve(null);
  }

  snapshot(q = 0.72): Promise<Blob | null> {
    return new Promise(res => { try { this.canvas.toBlob(b => res(b), 'image/jpeg', q); } catch { res(null); } });
  }

  async stop(): Promise<Recording | null> {
    const rec = this.rec; if (!rec) return null;
    const duration = (performance.now() - this.t0) / 1000;
    const done = new Promise<void>(r => { rec.onstop = () => r(); });
    try { rec.requestData(); } catch { /* not all browsers */ }
    rec.stop();
    await done;
    this.rec = null; this.analyser = null;
    this.audio?.stop(); this.audio?.ctx.close().catch(() => {}); this.audio = null;
    const mime = (rec.mimeType || this.chunks[0]?.type || (this.recKind === 'video' ? 'video/mp4' : 'audio/mp4')).split(';')[0];
    const blob = new Blob(this.chunks, { type: mime });
    const ext = mime.includes('webm') ? 'webm' : this.recKind === 'audio' ? 'm4a' : 'mp4';
    const thumb = await this.thumbP;
    const { w, h } = this.size;
    return { blob, mime, ext, duration, w, h, thumb, kind: this.recKind,
      effects: { look: this.look, voice: this.voice, text: this.text?.text || null, scribbles: this.strokes.length > 0, hd: this.hd } };
  }

  cancel() {
    if (this.rec) { this.rec.ondataavailable = null; try { this.rec.stop(); } catch { /* */ } this.rec = null; }
    this.audio?.stop(); this.audio?.ctx.close().catch(() => {}); this.audio = null; this.analyser = null;
  }

  private stopTracks() { this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; }
  close() { cancelAnimationFrame(this.raf); this.cancel(); this.stopTracks(); this.video.srcObject = null; }
}

function wrap(c: CanvasRenderingContext2D, text: string, max: number) {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const w of para.split(' ')) {
      const test = line ? line + ' ' + w : w;
      if (c.measureText(test).width > max && line) { out.push(line); line = w; } else line = test;
    }
    out.push(line);
  }
  return out.slice(0, 5);
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
