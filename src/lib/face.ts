// On-device smile spotting for Don't Laugh (Google MediaPipe face landmarker, free, runs in the phone's
// browser; nothing leaves the device). Loaded only when someone watches a Don't Laugh clip.

const V = '0.10.14';
const BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${V}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

type Cat = { categoryName: string; score: number };
type Landmarker = { detectForVideo(v: HTMLVideoElement, ts: number): { faceBlendshapes?: { categories: Cat[] }[] }; close(): void };

let lm: Landmarker | null = null;
let loading: Promise<Landmarker | null> | null = null;

export function loadFace(): Promise<Landmarker | null> {
  if (lm) return Promise.resolve(lm);
  if (!loading) loading = (async () => {
    try {
      const m = await import(/* @vite-ignore */ `${BASE}/vision_bundle.mjs`);
      const files = await m.FilesetResolver.forVisionTasks(`${BASE}/wasm`);
      const opts = (delegate: 'GPU' | 'CPU') => ({ baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true });
      try { lm = await m.FaceLandmarker.createFromOptions(files, opts('GPU')); }
      catch { lm = await m.FaceLandmarker.createFromOptions(files, opts('CPU')); }
      return lm;
    } catch (e) { console.warn('face off', e); loading = null; return null; }
  })();
  return loading;
}

/**
 * Watches one face for a smile. Call tick() often; it samples about 12 times a second.
 * The first second learns your resting face, so a naturally smiley face doesn't count as cracking.
 */
export class SmileWatch {
  smile = 0;          // 0..1, smoothed
  seen = false;       // a face has been found
  cracked = false;
  private base: number[] = [];
  private hot = 0;
  private last = 0;
  private t0 = performance.now();

  /** How far over the line a smile has to go. */
  get line() {
    const b = this.base.length ? [...this.base].sort((x, y) => x - y)[Math.floor(this.base.length / 2)] : 0;
    return Math.min(0.85, Math.max(0.42, b + 0.3));
  }

  tick(video: HTMLVideoElement): boolean {
    if (!lm || this.cracked || !video.videoWidth || video.readyState < 2) return this.cracked;
    const now = performance.now();
    if (now - this.last < 80) return false;
    this.last = now;
    try {
      const r = lm.detectForVideo(video, now);
      const cats = r.faceBlendshapes?.[0]?.categories;
      if (!cats) { this.hot = 0; return false; }
      this.seen = true;
      const s = (name: string) => cats.find(c => c.categoryName === name)?.score || 0;
      const raw = (s('mouthSmileLeft') + s('mouthSmileRight')) / 2;
      this.smile = this.smile * 0.4 + raw * 0.6;
      if (now - this.t0 < 1200) { this.base.push(raw); return false; }
      this.hot = this.smile > this.line ? this.hot + 1 : 0;
      if (this.hot >= 3) this.cracked = true;
    } catch { /* a dropped frame is fine */ }
    return this.cracked;
  }
}
