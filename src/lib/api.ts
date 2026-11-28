import { createClient } from '@supabase/supabase-js';

export const SB_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
export const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

export type Prefs = {
  hd?: boolean; simple?: boolean; speed?: number; look?: string; voice?: string; captions?: boolean; review?: boolean; sounds?: boolean;
  /** profile words, shown to the people you share a chat with */
  about?: string; into?: string; song?: string;
};
/** What everyone in your chats sees on your profile (look and voice are your saved defaults). */
export type Profile = { about?: string; into?: string; song?: string; look?: string; voice?: string };
export type Person = { id: string; name: string; color: string; avatar: string | null; lastSeen: string; prefs?: Prefs; joined?: string; profile?: Profile };
export type ProfileStats = { hollers: number; notes: number; minutes: number; seconds?: number; games: number; wins: number; first: string | null };
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
  cardId?: string; question?: string; phase?: 'record' | 'vote' | 'write' | 'guess'; since?: string; recorded?: string[]; voted?: string[];
  myVote?: string | null; truthIsMe?: boolean; answer?: string | null; truth?: string | null; votes?: Record<string, string> | null;
  // Charades Relay
  acted?: string[]; acts?: CharadesAct[];
  // Tic-Tac-Toe and Checkers
  board?: string; moves?: number; last?: ({ cell?: number; path?: number[]; captured?: number } & Partial<CardEvent>) | null; quiet?: number;
  winner?: string | null; result?: 'win' | 'draw' | 'resign' | 'idle' | 'left' | null;
  // Last Card (your own hand only; everyone's shows once it's over)
  top?: string; color?: string; dir?: number; log?: CardEvent[]; counts?: Record<string, number>; hand?: string[] | null;
  drawn?: string | null; deckLeft?: number; hands?: Record<string, string[]> | null;
  /** stacking is on for this game; owe = cards waiting on whoever is up */
  stack?: boolean; owe?: number;
  // Seven Letters and Trivia
  began?: boolean; beganAt?: string | null; played?: string[]; rack?: string | null; qids?: string[] | null;
  myPlay?: QuickPlay | null; plays?: Record<string, QuickPlay> | null;
  // On The Spot
  takes?: SpotTake[];
  // Zoom In (shots, not clips: Pass It On has clips)
  filmed?: string[]; skipped?: string[]; shots?: ZoomShot[];
  // Who Said It
  wrote?: string[]; boards?: SaidBoard[]; scores?: Record<string, { right: number; fooled: number }>;
};
/** Zoom In: at = how far out it was when you knew it (0 = all the way in, 1 = the whole picture); got = you said you got it. */
export type ZoomGuess = { at: number; text: string; got: boolean | null; ts?: string };
/** answer and guesses are null until you've guessed it (always there for your own, and once the game is over). */
/** Where a Zoom In clip starts: x and y are 0 to 1 in the video frame (the middle of the zoomed view), z how far in.
 *  Null on a clip from before the filmer could pick (it starts 8x on the middle). */
export type ZoomFocus = { x: number; y: number; z: number };
export type ZoomShot = { who: string; at: string; focus?: ZoomFocus | null; clip: Polo | null; mine: ZoomGuess | null; answer: string | null; guesses: Record<string, ZoomGuess> | null };
/** Who Said It: who is null until the board is open to you (yours always shows). */
export type SaidAnswer = { k: string; text: string; who: string | null };
export type SaidPick = { picks: Record<string, string>; at: string };
export type SaidBoard = { about: string; prompt: string | null; n: number; open: boolean; mine: SaidPick | null; guesses: Record<string, SaidPick> | null; answers: SaidAnswer[] };
export type ZoomMove = { skip: true } | { who: string; at: number; guess: string } | { who: string; got: boolean };
export type SaidMove = { write: Record<string, string> } | { about: string; picks: Record<string, string> };
export type SpotTake = { who: string; at: string; qids: string[]; picks: { pick: number; ms: number }[]; clip: Polo | null };
/** Don't Laugh shares Game.acts with Charades, in this shape: read it with laughActs(). */
export type LaughWatch = { done?: boolean; cracked?: number | null; at?: string; clip?: Polo | null };
export type LaughAct = { who: string; at: string; clip: Polo | null; mine: LaughWatch | null; results: Record<string, LaughWatch> | null };
export const laughActs = (g: Game) => (g.acts || []) as unknown as LaughAct[];
export type GameKind = 'passiton' | 'poker' | 'charades' | 'ttt' | 'checkers' | 'words' | 'trivia' | 'spot' | 'laugh' | 'lastcard' | 'zoom' | 'said';
export type CardEvent = { who: string; kind: 'play' | 'draw' | 'keep' | 'take' | 'idle' | 'left'; at: string; card?: string; color?: string;
  skip?: string; stack?: string; hit?: string; n?: number; forgot?: number; called?: boolean };
