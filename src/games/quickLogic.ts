// Seven Letters and Trivia: dealing, checking words, and scoring. Rules for who plays when live in supabase/games3.sql.
import type { Game } from '../lib/api';
import { CATEGORIES, QUESTIONS, type CatKey, type Question } from './content/quiz';
import { freshFirst, shuffle } from './content/shuffle';

// ---------------------------------------------------------------- Seven Letters
let dictP: Promise<{ words: Set<string>; seeds: string[] }> | null = null;
/** The word list is big (90 kB zipped), so it only loads when someone plays. */
export function loadDict() {
  if (!dictP) {
    dictP = import('./content/dict').then(m => ({ words: new Set(m.DICT.split(' ')), seeds: m.SEEDS.split(' ') }));
    dictP.catch(() => { dictP = null; });
  }
  return dictP;
}

/** Can this word be made from the rack (each letter used at most as often as it appears)? */
export function fits(word: string, rack: string): boolean {
  const left = [...rack];
  for (const ch of word) { const i = left.indexOf(ch); if (i < 0) return false; left.splice(i, 1); }
  return true;
}

export const WORD_POINTS: Record<number, number> = { 3: 1, 4: 2, 5: 4, 6: 6, 7: 10 };
export const wordPoints = (w: string) => WORD_POINTS[w.length] || 0;

/** Deal a rack from a seven-letter word this chat has not had lately. Letters are scrambled. */
export function dealRack(seeds: string[], used: string[]): { seed: string; rack: string } {
  const seed = freshFirst(seeds, s => s, used)[0] || 'strange';
  let rack = seed;
  for (let i = 0; i < 6 && rack === seed; i++) rack = shuffle([...seed]).join('');
  return { seed, rack };
}

/** Every word the rack makes, longest first. */
export function allWords(words: Set<string>, rack: string): string[] {
  return [...words].filter(w => fits(w, rack)).sort((a, b) => b.length - a.length || a.localeCompare(b));
}

export function wordsScores(g: Game): Record<string, number> {
  const s: Record<string, number> = Object.fromEntries(g.order.map(id => [id, 0]));
  for (const [who, p] of Object.entries(g.plays || {})) s[who] = (p.words || []).reduce((n, w) => n + wordPoints(w), 0);
  return s;
}

// ---------------------------------------------------------------- Trivia
export const TRIVIA_SEC = 15;
export const TRIVIA_COUNT = 10;
export const TRIVIA_DECKS: { id: 'mixed' | CatKey; label: string }[] = [{ id: 'mixed', label: 'Mixed' }, ...CATEGORIES.map(c => ({ id: c.key, label: c.short }))];
const byId = new Map(QUESTIONS.map(q => [q.id, q]));
export const question = (id: string): Question | undefined => byId.get(id);

/** Ten questions: fresh ones first, easy to hard, and spread across categories when mixed. */
export function pickQuestions(deck: string, used: string[]): string[] {
  const pool = deck === 'mixed' ? QUESTIONS : QUESTIONS.filter(q => q.cat === deck);
  const fresh = freshFirst(shuffle(pool), q => q.id, used);
  const out: Question[] = []; const cats = new Map<string, number>();
  const want = [1, 1, 1, 2, 2, 2, 2, 3, 3, 3];
  for (const d of want) {
    const q = fresh.find(x => !out.includes(x) && x.difficulty === d && (deck !== 'mixed' || (cats.get(x.cat) || 0) < 1))
      || fresh.find(x => !out.includes(x) && (deck !== 'mixed' || (cats.get(x.cat) || 0) < 2))
      || fresh.find(x => !out.includes(x));
    if (!q) break;
    out.push(q); cats.set(q.cat, (cats.get(q.cat) || 0) + 1);
  }
  return out.map(q => q.id);
}

/** Right answer: 100, plus up to 50 for speed. */
export function answerPoints(q: Question | undefined, a: { pick: number; ms: number } | undefined): number {
  if (!q || !a || a.pick !== q.answer) return 0;
  return 100 + Math.max(0, Math.round(50 * (1 - a.ms / (TRIVIA_SEC * 1000))));
}

export function triviaScores(g: Game): Record<string, number> {
  const s: Record<string, number> = Object.fromEntries(g.order.map(id => [id, 0]));
  const qs = (g.qids || []).map(question);
  for (const [who, p] of Object.entries(g.plays || {})) s[who] = qs.reduce((n, q, i) => n + answerPoints(q, p.answers?.[i]), 0);
  return s;
}

// ---------------------------------------------------------------- a go in progress, kept on the phone in case the app closes
const goKey = (gid: string) => `holler.go.${gid}`;
export function loadGo<T>(gid: string): T | null { try { return JSON.parse(localStorage.getItem(goKey(gid)) || 'null'); } catch { return null; } }
export function saveGo(gid: string, v: unknown) { try { localStorage.setItem(goKey(gid), JSON.stringify(v)); } catch { /* private mode */ } }
export function dropGo(gid: string) { try { localStorage.removeItem(goKey(gid)); } catch { /* ignore */ } }
