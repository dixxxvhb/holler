// Film my reaction: your face records while their holler plays. Only your face is stored, plus a timeline
// of where their clip was (play, pause, seek, speed), so playback puts their holler beside yours in sync.
import { useEffect, useRef } from 'react';
import type { Studio } from '../lib/studio';

export type SyncPoint = { r: number; o: number; rate: number; playing: boolean };

/** Where the original should be when the reaction is at second r. */
export function origAt(sync: SyncPoint[], r: number): { t: number; playing: boolean } {
  let p: SyncPoint | undefined;
  for (const s of sync) { if (s.r <= r + 0.001) p = s; else break; }
  if (!p) return { t: 0, playing: false };
  return p.playing ? { t: p.o + (r - p.r) * p.rate, playing: true } : { t: p.o, playing: false };
}

export function readSync(effects: Record<string, unknown> | undefined): SyncPoint[] {
  const raw = effects?.sync;
  if (!Array.isArray(raw)) return [];
  return raw.filter(s => s && typeof s === 'object' && typeof (s as SyncPoint).r === 'number')
    .map(s => s as SyncPoint).sort((a, b) => a.r - b.r);
}

export const filmKey = (chat: string) => `holler.film.${chat}`;
export function filmOn(chat: string) { try { return localStorage.getItem(filmKey(chat)) === '1'; } catch { return false; } }
export function setFilm(chat: string, on: boolean) { try { localStorage.setItem(filmKey(chat), on ? '1' : '0'); } catch { /* private mode */ } }

/** Your live face, small, while filming. Uses the camera the chat screen already holds (never asks again). */
export function LiveFace({ studio, className }: { studio: Studio | null; className?: string }) {
  const v = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = v.current; const st = studio?.stream; if (!el || !st) return;
    el.srcObject = new MediaStream(st.getVideoTracks()); void el.play().catch(() => {});
    return () => { el.srcObject = null; };
  }, [studio]);
  return <video ref={v} muted playsInline className={`${className || ''} ${studio?.facing === 'user' ? 'mirror' : ''}`} />;
}

/** A second video that follows the main one through a sync timeline. `main` is the element whose clock leads. */
export function SyncedVideo({ src, sync, main, className, muted, onClick }: {
  src: string | null; sync: SyncPoint[]; main: () => HTMLVideoElement | null; className?: string; muted?: boolean; onClick?: () => void;
}) {
  const v = useRef<HTMLVideoElement>(null);
  useEffect(() => { const el = v.current; if (el && src) el.src = src; }, [src]);
  useEffect(() => {
    const i = window.setInterval(() => {
      const el = v.current; const m = main(); if (!el || !m || !src) return;
      const want = origAt(sync, m.currentTime);
      const dur = isFinite(el.duration) ? el.duration : Infinity;
      const play = want.playing && !m.paused && want.t < dur;
      const pt = [...sync].reverse().find(s => s.r <= m.currentTime);
      el.playbackRate = m.playbackRate * (pt?.rate || 1);
      if (Math.abs(el.currentTime - Math.min(want.t, dur)) > 0.35) { try { el.currentTime = Math.min(want.t, dur); } catch { /* not seekable yet */ } }
      if (play && el.paused) void el.play().catch(() => {});
      else if (!play && !el.paused) el.pause();
    }, 150);
    return () => clearInterval(i);
  }, [src, sync, main]);
  return <video ref={v} playsInline muted={muted} preload="auto" className={className} onClick={onClick} />;
}