export type CardMove = { play: string; color?: string; last?: boolean } | { draw: true } | { pass: true };
export type QuickPlay = { at: string; words?: string[]; answers?: { pick: number; ms: number }[] };
export type CharadesGuess = { tries: number; ok: boolean; done: boolean; t: number | null; text?: string; at: string; counted?: boolean };
export type CharadesAct = { who: string; at: string; clip: Polo | null; word: string | null; mine: CharadesGuess | null; results: Record<string, CharadesGuess> };
export type ChatFull = ChatSummary & { polos: Polo[]; games?: Game[] };
export type Home = { me: Person; chats: ChatSummary[]; usage: { bytes: number; count: number } };

const TOKEN_KEY = 'holler.token';
export function getToken(): string | null { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
export function setToken(t: string | null) {
  const was = getToken();
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
  if (was !== t) { clearHome(); chatMemo.clear(); } // a different person (or nobody) never sees the last one's chats
}

// ---- the last Home, kept on the device so the app paints at once and refreshes behind it ----
const HOME_KEY = 'holler.home.v1';
const whoKey = () => (getToken() || '').slice(0, 8);
/** The last Home this signed-in person saw on this device, or null. */
export function cachedHome(): Home | null {
  try {
    const raw = localStorage.getItem(HOME_KEY); if (!raw) return null;
    const v = JSON.parse(raw) as { who?: string; home?: Home };
    const who = whoKey();
    return who && v.who === who && v.home?.me?.id && Array.isArray(v.home.chats) ? v.home : null;
  } catch { return null; }
}
export function saveHome(h: Home) {
  const who = whoKey(); if (!who) return;
  try { localStorage.setItem(HOME_KEY, JSON.stringify({ who, home: h })); } catch { /* full or private mode */ }
}
export function clearHome() { try { localStorage.removeItem(HOME_KEY); } catch { /* private mode */ } }

// ---- the last few chats, in memory, so reopening one paints at once ----
const CHAT_MEMO_MAX = 8;
const chatMemo = new Map<string, ChatFull>();
function keepChat(c: ChatFull) {
  chatMemo.delete(c.id); chatMemo.set(c.id, c); // newest last
  while (chatMemo.size > CHAT_MEMO_MAX) chatMemo.delete(chatMemo.keys().next().value!);
  return c;
}
/** The last copy of a chat this session fetched, or null. Use it as a starting state, then refresh. */
export function peekChat(id: string): ChatFull | null { return chatMemo.get(id) ?? null; }

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
  chat: (chat: string) => rpc<ChatFull>('holler_chat', { p_chat: chat }).then(keepChat),
  saved: () => rpc<Polo[]>('holler_saved'),
  profile: (person: string) => rpc<Person & { stats: ProfileStats }>('holler_profile', { p_person: person }),
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
  games: () => rpc<{ games: Game[] }>('holler_games'),
  gameMove: (id: string, version: number, move: { cell: number } | { path: number[] }) =>
    rpc<Game>('holler_game_move', { p_game: id, p_version: version, p_move: move }),
  gameLaughed: (id: string, actor: string, cracked: number | null) =>
    rpc<Game>('holler_game_laughed', { p_game: id, p_actor: actor, p_cracked: cracked }),
  cardStart: (chat: string, order: string[], opts: { stack?: boolean } = {}) => rpc<Game>('holler_card_start', { p_chat: chat, p_order: order, p_opts: opts }),
  cardMove: (id: string, version: number, move: CardMove) => rpc<Game>('holler_card_move', { p_game: id, p_version: version, p_move: move }),
  cardLeave: (id: string) => rpc<Game>('holler_card_leave', { p_game: id }),
  gameResign: (id: string) => rpc<Game>('holler_game_resign', { p_game: id }),
  zoomMove: (id: string, move: ZoomMove) => rpc<Game>('holler_zoom_move', { p_game: id, p_move: move }),
  saidMove: (id: string, move: SaidMove) => rpc<Game>('holler_said_move', { p_game: id, p_move: move }),
  /** The actor counts a near miss on their Charades act as right (fewest points, marked counted). */
  charadesCount: (id: string, guesser: string) => rpc<Game>('holler_charades_count', { p_game: id, p_guesser: guesser }),
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

// ---- resumable upload (tus) for long hollers ----
// An iPhone freezes a web app's network the moment it leaves the screen, so one big POST of a
// several-minute video dies whenever the sender locks the phone or switches apps, and every retry
// started from zero. Here the file goes up in 6 MB pieces (storage requires exactly 6 MB); the
// server remembers how far it got, so a retry, a reload or the next launch picks up where it left off.
export const TUS_CHUNK = 6 * 1024 * 1024;
const TUS_URL = `${SB_URL}/storage/v1/upload/resumable`;
const tusHeaders = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Tus-Resumable': '1.0.0' });
const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));

