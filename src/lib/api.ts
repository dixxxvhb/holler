import { createClient } from '@supabase/supabase-js';

export const SB_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
export const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

export type Prefs = {
  hd?: boolean; speed?: number; look?: string; voice?: string; captions?: boolean; review?: boolean; sounds?: boolean;
};
export type Person = { id: string; name: string; color: string; avatar: string | null; lastSeen: string; prefs?: Prefs };
export type Reaction = { id: string; who: string; kind: string; t: number | null };
export type Polo = {
  id: string; chat: string; author: string; kind: 'video' | 'audio' | 'text'; path: string | null; thumb: string | null;
  mime: string | null; duration: number | null; w: number | null; h: number | null; body: string | null;
  transcript: string | null; effects: Record<string, unknown>; at: string;
  views: { who: string; at: string }[]; reactions: Reaction[]; savedBy: string[];
  pending?: { progress: number; error?: string; localUrl?: string; thumbUrl?: string };
};
export type ChatSummary = {
  id: string; name: string; code: string; theme: string; lastPoloAt: string; muted: boolean;
  members: Person[]; unread: number;
  last: { id: string; kind: string; thumb: string | null; author: string; body: string | null; at: string } | null;
};
export type ChatFull = ChatSummary & { polos: Polo[] };
export type Home = { me: Person; chats: ChatSummary[]; usage: { bytes: number; count: number } };

const TOKEN_KEY = 'holler.token';
export function getToken(): string | null { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
export function setToken(t: string | null) { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } }

async function rpc<T>(fn: string, args: Record<string, unknown> = {}, withToken = true): Promise<T> {
  const body = withToken ? { p_token: getToken(), ...args } : args;
  let lastErr: { message?: string; code?: string } | null = null;
  for (let i = 0; i < 3; i++) {
    const { data, error } = await sb.rpc(fn, body);
    if (!error) return data as T;
    lastErr = error;
    if (error.code === 'P0001') break; // our own raised errors: no point retrying
    await new Promise(r => setTimeout(r, 400 * (i + 1)));
  }
  throw new Error(lastErr?.message || 'Something went wrong');
}

export const api = {
  signup: (name: string, color: string) => rpc<{ token: string; me: Person }>('holler_signup', { p_name: name, p_color: color }, false),
  home: () => rpc<Home>('holler_home'),
  updateMe: (p: { name?: string; color?: string; avatar?: string | null; prefs?: Prefs }) =>
    rpc<Person>('holler_update_me', { p_name: p.name ?? null, p_color: p.color ?? null, p_avatar: p.avatar === null ? '' : p.avatar ?? null, p_prefs: p.prefs ?? null }),
  createChat: (name: string) => rpc<ChatSummary>('holler_create_chat', { p_name: name }),
  join: (code: string) => rpc<ChatSummary>('holler_join', { p_code: code }),
  chatUpdate: (chat: string, p: { name?: string; theme?: string; muted?: boolean }) =>
    rpc<ChatSummary>('holler_chat_update', { p_chat: chat, p_name: p.name ?? null, p_theme: p.theme ?? null, p_muted: p.muted ?? null }),
  leave: (chat: string) => rpc<void>('holler_leave', { p_chat: chat }),
  chat: (chat: string) => rpc<ChatFull>('holler_chat', { p_chat: chat }),
  saved: () => rpc<Polo[]>('holler_saved'),
  startPolo: (chat: string, kind: Polo['kind'], ext: string | null, mime: string | null, body: string | null) =>
    rpc<Polo>('holler_start_polo', { p_chat: chat, p_kind: kind, p_ext: ext, p_mime: mime, p_body: body }),
  finishPolo: (id: string, p: { duration: number; w: number; h: number; transcript: string | null; effects: object; hasThumb: boolean }) =>
    rpc<Polo>('holler_finish_polo', { p_polo: id, p_duration: p.duration, p_w: p.w, p_h: p.h, p_transcript: p.transcript, p_effects: p.effects, p_has_thumb: p.hasThumb }),
  deletePolo: (id: string) => rpc<void>('holler_delete_polo', { p_polo: id }),
  view: (id: string) => rpc<void>('holler_view', { p_polo: id }),
  react: (id: string, kind: string, at: number | null) => rpc<Polo>('holler_react', { p_polo: id, p_kind: kind, p_at: at }),
  save: (id: string, on: boolean) => rpc<void>('holler_save', { p_polo: id, p_on: on }),
  pushSub: (sub: object, on: boolean) => rpc<void>('holler_push_sub', { p_sub: sub, p_on: on }),
  linkDevice: () => rpc<string>('holler_link_device'),
};

export const publicUrl = (path: string) => `${SB_URL}/storage/v1/object/public/holler/${path}`;

/** Upload with progress. Retries network failures with backoff. */
export function upload(path: string, blob: Blob, onProgress?: (f: number) => void): Promise<void> {
  const attempt = () => new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SB_URL}/storage/v1/object/holler/${path}`);
    xhr.setRequestHeader('apikey', SB_KEY);
    xhr.setRequestHeader('Authorization', `Bearer ${SB_KEY}`);
    xhr.setRequestHeader('content-type', blob.type || 'application/octet-stream');
    xhr.setRequestHeader('cache-control', 'max-age=31536000');
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status < 300) resolve();
      else if (/already exists|Duplicate/i.test(xhr.responseText)) resolve();
      else reject(Object.assign(new Error(xhr.responseText || `upload ${xhr.status}`), { fatal: xhr.status === 413 || xhr.status === 403 }));
    };
    xhr.onerror = () => reject(new Error('network'));
    xhr.send(blob);
  });
  return (async () => {
    let wait = 1000;
    for (let i = 0; ; i++) {
      try { return await attempt(); }
      catch (e) {
        if ((e as { fatal?: boolean }).fatal || i >= 8) throw e;
        await new Promise(r => setTimeout(r, wait)); wait = Math.min(wait * 2, 15000);
      }
    }
  })();
}

// ---- media cache: whole files in Cache Storage so rewatching costs no data ----
const CACHE = 'holler-media-v1';
const urlMemo = new Map<string, Promise<string>>();
export function mediaUrl(path: string): Promise<string> {
  let p = urlMemo.get(path);
  if (!p) {
    p = (async () => {
      const url = publicUrl(path);
      try {
        const cache = await caches.open(CACHE);
        let res = await cache.match(url);
        if (!res) {
          const net = await fetch(url);
          if (!net.ok) throw new Error('fetch ' + net.status);
          await cache.put(url, net.clone());
          res = net;
        }
        return URL.createObjectURL(await res.blob());
      } catch {
        return url;
      }
    })();
    p.catch(() => urlMemo.delete(path));
    urlMemo.set(path, p);
  }
  return p;
}
export async function seedCache(path: string, blob: Blob) {
  urlMemo.set(path, Promise.resolve(URL.createObjectURL(blob)));
  try {
    const cache = await caches.open(CACHE);
    await cache.put(publicUrl(path), new Response(blob, { headers: { 'content-type': blob.type } }));
  } catch { /* ignore */ }
}
export async function cacheBytes(): Promise<number> {
  try { const e = await navigator.storage?.estimate?.(); return e?.usage ?? 0; } catch { return 0; }
}
export async function clearCache() { try { await caches.delete(CACHE); urlMemo.clear(); } catch { /* ignore */ } }

export function rid(n = 16) {
  const a = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const b = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(b, x => a[x % a.length]).join('');
}
