// Sending: optimistic local polo -> reserve a path -> upload thumb + media with progress -> finish.
// A short undo window before the polo is marked ready. Failed sends stay visible with Retry.
import { api, upload, seedCache, sb, type Polo } from './api';
import { send as liveSend } from './live';
import type { Recording } from './studio';

export type Outgoing = {
  key: string; chat: string; me: string; rec: Recording; transcript: string | null;
  polo: Polo; progress: number; error?: string; cancelled?: boolean; done?: boolean; serverId?: string;
};

const items = new Map<string, Outgoing>();
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());
export const onOutbox = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const outgoing = (chat: string) => [...items.values()].filter(o => o.chat === chat && !o.done && !o.cancelled);
export const busy = () => [...items.values()].some(o => !o.done && !o.cancelled && !o.error);

export const UNDO_MS = 3500;

// ---- unsent hollers live in IndexedDB until the server has them, so closing the app or losing
// signal mid-send never loses a recording. Resumed on the next launch.
type Saved = { key: string; chat: string; me: string; rec: Recording; transcript: string | null; serverId?: string; path?: string | null; thumb?: string | null; at: number };
let dbp: Promise<IDBDatabase> | null = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('holler-outbox', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('items', { keyPath: 'key' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function store(fn: (s: IDBObjectStore) => IDBRequest | void): Promise<unknown> {
  try {
    const d = await db();
    return await new Promise((res, rej) => {
      const tx = d.transaction('items', 'readwrite'); const req = fn(tx.objectStore('items'));
      tx.oncomplete = () => res(req ? (req as IDBRequest).result : undefined); tx.onerror = () => rej(tx.error);
    });
  } catch { return undefined; }
}
const persist = (o: Outgoing, me: string) => store(s => { s.put({ key: o.key, chat: o.chat, me, rec: o.rec, transcript: o.transcript, serverId: o.serverId, path: o.polo.path, thumb: o.polo.thumb, at: Date.now() } satisfies Saved); });
const forget = (key: string) => store(s => { s.delete(key); });

let resumed = false;
export async function resumeOutbox(me: string, onSent?: (p: Polo) => void) {
  if (resumed) return; resumed = true;
  const all = ((await store(s => s.getAll())) as Saved[] | undefined) || [];
  for (const sv of all) {
    if (sv.me !== me || items.has(sv.key)) continue;
    const stale = Date.now() - sv.at > 100 * 60 * 1000; // path reservations last 2 hours
    const o = make(sv.key, sv.chat, me, sv.rec, sv.transcript);
    if (!stale && sv.serverId) { o.serverId = sv.serverId; o.polo.path = sv.path ?? null; o.polo.thumb = sv.thumb ?? null; }
    items.set(o.key, o);
    void run(o, onSent);
  }
  emit();
}

function make(key: string, chat: string, me: string, rec: Recording, transcript: string | null): Outgoing {
  const localUrl = URL.createObjectURL(rec.blob);
  const thumbUrl = rec.thumb ? URL.createObjectURL(rec.thumb) : undefined;
  const polo: Polo = {
    id: 'local-' + key, chat, author: me, kind: rec.kind, path: null, thumb: null, mime: rec.mime, duration: rec.duration,
    w: rec.w, h: rec.h, body: null, transcript, effects: rec.effects, at: new Date().toISOString(), views: [], reactions: [], savedBy: [],
    pending: { progress: 0, localUrl, thumbUrl },
  };
  return { key, chat, me, rec, transcript, polo, progress: 0 };
}

export function sendRecording(chat: string, me: string, rec: Recording, transcript: string | null, onSent?: (p: Polo) => void) {
  const key = Math.random().toString(36).slice(2);
  const o = make(key, chat, me, rec, transcript);
  items.set(key, o); emit();
  void persist(o, me);
  void run(o, onSent);
  return key;
}

async function run(o: Outgoing, onSent?: (p: Polo) => void) {
  o.error = undefined; emit();
  const stoppedAt = Date.now();
  try {
    let reserved: Polo;
    if (o.serverId) reserved = { ...o.polo, id: o.serverId } as Polo;
    else {
      reserved = await api.startPolo(o.chat, o.rec.kind, o.rec.ext, o.rec.mime, null);
      o.serverId = reserved.id; o.polo.path = reserved.path; o.polo.thumb = reserved.thumb;
      void persist(o, o.me);
    }
    if (o.cancelled) return cleanup(o);
    const total = o.rec.blob.size + (o.rec.thumb?.size || 0);
    let thumbDone = 0;
    if (o.rec.thumb && o.polo.thumb) {
      await upload(o.polo.thumb, o.rec.thumb, f => { o.progress = (f * o.rec.thumb!.size) / total; o.polo.pending!.progress = o.progress; emit(); });
      thumbDone = o.rec.thumb.size;
    }
    await upload(o.polo.path!, o.rec.blob, f => { o.progress = (thumbDone + f * o.rec.blob.size) / total; o.polo.pending!.progress = o.progress; emit(); });
    void seedCache(o.polo.path!, o.rec.blob);
    const wait = UNDO_MS - (Date.now() - stoppedAt);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    if (o.cancelled) return cleanup(o);
    const fin = await api.finishPolo(o.serverId!, {
      duration: o.rec.duration, w: o.rec.w, h: o.rec.h, transcript: o.transcript, effects: o.rec.effects, hasThumb: !!o.polo.thumb,
    });
    o.done = true; emit(); void forget(o.key);
    liveSend(o.chat, 'polo', { id: fin.id });
    onSent?.(fin);
  } catch (e) {
    o.error = e instanceof Error ? e.message : 'Could not send';
    emit();
  }
}

async function cleanup(o: Outgoing) {
  o.cancelled = true; emit(); void forget(o.key);
  if (o.serverId) {
    try {
      await api.deletePolo(o.serverId);
      const paths = [o.polo.path, o.polo.thumb].filter(Boolean) as string[];
      if (paths.length) await sb.storage.from('holler').remove(paths);
    } catch { /* leftovers are harmless */ }
  }
}

if (typeof window !== 'undefined') window.addEventListener('online', () => { for (const o of items.values()) if (o.error && !o.done && !o.cancelled) void run(o); });

export function undo(key: string) { const o = items.get(key); if (o && !o.done) { o.cancelled = true; emit(); if (o.serverId) void cleanup(o); } }
export function retry(key: string) { const o = items.get(key); if (o) void run(o); }
export function discard(key: string) { const o = items.get(key); if (o) void cleanup(o); }

export async function sendText(chat: string, body: string) {
  const p = await api.startPolo(chat, 'text', null, null, body);
  liveSend(chat, 'polo', { id: p.id });
  return p;
}

export async function removeMine(p: Polo) {
  await api.deletePolo(p.id);
  const paths = [p.path, p.thumb].filter(Boolean) as string[];
  if (paths.length) await sb.storage.from('holler').remove(paths).catch(() => {});
  liveSend(p.chat, 'polo', { id: p.id, deleted: true });
}
