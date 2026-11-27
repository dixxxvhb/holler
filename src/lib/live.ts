// One Realtime channel per chat for the whole app session. Broadcast only says "something changed";
// the data itself always comes from the RPCs. Presence says who is here, recording or watching.
import type { RealtimeChannel } from '@supabase/supabase-js';
import { sb } from './api';

export type Status = 'here' | 'recording' | 'watching';
export type LiveEvent = { chat: string; type: 'polo' | 'view' | 'react' | 'chat' | 'status'; from: string; data?: Record<string, unknown> };
type Presence = Record<string, Status>; // personId -> status

const chans = new Map<string, RealtimeChannel>();
const presence = new Map<string, Presence>(); // who has the app open, per chat
const statuses = new Map<string, Record<string, { status: Status; at: number }>>(); // recording / watching, by broadcast
const listeners = new Set<(e: LiveEvent) => void>();
const presenceListeners = new Set<() => void>();
let me = '';
let active: { chat: string; status: Status } | null = null;

export function setMe(id: string) { me = id; }

let wanted: string[] = [];
const joined = new Set<string>(); // chats whose channel is connected right now
/** Every chat's live channel is connected, so a change anywhere arrives on its own (pollers can relax). */
export const allLive = () => wanted.length > 0 && wanted.every(id => joined.has(id));
export function syncChats(ids: string[]) {
  wanted = ids;
  for (const [id, ch] of chans) if (!ids.includes(id)) { sb.removeChannel(ch); chans.delete(id); presence.delete(id); joined.delete(id); }
  for (const id of ids) if (!chans.has(id)) {
    const ch = sb.channel(`holler:${id}`, { config: { broadcast: { self: false }, presence: { key: me } } });
    ch.on('broadcast', { event: 'ev' }, ({ payload }) => {
      if (dbg()) console.log('[live] got', id.slice(0, 6), JSON.stringify(payload));
      const ev = { ...(payload as LiveEvent), chat: id };
      if (ev.type === 'status') {
        const m = statuses.get(id) || {}; m[ev.from] = { status: (ev.data?.status as Status) || 'here', at: Date.now() }; statuses.set(id, m);
        presenceListeners.forEach(f => f());
        return;
      }
      listeners.forEach(f => f(ev));
    });
    ch.on('presence', { event: 'sync' }, () => {
      // track() can leave older metas behind for the same key: the newest one wins
      const st = ch.presenceState() as Record<string, { status: Status; at?: number }[]>;
      const p: Presence = {};
      for (const [k, v] of Object.entries(st)) {
        const newest = v.reduce((a, b) => ((b.at || 0) >= (a.at || 0) ? b : a));
        // a recording that never said it stopped (app killed) stops counting after 6 minutes
        p[k] = newest.status === 'recording' && Date.now() - (newest.at || 0) > 360000 ? 'here' : newest.status;
      }
      presence.set(id, p); presenceListeners.forEach(f => f());
    });
    ch.subscribe((s, err) => {
      if (dbg()) console.log('[live] sub', id.slice(0, 6), s, err ? String(err) : '');
      if (s === 'SUBSCRIBED') {
        if (chans.get(id) === ch) joined.add(id);
        void ch.track({ status: 'here', at: Date.now() });
        if (active?.chat === id && active.status !== 'here') send(id, 'status', { status: active.status });
        reconnects.forEach(f => f(id));
      }
      else if (chans.get(id) === ch) {
        joined.delete(id);
        // dropped: rebuild it (and let screens re-fetch so nothing is missed meanwhile)
        chans.delete(id); void sb.removeChannel(ch);
        setTimeout(() => { if (wanted.includes(id)) syncChats(wanted); }, 1200);
      }
    });
    chans.set(id, ch);
  }
}

const dbg = () => { try { return !!localStorage.getItem('holler.debug'); } catch { return false; } };

export function send(chat: string, type: LiveEvent['type'], data?: Record<string, unknown>) {
  const ch = chans.get(chat);
  if (dbg()) console.log('[live] send', chat.slice(0, 6), type, ch ? ch.state : 'NO CHANNEL');
  ch?.send({ type: 'broadcast', event: 'ev', payload: { type, from: me, data } });
}

export function setStatus(chat: string | null, status: Status = 'here') {
  const prev = active;
  if (prev && prev.chat !== chat && prev.status !== 'here') send(prev.chat, 'status', { status: 'here' });
  active = chat ? { chat, status } : null;
  if (chat && (!prev || prev.chat !== chat || prev.status !== status)) send(chat, 'status', { status });
}

const reconnects = new Set<(chat: string) => void>();
export function onReconnect(f: (chat: string) => void) { reconnects.add(f); return () => { reconnects.delete(f); }; }
export function onLive(f: (e: LiveEvent) => void) { listeners.add(f); return () => { listeners.delete(f); }; }
export function onPresence(f: () => void) { presenceListeners.add(f); return () => { presenceListeners.delete(f); }; }
export function presenceOf(chat: string): Presence {
  const out: Presence = { ...(presence.get(chat) || {}) };
  const st = statuses.get(chat) || {};
  for (const [who, v] of Object.entries(st)) {
    if (!out[who]) continue; // left the app
    const fresh = Date.now() - v.at < (v.status === 'recording' ? 330000 : 600000);
    if (fresh && v.status !== 'here') out[who] = v.status;
  }
  return out;
}
