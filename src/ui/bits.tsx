import { useEffect, useState, type ReactNode } from 'react';
import { publicUrl, type Person } from '../lib/api';
import type { Status } from '../lib/live';
import { Icon } from './icons';

export function Avatar({ p, size = 40, status, ring }: { p?: Person | null; size?: number; status?: Status; ring?: string }) {
  const name = p?.name || '?';
  const initials = name.split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase();
  return (
    <span className={`av ${status ? 'st-' + status : ''}`} style={{ width: size, height: size, background: p?.color || '#555', fontSize: size * 0.4, boxShadow: ring ? `0 0 0 2px var(--bg), 0 0 0 4px ${ring}` : undefined }} title={name}>
      {p?.avatar ? <img src={publicUrl(p.avatar)} alt="" /> : <span>{initials}</span>}
      {status && <i className="dot" />}
    </span>
  );
}

export function AvatarStack({ people, size = 34, max = 4 }: { people: Person[]; size?: number; max?: number }) {
  const shown = people.slice(0, max);
  return (
    <span className="stack" style={{ height: size }}>
      {shown.map((p, i) => <span key={p.id} style={{ marginLeft: i ? -size * 0.32 : 0, zIndex: 10 - i }}><Avatar p={p} size={size} ring="var(--bg)" /></span>)}
      {people.length > max && <span className="av more" style={{ width: size, height: size, marginLeft: -size * 0.32, fontSize: size * 0.36 }}>+{people.length - max}</span>}
    </span>
  );
}

export function Sheet({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title?: string }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="grab" />
        {title && <div className="sheet-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button></div>}
        {children}
      </div>
    </div>
  );
}

type ToastT = { id: number; text: string; action?: { label: string; run: () => void }; ms: number };
let pushToast: (t: Omit<ToastT, 'id'>) => void = () => {};
export function toast(text: string, action?: ToastT['action'], ms = 3200) { pushToast({ text, action, ms }); }
export function Toaster() {
  const [list, setList] = useState<ToastT[]>([]);
  useEffect(() => {
    pushToast = t => {
      const id = Date.now() + Math.random();
      setList(l => [...l.slice(-2), { ...t, id }]);
      setTimeout(() => setList(l => l.filter(x => x.id !== id)), t.ms);
    };
  }, []);
  return (
    <div className="toasts">
      {list.map(t => (
        <div key={t.id} className="toast">
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
export function clock(sec: number) {
  const s = Math.max(0, Math.floor(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const COLORS = ['#ff6a3d', '#ff7aa2', '#ffb02e', '#4fd1a5', '#4cb3ff', '#9b7bff', '#e5484d', '#c6f432', '#f5f0e8', '#2fb8ac'];
export const THEMES: Record<string, { label: string; accent: string }> = {
  ember: { label: 'Ember', accent: '#ff6a3d' },
  rose: { label: 'Rose', accent: '#ff7aa2' },
  sea: { label: 'Seafoam', accent: '#4fd1a5' },
  sky: { label: 'Sky', accent: '#4cb3ff' },
  violet: { label: 'Violet', accent: '#9b7bff' },
  lime: { label: 'Lime', accent: '#c6f432' },
  sun: { label: 'Sunny', accent: '#ffb02e' },
};
export const chatTitle = (c: { name: string; members: Person[] }, meId: string) =>
  c.name || c.members.filter(m => m.id !== meId).map(m => m.name.split(' ')[0]).join(', ') || 'Just you so far';