type XhrOut = { status: number; text: string; header: (h: string) => string | null };
function xhrCall(method: string, url: string, headers: Record<string, string>, body: Blob | null, signal?: AbortSignal, onProgress?: (loaded: number) => void): Promise<XhrOut> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(Object.assign(new Error('cancelled'), { fatal: true })); return; }
    const xhr = new XMLHttpRequest();
    const onAbort = () => { xhr.abort(); reject(Object.assign(new Error('cancelled'), { fatal: true })); };
    signal?.addEventListener('abort', onAbort, { once: true });
    // the app came back on screen: a piece frozen while the phone slept may never answer, so start it over
    const onWake = () => { xhr.abort(); reject(new Error('network')); };
    window.addEventListener('holler-wake', onWake, { once: true });
    const done = () => { signal?.removeEventListener('abort', onAbort); window.removeEventListener('holler-wake', onWake); };
    xhr.open(method, url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.timeout = 180_000; // a 6 MB piece on a slow line; a stalled one (phone was asleep) gets retried
    if (onProgress) xhr.upload.onprogress = e => onProgress(e.loaded);
    xhr.onload = () => { done(); resolve({ status: xhr.status, text: xhr.responseText, header: h => xhr.getResponseHeader(h) }); };
    xhr.onerror = () => { done(); reject(new Error('network')); };
    xhr.ontimeout = () => { done(); reject(new Error('network')); };
    xhr.send(body);
  });
}

function refused(status: number, text: string) {
  const big = status === 413 || /too large|exceeded|maximum size/i.test(text);
  const fatal = big || (status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 423 && status !== 429);
  const msg = big ? 'That video is too big to send' : fatal ? 'The upload was refused. Try recording it again.' : `Upload failed (${status})`;
  return Object.assign(new Error(msg), { fatal, detail: text });
}

