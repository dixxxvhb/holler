import { useEffect, useRef, useState, type ReactNode } from 'react';
import { publicUrl, type Person } from '../lib/api';
import type { Status } from '../lib/live';
import { Icon } from './icons';

export function Avatar({ p, size = 40, status, ring }: { p?: Person | null; size?: number; status?: Status; ring?: string }) {
  const name = p?.name || '?';
  const initials = name.trim().split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase();
  return (
    <span className={`av ${status ? 'st-' + status : ''}`} style={{ width: size, height: size, background: tone(p?.color), fontSize: size * 0.4, ...(ring ? { ['--ring' as string]: ring } : null) }} title={name}>
      {p?.avatar ? <img src={publicUrl(p.avatar)} alt="" /> : <span>{initials}</span>}
      {status && <i className="dot" />}
    </span>
  );
}

export function AvatarStack({ people, size = 34, max = 4 }: { people: Person[]; size?: number; max?: number }) {
  const shown = people.slice(0, max);
  return (
    <span className="stack" style={{ height: size }}>
      {shown.map((p, i) => <span key={p.id} style={{ marginLeft: i ? -size * 0.32 : 0, zIndex: 10 - i }}><Avatar p={p} size={size} /></span>)}
      {people.length > max && <span className="av more" style={{ width: size, height: size, marginLeft: -size * 0.32, fontSize: size * 0.36 }}>+{people.length - max}</span>}
    </span>
  );
}

const SHEET_OUT = 200;
const openSheets: object[] = [];   // bottom to top, so Escape only reaches the one on top
/** A block that slides up. It leaves the way it came (so what was in it stays put while it goes), the band stays at the top
 *  while the rest scrolls, and you can pull it down by the band. */
export function Sheet({ open, onClose, children, title, className, room, you }: { open: boolean; onClose: () => void; children: ReactNode; title?: string; className?: string; room?: string; you?: string }) {
  const [shown, setShown] = useState(open);
  const closeRef = useRef(onClose); closeRef.current = onClose;   // parents pass a new function every render; the sheet keeps its place in the stack
  const el = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  // what the sheet last showed while open: a parent usually empties these the moment it closes
  const last = useRef({ children, title, className, room, you });
  if (open) last.current = { children, title, className, room, you };
  useEffect(() => {
    if (open) { setShown(true); if (el.current) { el.current.style.transform = ''; el.current.style.transition = ''; } return; }
    const t = setTimeout(() => setShown(false), SHEET_OUT);
    return () => clearTimeout(t);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const me = {}; openSheets.push(me);
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && openSheets[openSheets.length - 1] === me) { e.stopImmediatePropagation(); closeRef.current(); } };
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('keydown', k); const i = openSheets.indexOf(me); if (i >= 0) openSheets.splice(i, 1); };
  }, [open]);
  if (!open && !shown) return null;
  const v = last.current;
  const closing = !open;
  const down = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('button, input, textarea, select, a')) return;
    drag.current = { y: e.clientY, dy: 0 };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current, s = el.current; if (!d || !s) return;
    d.dy = Math.max(0, e.clientY - d.y);
    s.style.transition = 'none'; s.style.transform = d.dy ? `translateY(${d.dy}px)` : '';
  };
  const up = () => {
    const d = drag.current, s = el.current; drag.current = null; if (!d || !s) return;
    if (d.dy > 90) { onClose(); return; }   // it carries on down from where the finger left it
    s.style.transition = ''; s.style.transform = '';
  };
  return (
    <div className={`sheet-wrap ${closing ? 'closing' : ''}`} onClick={onClose}>
      <div ref={el} className={`sheet ${v.className || ''}`} data-room={v.room} data-you={v.you ? '' : undefined} style={v.you ? { ['--room' as string]: v.you } : undefined} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={v.title}>
        <div className="grab" />
        {v.title && <div className="sheet-head" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}><h2>{v.title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button></div>}
        {v.children}
      </div>
    </div>
  );
}

