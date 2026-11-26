// Poker Face and Charades Relay: decks, scoring and the little bits of text the screens share.
// The rules (who has the truth, whose move it is, whether a guess is right) live in supabase/games2.sql.
import type { ChatFull, Game, Person } from '../lib/api';
import { FACTS } from './content/facts';
import { WORDS } from './content/words';
import { DECKS as WORD_DECKS } from './content/charades';
import { freshFirst } from './content/shuffle';

export const GAME_NAME: Record<Game['kind'], string> = { passiton: 'Pass It On', poker: 'Poker Face', charades: 'Charades Relay' };
/** Strip tiles are narrow. */
export const TILE_NAME: Record<Game['kind'], string> = { passiton: 'Pass It On', poker: 'Poker Face', charades: 'Charades' };

const local = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const keep = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
/** Ids this chat has used lately, newest last (kept on the device, like Pass It On's phrases). */
export const usedIn = (key: string): string[] => { try { return JSON.parse(local(key, '[]')); } catch { return []; } };
export const markUsed = (key: string, id: string) => keep(key, JSON.stringify([...usedIn(key).filter(x => x !== id), id].slice(-120)));

// ---------------------------------------------------------------- Poker Face cards
export type PokerDeck = 'facts' | 'words';
export const POKER_DECKS: { id: PokerDeck; label: string; note: string }[] = [
  { id: 'facts', label: 'Facts', note: 'A strange true fact with a blank.' },
  { id: 'words', label: 'Words', note: 'A real word nobody knows. What does it mean?' },
];
export type PokerCard = { id: string; deck: PokerDeck; question: string; answer: string };

export function pokerCards(deck: PokerDeck, used: string[]): PokerCard[] {
  const all: PokerCard[] = deck === 'facts'
    ? FACTS.map(f => ({ id: `facts:${f.id}`, deck, question: f.q, answer: f.truth }))
    : WORDS.map(w => ({ id: `words:${w.id}`, deck, question: `What does "${w.word}" mean? (${w.pos})`, answer: w.truth }));
  return freshFirst(all, c => c.id, used);
}

/** Find the truth: +2. Each person who believes your made-up answer: +1. The truth teller gets +1 for each person who believed them. */
export function pokerScores(g: Game): Record<string, number> {
  const s: Record<string, number> = Object.fromEntries(g.order.map(id => [id, 0]));
  if (!g.votes || !g.truth) return s;
  for (const [voter, pick] of Object.entries(g.votes)) {
    if (pick === g.truth) { s[voter] = (s[voter] || 0) + 2; s[pick] = (s[pick] || 0) + 1; }
    else s[pick] = (s[pick] || 0) + 1;
  }
  return s;
}

// ---------------------------------------------------------------- Charades Relay words
export const CHARADES_DECKS = Object.entries(WORD_DECKS).map(([id, d]) => ({ id, label: d.label }));
export function charadesWords(deck: string, used: string[]): string[] {
  const words = (WORD_DECKS[deck] || WORD_DECKS.mixed).words;
  return freshFirst(words, w => w.toLowerCase(), used);
}

/** Points for one right guess: sooner in the clip scores more. */
export function guessPoints(t: number | null, dur: number): number {
  if (t == null) return 0;
  const d = dur > 0 ? dur : 15;
  return t <= d / 3 ? 3 : t <= (2 * d) / 3 ? 2 : 1;
}

/** Guessers score by speed; the actor gets +1 for every person who got theirs. */
export function charadesScores(g: Game): Record<string, number> {
  const s: Record<string, number> = Object.fromEntries(g.order.map(id => [id, 0]));
  for (const a of g.acts || []) {
    const dur = a.clip?.duration || g.turnSec || 15;
    for (const [who, r] of Object.entries(a.results || {})) {
      if (!r.ok) continue;
      s[who] = (s[who] || 0) + guessPoints(r.t, dur);
      s[a.who] = (s[a.who] || 0) + 1;
    }
  }
  return s;
}

// ---------------------------------------------------------------- shared
export const first = (p?: Person | null) => (p?.name || 'Someone').split(' ')[0];
export const personIn = (chat: ChatFull, me: Person) => (id: string) => (id === me.id ? me : chat.members.find(m => m.id === id));
export const owes = (g: Game, me: string) => g.status === 'playing' && (g.todo || []).includes(me);

/** The line under a round game's tile in the strip. */
export function tileLine(g: Game, me: Person, chat: ChatFull): string {
  const n = g.order.length;
  if (g.status === 'ended') return 'Ended early';
  if (g.status === 'done') return g.kind === 'poker' ? 'See who lied' : 'Final scores';
  if (g.kind === 'poker') {
    if (g.phase === 'vote') return owes(g, me.id) ? 'Your vote' : 'Voting';
    if (owes(g, me.id)) return 'Your answer';
    return `${(g.recorded || []).length} of ${n} answered`;
  }
  const mine = !(g.acted || []).includes(me.id);
  if (mine) return 'Act yours';
  if (owes(g, me.id)) return 'Guess';
  const left = g.order.filter(id => !(g.acted || []).includes(id));
  return left.length ? `${first(chat.members.find(m => m.id === left[0]))} acts next` : 'Guessing';
}

/** Standings, highest first, ties share a place. */
export function standings(scores: Record<string, number>): { id: string; pts: number; place: number }[] {
  const rows = Object.entries(scores).map(([id, pts]) => ({ id, pts })).sort((a, b) => b.pts - a.pts);
  let place = 0, last = Infinity;
  return rows.map((r, i) => { if (r.pts !== last) { place = i + 1; last = r.pts; } return { ...r, place }; });
}
