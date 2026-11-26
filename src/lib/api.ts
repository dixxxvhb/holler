import { createClient } from '@supabase/supabase-js';

export const SB_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
export const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

export type Prefs = {
  hd?: boolean; simple?: boolean; speed?: number; look?: string; voice?: string; captions?: boolean; review?: boolean; sounds?: boolean;
};
export type Person = { id: string; name: string; color: string; avatar: string | null; lastSeen: string; prefs?: Prefs };
export type Reaction = { id: string; who: string; kind: string; t: number | null };
export type Polo = {
  id: string; chat: string; author: string; kind: 'video' | 'audio' | 'text'; path: string | null; thumb: string | null;
  mime: string | null; duration: number | null; w: number | null; h: number | null; body: string | null;
  transcript: string | null; effects: Record<string, unknown>; at: string;
  views: { who: string; at: string }[]; reactions: Reaction[]; savedBy: string[];
  reactTo?: string | null; game?: string | null; gameTurn?: number | null;
  pending?: { progress: number; error?: string; localUrl?: string; thumbUrl?: string };
};
export type ChatSummary = {
  id: string; name: string; code: string; theme: string; lastPoloAt: string; muted: boolean;
  members: Person[]; unread: number; yourTurn?: number;
  last: { id: string; kind: string; thumb: string | null; author: string; body: string | null; at: string; seen?: string[] | null } | null;
};
export type GameTurn = { who: string; turn: number; at: string; skipped: boolean };
export type Game = {
  id: string; chat: string; kind: GameKind; status: 'playing' | 'done' | 'ended'; version: number;
  order: string[]; turnSec: number; idx: number; turns: GameTurn[];
  turnPerson: string | null; turnSince: string | null; nudgedAt: string | null;
  createdBy: string | null; createdAt: string; endedAt: string | null; savedAt: string | null; savedBy: string | null;
  looked: boolean; phrase: string | null; guess: string | null; hidden: boolean; hidesAt: string | null; clips: Polo[] | null;
  /** Round games (Poker Face, Charades Relay): who still owes a move. */
  todo?: string[]; deck?: string;
  // Poker Face
  cardId?: string; question?: string; phase?: 'record' | 'vote'; since?: string; recorded?: string[]; voted?: string[];
  myVote?: string | null; truthIsMe?: boolean; answer?: string | null; truth?: string | null; votes?: Record<string, string> | null;
  // Charades Relay
  acted?: string[]; acts?: CharadesAct[];
  // Tic-Tac-Toe and Checkers
  board?: string; moves?: number; last?: ({ cell?: number; path?: number[]; captured?: number } & Partial<CardEvent>) | null; quiet?: number;
  winner?: string | null; result?: 'win' | 'draw' | 'resign' | 'idle' | 'left' | null;
  // Last Card (your own hand only; everyone's shows once it's over)
  top?: string; color?: string; dir?: number; log?: CardEvent[]; counts?: Record<string, number>; hand?: string[] | null;
  drawn?: string | null; deckLeft?: number; hands?: Record<string, string[]> | null;
  // Seven Letters and Trivia
  began?: boolean; beganAt?: string | null; played?: string[]; rack?: string | null; qids?: string[] | null;
  myPlay?: QuickPlay | null; plays?: Record<string, QuickPlay> | null;
  // On The Spot
  takes?: SpotTake[];
};
export type SpotTake = { who: string; at: string; qids: string[]; picks: { pick: number; ms: number }[]; clip: Polo | null };
/** Don't Laugh shares Game.acts with Charades, in this shape: read it with laughActs(). */
export type LaughWatch = { done?: boolean; cracked?: number | null; at?: string; clip?: Polo | null };
export type LaughAct = { who: string; at: string; clip: Polo | null; mine: LaughWatch | null; results: Record<string, LaughWatch> | null };
export const laughActs = (g: Game) => (g.acts || []) as unknown as LaughAct[];
export type GameKind = 'passiton' | 'poker' | 'charades' | 'ttt' | 'checkers' | 'words' | 'trivia' | 'spot' | 'laugh' | 'lastcard';
export type CardEvent = { who: string; kind: 'play' | 'draw' | 'keep' | 'idle' | 'left'; at: string; card?: string; color?: string;
  skip?: string; hit?: string; n?: number; forgot?: number; called?: boolean };