/** One question in a small sheet, in place of the browser's own pop-up. `await ask({...})` is true for yes. */
type AskT = { title: string; body?: string; yes: string; no?: string; danger?: boolean };
let pushAsk: (a: AskT, done: (v: boolean) => void) => void = (a, done) => done(window.confirm(a.title));
export function ask(a: AskT) { return new Promise<boolean>(r => pushAsk(a, r)); }
export function Asker() {
  const [q, setQ] = useState<{ a: AskT; done: (v: boolean) => void } | null>(null);
  useEffect(() => { pushAsk = (a, done) => setQ(cur => { cur?.done(false); return { a, done }; }); }, []);
  const end = (v: boolean) => { q?.done(v); setQ(null); };
  return (
    <Sheet open={!!q} onClose={() => end(false)} title={q?.a.title} className="ask" you="#f7f6fb">
      {q?.a.body && <p className="ask-body">{q.a.body}</p>}
      <button className={`btn wide ${q?.a.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => end(true)}>{q?.a.yes}</button>
      <button className="btn wide" onClick={() => end(false)}>{q?.a.no || 'Cancel'}</button>
    </Sheet>
  );
}

/** A labelled switch row. */
export function Toggle({ label, hint, on, set, disabled }: { label: string; hint?: string; on: boolean; set: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`toggle ${disabled ? 'is-off' : ''}`}>
      <span><b>{label}</b>{hint && <em>{hint}</em>}</span>
      <input type="checkbox" checked={on && !disabled} disabled={disabled} onChange={e => set(e.target.checked)} />
      <i />
    </label>
  );
}

type ToastT = { id: number; text: string; action?: { label: string; run: () => void }; ms: number };
let pushToast: (t: Omit<ToastT, 'id'>) => void = () => {};
export function toast(text: string, action?: ToastT['action'], ms = 3200) { pushToast({ text, action, ms }); }
export function Toaster() {
  const [list, setList] = useState<(ToastT & { out?: boolean })[]>([]);
  useEffect(() => {
    const drop = (id: number) => {
      setList(l => l.map(x => (x.id === id ? { ...x, out: true } : x)));
      setTimeout(() => setList(l => l.filter(x => x.id !== id)), 180);
    };
    pushToast = t => {
      const id = Date.now() + Math.random();
      setList(l => [...l.slice(-2), { ...t, id }]);
      setTimeout(() => drop(id), t.ms);
    };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map(t => (
        <div key={t.id} className={`toast ${t.out ? 'out' : ''}`}>
          <span>{t.text}</span>
          {t.action && <button onClick={() => { t.action!.run(); setList(l => l.filter(x => x.id !== t.id)); }}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}

export function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 50) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 86400 * 6) return new Date(iso).toLocaleDateString(undefined, { weekday: 'short' });
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
/** "2:14 PM", "Yesterday 9:02 PM", "Mon 4:30 PM", "Nov 3, 4:30 PM" */
export function when(iso: string) {
  const d = new Date(iso); const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return time;
  if (diff === 1) return `Yesterday ${time}`;
  if (diff < 6) return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}
/** "Today", "Yesterday", "Mon", "Nov 3": the day a holler belongs to */
export function dayLabel(iso: string) {
  const d = new Date(iso); const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 6) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, d.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: '2-digit' });
}
export function clock(sec: number) {
  const s = Math.max(0, Math.floor(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// three stored colors are shown a little differently (violet matches the room, red sits away from record red, cream becomes cloud); no row is edited
const TONE: Record<string, string> = { '#9b7bff': '#a58bff', '#e5484d': '#f2616b', '#f5f0e8': '#eceaf6' };
export const tone = (hex?: string | null) => (hex && TONE[hex.toLowerCase()]) || hex || '#555';
export const COLORS = ['#ff6a3d', '#ff7aa2', '#ffb02e', '#4fd1a5', '#4cb3ff', '#a58bff', '#f2616b', '#c6f432', '#eceaf6', '#2fb8ac'];
export const THEMES: Record<string, { label: string; accent: string }> = {
  ember: { label: 'Ember', accent: '#ff6a3d' },
  rose: { label: 'Rose', accent: '#ff7aa2' },
  sea: { label: 'Seafoam', accent: '#4fd1a5' },
  sky: { label: 'Sky', accent: '#4cb3ff' },
  violet: { label: 'Violet', accent: '#a58bff' },
  lime: { label: 'Lime', accent: '#c6f432' },
  sun: { label: 'Sunny', accent: '#ffb02e' },
};
export const chatTitle = (c: { name: string; members: Person[] }, meId: string) =>
  c.name || c.members.filter(m => m.id !== meId).map(m => m.name.split(' ')[0]).join(', ') || 'Just you so far';
