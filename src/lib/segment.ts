// On-device cutout of the person in front of the camera (Google MediaPipe selfie segmenter, free,
// runs in the phone's browser; nothing leaves the device). Loaded only when a background look is
// picked. Produces a small 8-bit mask the camera shader reads.

const V = '0.10.14';
const BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${V}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

type Mask = { width: number; height: number; getAsFloat32Array(): Float32Array };
type Segmenter = { segmentForVideo(v: HTMLVideoElement, ts: number, cb: (r: { confidenceMasks?: Mask[] }) => void): void; close(): void };

let seg: Segmenter | null = null;
let loading: Promise<Segmenter | null> | null = null;
export let segFailed = false;

export function loadSegmenter(): Promise<Segmenter | null> {
  if (seg) return Promise.resolve(seg);
  if (!loading) loading = (async () => {
    try {
      const m = await import(/* @vite-ignore */ `${BASE}/vision_bundle.mjs`);
      const files = await m.FilesetResolver.forVisionTasks(`${BASE}/wasm`);
      const opts = (delegate: 'GPU' | 'CPU') => ({ baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true });
      try { seg = await m.ImageSegmenter.createFromOptions(files, opts('GPU')); }
      catch { seg = await m.ImageSegmenter.createFromOptions(files, opts('CPU')); }
      return seg;
    } catch (e) { console.warn('cutout off', e); segFailed = true; loading = null; return null; }
  })();
  return loading;
}

/** Keeps a smoothed mask (1 = person). Call tick() every frame; it runs the model about 20 times a second. */
export class Cutout {
  data: Uint8Array | null = null;
  w = 0; h = 0;
  fresh = false;
  private last = 0;
  private acc: Float32Array | null = null;
  private flip: boolean | null = null; // some model builds report background instead of person
  private checks = 0;

  tick(video: HTMLVideoElement) {
    if (!seg || !video.videoWidth || video.readyState < 2) return;
    const now = performance.now();
    if (now - this.last < 50) return;
    this.last = now;
    try {
      seg.segmentForVideo(video, now, r => {
        const m = r.confidenceMasks?.[0]; if (!m) return;
        const f = m.getAsFloat32Array();
        if (!this.acc || this.acc.length !== f.length) { this.acc = new Float32Array(f); this.data = new Uint8Array(f.length); this.w = m.width; this.h = m.height; }
        if (this.flip === null || this.checks < 10) this.learnOrientation(f, m.width, m.height);
        const inv = !!this.flip, a = this.acc, d = this.data!;
        for (let i = 0; i < f.length; i++) {
          const v = inv ? 1 - f[i] : f[i];
          a[i] = a[i] * 0.45 + v * 0.55;
          const s = Math.min(1, Math.max(0, (a[i] - 0.3) / 0.4)); // firm up the edge
          d[i] = s * 255;
        }
        this.fresh = true;
      });
    } catch { /* a dropped frame is fine */ }
  }

  // In a selfie the middle-bottom is almost always the person and the top corners almost never.
  private learnOrientation(f: Float32Array, w: number, h: number) {
    let mid = 0, corner = 0, n1 = 0, n2 = 0;
    for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) {
      const v = f[y * w + x];
      if (x > w * 0.35 && x < w * 0.65 && y > h * 0.45) { mid += v; n1++; }
      if (y < h * 0.15 && (x < w * 0.15 || x > w * 0.85)) { corner += v; n2++; }
    }
    if (n1 && n2) { const vote = corner / n2 > mid / n1; this.flip = this.flip === null ? vote : (this.checks < 10 ? vote : this.flip); this.checks++; }
  }
}