/** Upload in resumable pieces. `known` is a tus URL saved from an earlier try; `onUrl` hands back a new one to save. */
export function uploadResumable(path: string, blob: Blob, opts: { known?: string | null; onUrl?: (u: string | null) => void; onProgress?: (f: number) => void; signal?: AbortSignal }): Promise<void> {
  const { signal, onProgress, onUrl } = opts;
  let url = opts.known || null;
  const size = blob.size;
  const attempt = async () => {
    let offset = 0;
    if (url) {
      const h = await xhrCall('HEAD', url, tusHeaders(), null, signal);
      if (h.status === 200 || h.status === 204) offset = Number(h.header('Upload-Offset') || 0);
      else if (h.status === 404 || h.status === 410 || h.status === 403) { url = null; onUrl?.(null); }
      else throw refused(h.status, h.text);
    }
    if (!url) {
      const meta = `bucketName ${b64('holler')},objectName ${b64(path)},contentType ${b64(blob.type || 'application/octet-stream')},cacheControl ${b64('31536000')}`;
      const c = await xhrCall('POST', TUS_URL, { ...tusHeaders(), 'Upload-Length': String(size), 'Upload-Metadata': meta }, null, signal);
      if (c.status === 409 || /already exists|Duplicate/i.test(c.text)) { onProgress?.(1); return; } // landed on an earlier try
      if (c.status !== 201 || !c.header('Location')) throw refused(c.status, c.text);
      url = c.header('Location')!; onUrl?.(url);
    }
    onProgress?.(offset / size);
    while (offset < size) {
      const end = Math.min(offset + TUS_CHUNK, size);
      const from = offset;
      const r = await xhrCall('PATCH', url!, { ...tusHeaders(), 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': String(offset) },
        blob.slice(offset, end), signal, loaded => onProgress?.((from + loaded) / size));
      if (r.status === 409) { // the server has a different offset (a piece landed but the answer was lost): ask again
        throw Object.assign(new Error('resync'), { resync: true });
      }
      if (r.status === 404 || r.status === 410) { url = null; onUrl?.(null); throw new Error('expired'); }
      if (r.status !== 204 && r.status !== 200) throw refused(r.status, r.text);
      offset = Number(r.header('Upload-Offset') || end);
      onProgress?.(offset / size);
    }
  };
  return (async () => {
    let wait = 1000;
    for (let i = 0; ; i++) {
      try { return await attempt(); }
      catch (e) {
        if ((e as { fatal?: boolean }).fatal || i >= 12 || signal?.aborted) throw e;
        if ((e as { resync?: boolean }).resync) continue;
        if (document.visibilityState === 'hidden') { // no point hammering while the phone is asleep: wait to be back
          await new Promise<void>(r => { const f = () => { if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', f); r(); } }; document.addEventListener('visibilitychange', f); });
          i = 0; wait = 1000; continue;
        }
        await new Promise(r => setTimeout(r, wait)); wait = Math.min(wait * 2, 15000);
      }
    }
  })();
}

// ---- media cache: whole files in Cache Storage so rewatching costs no data ----
// A holler is downloaded once, whole, into Cache Storage, and played from there. Never streamed as well.
const CACHE = 'holler-media-v1';
const urlMemo = new Map<string, Promise<string>>();
type Dl = { p: Promise<Blob>; loaded: number; total: number; subs: Set<(f: number) => void> };
const downloads = new Map<string, Dl>(); // one network fetch per file, shared by whoever asks meanwhile
let watching = 0; // downloads someone is waiting on to play right now; prefetch steps aside for them

/** Fetch a file into the media cache (or join the fetch already going). Reports 0..1 when the size is known. */
function download(path: string, onProgress?: (f: number) => void): Promise<Blob> {
  let d = downloads.get(path);
  if (!d) {
    const dl: Dl = { loaded: 0, total: 0, subs: new Set(), p: null as unknown as Promise<Blob> };
    const tell = () => { if (dl.total) { const f = Math.min(1, dl.loaded / dl.total); dl.subs.forEach(s => s(f)); } };
    dl.p = (async () => {
      const url = publicUrl(path);
      const cache = await caches.open(CACHE);
      const net = await fetch(url);
      if (!net.ok) throw new Error('fetch ' + net.status);
      const type = net.headers.get('content-type') || 'application/octet-stream';
      dl.total = Number(net.headers.get('content-length')) || 0;
      let blob: Blob;
      if (net.body && dl.total) {
        const reader = net.body.getReader(); const parts: BlobPart[] = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value as Uint8Array<ArrayBuffer>); dl.loaded += value.byteLength; tell();
        }
        blob = new Blob(parts, { type });
      } else blob = await net.blob();
      await cache.put(url, new Response(blob, { headers: { 'content-type': type, 'content-length': String(blob.size) } }));
      return blob;
    })();
    d = dl;
    downloads.set(path, dl);
    const off = () => { if (downloads.get(path) === dl) downloads.delete(path); dl.subs.clear(); };
    dl.p.then(off, off);
  }
  if (onProgress) { d.subs.add(onProgress); if (d.total) onProgress(Math.min(1, d.loaded / d.total)); }
  return d.p;
}

/** A playable URL for a holler: from the device cache, else downloaded whole first (onProgress 0..1 while it comes).
 *  Falls back to the public URL when Cache Storage is not available. */
export function mediaUrl(path: string, onProgress?: (f: number) => void): Promise<string> {
  let p = urlMemo.get(path);
  if (!p) {
    p = (async () => {
      const url = publicUrl(path);
      try {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(url);
        if (hit) return URL.createObjectURL(await hit.blob());
        watching++;
        try { return URL.createObjectURL(await download(path, onProgress)); } finally { watching--; }
      } catch {
        return url;
      }
    })();
    p.catch(() => urlMemo.delete(path));
    urlMemo.set(path, p);
  } else if (onProgress) {
    const d = downloads.get(path); // someone else started it: listen in
    if (d) { watching++; d.subs.add(onProgress); if (d.total) onProgress(Math.min(1, d.loaded / d.total)); const done = () => { watching--; }; d.p.then(done, done); }
  }
  return p;
}

// ---- prefetch: warm what people are about to watch, quietly, one file at a time ----
type Job = { paths: string[]; budget: number; spent: number };
const jobs: Job[] = [];
let prefetching = false;
let gate: () => boolean = () => false;
/** Something that should hold prefetch back while true (the outbox sets this to "a holler is going up"). */
export function setPrefetchGate(f: () => boolean) { gate = f; }
const nap = (ms: number) => new Promise(r => setTimeout(r, ms));
async function quiet() {
  for (;;) {
    if (document.hidden) { await new Promise<void>(r => { const f = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', f); r(); } }; document.addEventListener('visibilitychange', f); }); continue; }
    if (watching > 0 || gate()) { await nap(1500); continue; }
    return;
  }
}
/** Download these hollers into the device cache ahead of time, newest request first, one at a time.
 *  Skips files already here, pauses while the app is hidden, a holler is loading to play, or one is sending,
 *  and stops a request once it has used its byte budget (checked between files). */
export function prefetch(paths: string[], budgetBytes = 30 * 1024 * 1024) {
  const list = [...new Set(paths.filter(Boolean))];
  if (!list.length || typeof caches === 'undefined') return;
  jobs.unshift({ paths: list, budget: budgetBytes, spent: 0 });
  if (!prefetching) void pump();
}
async function pump() {
  prefetching = true;
  try {
    let cache: Cache;
    try { cache = await caches.open(CACHE); } catch { jobs.length = 0; return; }
    while (jobs.length) {
      const job = jobs[0];
      const path = job.paths.shift();
      if (!path || job.spent >= job.budget) { jobs.shift(); continue; }
      if (urlMemo.has(path) || downloads.has(path) || await cache.match(publicUrl(path))) continue;
      await quiet();
      if (urlMemo.has(path)) continue; // asked for to play while we waited
      try { job.spent += (await download(path)).size; } catch { /* no signal or gone: leave it for when it is watched */ }
    }
  } finally { prefetching = false; }
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
export async function clearCache() { try { jobs.length = 0; await caches.delete(CACHE); urlMemo.clear(); } catch { /* ignore */ } }

export function rid(n = 16) {
  const a = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const b = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(b, x => a[x % a.length]).join('');
}
