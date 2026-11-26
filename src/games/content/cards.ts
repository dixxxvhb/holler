// Cards: something to talk about, drawn onto the video while you record.
// Three decks from Game Night's written prompts. Ids are stable so a chat's used cards go to the back.
import { ACT } from './act';
import { PROMPTS, ABOUT } from './say';
import { QUESTIONS } from './guess';
import { freshFirst } from './shuffle';

export type Deck = 'say' | 'guess' | 'act';
export type Card = { deck: Deck; id: string; text: string; sub: string; answer?: { n: number; source: string; year: number; note?: string } };

export const DECKS: { id: Deck; label: string }[] = [
  { id: 'say', label: 'Say' },
  { id: 'guess', label: 'Guess' },
  { id: 'act', label: 'Act' },
];

const hash = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };

/** Every card in a deck. `names` fills Say prompts that are about someone in the chat. */
export function deckCards(deck: Deck, names: string[] = []): Card[] {
  if (deck === 'say') {
    return PROMPTS
      .filter(p => !p.text.includes(ABOUT) || names.length > 0)
      .map(p => {
        const who = names.length ? names[Math.abs(parseInt(hash(p.id), 36)) % names.length] : '';
        return { deck, id: `say:${p.id}`, text: p.text.split(ABOUT).join(who), sub: 'Give yours, then defend it.' };
      });
  }
  if (deck === 'guess') {
    return QUESTIONS.map(q => ({
      deck, id: `guess:${hash(q.q)}`, text: q.q, sub: 'Guess the number and say why.',
      answer: { n: q.answer, source: q.source, year: q.year, note: q.note },
    }));
  }
  return ACT.map(a => ({ deck, id: `act:${hash(a)}`, text: a, sub: 'Act it out. Make them guess.' }));
}

/** Cards in the order to deal them: ones this chat hasn't used first. */
export function dealOrder(deck: Deck, used: string[], names: string[] = []): Card[] {
  return freshFirst(deckCards(deck, names), c => c.id, used);
}

/** A card's answer, for Guess cards shown after the clip plays. Looked up by id so old hollers keep working. */
export function cardById(id: string): Card | undefined {
  const deck = id.split(':')[0] as Deck;
  if (!DECKS.some(d => d.id === deck)) return undefined;
  return deckCards(deck, ['someone']).find(c => c.id === id);
}

/** A Pass It On phrase this chat hasn't seen lately. */
export function phraseOrder(used: string[]): { id: string; text: string }[] {
  return freshFirst(ACT.map(a => ({ id: `act:${hash(a)}`, text: a })), p => p.id, used);
}