export type CardMove = { play: string; color?: string; last?: boolean } | { draw: true } | { pass: true };
export type QuickPlay = { at: string; words?: string[]; answers?: { pick: number; ms: number }[] };
export type CharadesGuess = { tries: number; ok: boolean; done: boolean; t: number | null; text?: string; at: string };
export type CharadesAct = { who: string; at: string; clip: Polo | null; word: string | null; mine: CharadesGuess | null; results: Record<string, CharadesGuess> };
export type ChatFull = ChatSummary & { polos: Polo[]; games?: Game[] };
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
  gameStart: (chat: string, order: string[], turnSec: number, phrase: string, deckId: string) =>
    rpc<Game>('holler_game_start', { p_chat: chat, p_kind: 'passiton', p_order: order, p_turn_sec: turnSec, p_phrase: phrase, p_deck_id: deckId }),
  gameStart2: (chat: string, kind: Exclude<GameKind, 'passiton' | 'lastcard'>, order: string[], opts: object) =>
    rpc<Game>('holler_game_start2', { p_chat: chat, p_kind: kind, p_order: order, p_opts: opts }),
  gameVote: (id: string, pick: string) => rpc<Game>('holler_game_vote', { p_game: id, p_pick: pick }),
  gameGuess: (id: string, actor: string, text: string, t: number) =>
    rpc<{ ok: boolean; tries: number; done: boolean; word: string | null; game: Game }>('holler_game_guess', { p_game: id, p_actor: actor, p_text: text, p_t: t }),
  game: (id: string) => rpc<Game>('holler_game', { p_game: id }),
  gameMove: (id: string, version: number, move: { cell: number } | { path: number[] }) =>
    rpc<Game>('holler_game_move', { p_game: id, p_version: version, p_move: move }),
  gameLaughed: (id: string, actor: string, cracked: number | null) =>
    rpc<Game>('holler_game_laughed', { p_game: id, p_actor: actor, p_cracked: cracked }),
  cardStart: (chat: string, order: string[]) => rpc<Game>('holler_card_start', { p_chat: chat, p_order: order }),
  cardMove: (id: string, version: number, move: CardMove) => rpc<Game>('holler_card_move', { p_game: id, p_version: version, p_move: move }),
  cardLeave: (id: string) => rpc<Game>('holler_card_leave', { p_game: id }),
  gameResign: (id: string) => rpc<Game>('holler_game_resign', { p_game: id }),
  gameBegin: (id: string) => rpc<Game>('holler_game_begin', { p_game: id }),
  gamePlay: (id: string, play: { words: string[] } | { answers: { pick: number; ms: number }[] }) =>
    rpc<Game>('holler_game_play', { p_game: id, p_play: play }),
  gameLook: (id: string) => rpc<{ path: string; thumb: string | null; duration: number | null; who: string; mime: string | null }>('holler_game_look', { p_game: id }),
  gameLooked: (id: string) => rpc<Game>('holler_game_looked', { p_game: id }),
  gameNudge: (id: string) => rpc<Game>('holler_game_nudge', { p_game: id }),
  gameSave: (id: string, on: boolean) => rpc<Game>('holler_game_save', { p_game: id, p_on: on }),
  gameEnd: (id: string) => rpc<Game>('holler_game_end', { p_game: id }),
  linkDevice: () => rpc<string>('holler_link_device'),
  linkCode: () => rpc<string>('holler_link_code'),
  redeemCode: (code: string) => rpc<{ token: string }>('holler_redeem_code', { p_code: code }, false),
};

export const publicUrl = (path: string) => `${SB_URL}/storage/v1/object/public/holler/${path}`;

/** Upload with progress. Retries network failures with backoff. */
export function upload(path: string, blob: Blob, onProgress?: (f: number) => void, signal?: AbortSignal): Promise<void> {
  const stopped = () => Object.assign(new Error('cancelled'), { fatal: true });
  const attempt = () => new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(stopped()); return; }
    const xhr = new XMLHttpRequest();
    signal?.addEventListener('abort', () => { xhr.abort(); reject(stopped()); }, { once: true });
    xhr.open('POST', `${SB_URL}/storage/v1/object/holler/${path}`);
    xhr.setRequestHeader('apikey', SB_KEY);
    xhr.setRequestHeader('Authorization', `Bearer ${SB_KEY}`);
    xhr.setRequestHeader('content-type', blob.type || 'application/octet-stream');
    xhr.setRequestHeader('cache-control', 'max-age=31536000');
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status < 300) resolve();
      else if (/already exists|Duplicate/i.test(xhr.responseText)) resolve();
      else {
        // 4xx (bar timeouts and rate limits) won't fix itself by retrying; storage reports a refused upload as 400
        const fatal = xhr.status >= 400 && xhr.status < 500 && xhr.status !== 408 && xhr.status !== 429;
        const msg = xhr.status === 413 || /too large|exceeded/i.test(xhr.responseText) ? 'That file is too big to send'
          : fatal ? 'The upload was refused. Try recording it again.' : `Upload failed (${xhr.status})`;
        reject(Object.assign(new Error(msg), { fatal, detail: xhr.responseText }));
      }
    };
    xhr.onerror = () => reject(new Error('network'));
    xhr.send(blob);
  });
  return (async () => {
    let wait = 1000;
    for (let i = 0; ; i++) {
      try { return await attempt(); }
      catch (e) {
        if ((e as { fatal?: boolean }).fatal || i >= 8 || signal?.aborted) throw e;
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
