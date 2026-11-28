// Poker Face and Charades Relay: scoring and the little bits of text the screens share.
// Nothing here may import a deck of words or questions: this file is in the first download. Decks live in roundDecks.ts.
// The rules (who has the truth, whose move it is, whether a guess is right) live in supabase/games2.sql.
import type { ChatFull, Game, Person } from '../lib/api';

export const GAME_NAME: Record<Game['kind'], string> = {
  passiton: 'Pass It On', poker: 'Poker Face', charades: 'Charades Relay', ttt: 'Tic-Tac-Toe', checkers: 'Checkers', words: 'Seven Letters', trivia: 'Trivia', spot: 'On The Spot', laugh: "Don't Laugh", lastcard: 'Last Card', zoom: 'Zoom In', said: 'Who Said It',
};
/** Strip tiles are narrow. */
export const TILE_NAME: Record<Game['kind'], string> = {
  passiton: 'Pass It On', poker: 'Poker Face', charades: 'Charades', ttt: 'Tic-Tac-Toe', checkers: 'Checkers', words: '7 Letters', trivia: 'Trivia', spot: 'On The Spot', laugh: "Don't Laugh", lastcard: 'Last Card', zoom: 'Zoom In', said: 'Who Said It',
};
export const isDuel = (g: Game) => g.kind === 'ttt' || g.kind === 'checkers';
/** Games where one person is up at a time (turnPerson). */
export const isTurns = (g: Game) => isDuel(g) || g.kind === 'lastcard';
export const isQuick = (g: Game) => g.kind === 'words' || g.kind === 'trivia';
export const isFace = (g: Game) => g.kind === 'spot' || g.kind === 'laugh';

/** Pass It On: the first person acts, the last one guesses, everyone between copies. */
export type Role = 'act' | 'copy' | 'guess';
export function roleOf(g: Game): Role { return g.idx === 0 ? 'act' : g.idx >= g.order.length - 1 ? 'guess' : 'copy'; }

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
export const owes = (g: Game, me: string) => g.status === 'playing' && (isTurns(g) ? g.turnPerson === me : (g.todo || []).includes(me));
/** Is it this person's go (Pass It On: playing and it is their clip; the rest: they owe a move)? */
export const myGo = (g: Game, me: string) => g.status === 'playing' && (g.kind === 'passiton' ? g.turnPerson === me : owes(g, me));
/** Has this person done their part for now (for the little faces on a tile)? */
export const doneFor = (g: Game, id: string) => g.status !== 'playing' || (isTurns(g) ? g.turnPerson !== id
  : isQuick(g) || g.kind === 'spot' ? (g.played || []).includes(id)
  : g.kind === 'laugh' || g.kind === 'zoom' || g.kind === 'said' ? !(g.todo || []).includes(id)
  : g.kind === 'poker' ? (g.phase === 'vote' || (g.recorded || []).includes(id)) : (g.acted || []).includes(id));

/** The line under a round game's tile in the strip. */
export function tileLine(g: Game, me: Person, chat: { members: Person[] }): string {
  const n = g.order.length;
  if (isTurns(g)) {
    if (g.status !== 'playing') return g.result === 'draw' ? 'A draw' : g.result === 'idle' ? 'Ended' : g.winner === me.id ? 'You won' : g.winner ? `${first(chat.members.find(m => m.id === g.winner))} won` : 'Over';
    return g.turnPerson === me.id ? 'Your move' : `${first(chat.members.find(m => m.id === g.turnPerson))}'s move`;
  }
  if (g.status === 'ended') return 'Ended early';
  if (g.status === 'done') return g.kind === 'poker' ? 'See who lied' : g.kind === 'said' ? 'See who said what' : g.kind === 'zoom' ? 'See what it all was' : 'Final scores';
  if (isQuick(g)) return owes(g, me.id) ? 'Your go' : `${(g.played || []).length} of ${n} played`;
  if (g.kind === 'spot') return owes(g, me.id) ? 'Your go' : `${(g.played || []).length} of ${n} went`;
  if (g.kind === 'zoom') {
    const mineIn = (g.filmed || []).includes(me.id) || (g.skipped || []).includes(me.id);
    if (!mineIn && g.order.includes(me.id)) return 'Film yours';
    return owes(g, me.id) ? 'Guess theirs' : `${(g.filmed || []).length} of ${n} filmed`;
  }
  if (g.kind === 'said') {
    if (g.phase === 'write') return owes(g, me.id) ? 'Write yours' : `${(g.wrote || []).length} of ${n} wrote`;
    return owes(g, me.id) ? 'Who said it?' : 'Guessing';
  }
  if (g.kind === 'laugh') return !(g.acted || []).includes(me.id) ? 'Record yours' : owes(g, me.id) ? 'Watch, no smiling' : `${(g.acted || []).length} of ${n} in`;
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
