// Live captions while recording, through the browser's own speech recognition (free, on-device or
// browser-provided). Stored as timed segments so playback can show the line being said.
export type Seg = { t: number; text: string };

type SR = {
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
  start(): void; stop(): void; abort(): void;
};

export const speechSupported = () => typeof window !== 'undefined' && !!((window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition);
export const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export class Captioner {
  private sr: SR | null = null;
  private on = false;
  private t0 = 0;
  private segStart = 0;
  segs: Seg[] = [];
  interim = '';
  onChange?: () => void;

  start() {
    const C = (window as unknown as Record<string, new () => SR>).SpeechRecognition || (window as unknown as Record<string, new () => SR>).webkitSpeechRecognition;
    if (!C) return;
    this.on = true; this.t0 = performance.now(); this.segs = []; this.interim = ''; this.segStart = 0;
    const boot = () => {
      if (!this.on) return;
      const sr = new C(); sr.continuous = true; sr.interimResults = true; sr.lang = navigator.language || 'en-US';
      sr.onresult = e => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) {
            const text = r[0].transcript.trim();
            if (text) this.segs.push({ t: Math.max(0, this.segStart), text });
            this.segStart = (performance.now() - this.t0) / 1000;
          } else {
            if (!interim) this.segStart = this.segStart || (performance.now() - this.t0) / 1000 - 1;
            interim += r[0].transcript;
          }
        }
        this.interim = interim; this.onChange?.();
      };
      sr.onerror = () => { /* restarts in onend */ };
      sr.onend = () => { if (this.on) setTimeout(boot, 150); };
      try { sr.start(); this.sr = sr; } catch { /* already started */ }
    };
    boot();
  }

  stop(): Seg[] {
    this.on = false;
    try { this.sr?.stop(); } catch { /* */ }
    if (this.interim.trim()) this.segs.push({ t: Math.max(0, this.segStart), text: this.interim.trim() });
    this.interim = '';
    return this.segs;
  }
}

export function parseTranscript(s: string | null): Seg[] {
  if (!s) return [];
  try { const v = JSON.parse(s); if (Array.isArray(v)) return v; } catch { /* plain text */ }
  return [{ t: 0, text: s }];
}
export const transcriptText = (s: string | null) => parseTranscript(s).map(x => x.text).join(' ');
