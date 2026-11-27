// "A new Holler is ready": the running build checks version.json (written at build time) when the app
// comes back on screen and every 10 minutes while it is open. A Home Screen app on an iPhone can keep an
// old build for days, so this says so. Never shown while recording; Restart waits for a send to finish.
import { useEffect, useRef, useState } from 'react';
import { busy, onOutbox } from '../lib/outbox';
import './update.css';

declare const __HOLLER_BUILD__: string;
const RUNNING = typeof __HOLLER_BUILD__ === 'string' ? __HOLLER_BUILD__ : '';
const EVERY = 10 * 60 * 1000;

const recording = () => !!document.querySelector('.chat.is-rec, .player, .review'); // not over a take, the player or Look before sending

async function latest(): Promise<string | null> {
  try {
    const r = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = (await r.json()) as { v?: unknown };
    return typeof j.v === 'string' && j.v ? j.v : null;
  } catch { return null; }
}

export function UpdateCard() {
  const [fresh, setFresh] = useState<string | null>(null);   // a newer build than this one
  const [later, setLater] = useState<string | null>(null);   // "Later" for this version, until the next launch
  const [rec, setRec] = useState(false);
  const [sending, setSending] = useState(busy());
  const [armed, setArmed] = useState(false);                 // Restart tapped while a holler was going up
  const last = useRef(0);

  // look for a new build: shortly after launch, whenever the app comes back, and every 10 minutes while visible
  useEffect(() => {
    if (import.meta.env.DEV || !RUNNING) return;
    const check = async () => {
      if (document.hidden) return;
      last.current = Date.now();
      const v = await latest();
      if (v && v !== RUNNING) setFresh(v);
    };
    const first = window.setTimeout(() => void check(), 4000);
    const tick = window.setInterval(() => { if (!document.hidden && Date.now() - last.current >= EVERY - 1000) void check(); }, 60000);
    const back = () => { if (!document.hidden) void check(); };
    document.addEventListener('visibilitychange', back);
    return () => { clearTimeout(first); clearInterval(tick); document.removeEventListener('visibilitychange', back); };
  }, []);

  useEffect(() => onOutbox(() => setSending(busy())), []);

  // while there is something to say, watch for recording so the card steps out of the way
  const pending = !!fresh && fresh !== later;
  useEffect(() => {
    if (!pending) return;
    setRec(recording());
    const i = window.setInterval(() => setRec(recording()), 1000);
    return () => clearInterval(i);
  }, [pending]);

  // armed: restart the moment nothing is sending and nobody is recording
  useEffect(() => {
    if (armed && !sending && !rec && !recording()) location.reload();
  }, [armed, sending, rec]);

  if (!pending || rec) return null;
  const restart = () => { if (busy() || recording()) setArmed(true); else location.reload(); };
  return (
    <div className="upd" role="status" aria-live="polite">
      <b className="upd-title">A new Holler is ready</b>
      <p className="upd-line">Restart to get it. If it still looks the same, close Holler all the way and open it again.</p>
      <div className="upd-btns">
        <button className="btn ghost" onClick={() => { setLater(fresh); setArmed(false); }}>Later</button>
        <button className={`btn primary ${armed ? 'armed' : ''}`} onClick={restart} aria-pressed={armed}>{sending ? 'Restart after it sends' : 'Restart'}</button>
      </div>
    </div>
  );
}
