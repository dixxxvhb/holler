// The decks behind Poker Face and Charades Relay. Heavy (hundreds of facts and words), so only the games bundle imports it.
import { FACTS } from './content/facts';
import { WORDS } from './content/words';
import { DECKS as WORD_DECKS } from './content/charades';
import { freshFirst } from './content/shuffle';
import type { PokerCard, PokerDeck } from './roundLogic';

export function pokerCards(deck: PokerDeck, used: string[]): PokerCard[] {
  const all: PokerCard[] = deck === 'facts'
    ? FACTS.map(f => ({ id: `facts:${f.id}`, deck, question: f.q, answer: f.truth }))
    : WORDS.map(w => ({ id: `words:${w.id}`, deck, question: `What does "${w.word}" mean? (${w.pos})`, answer: w.truth }));
  return freshFirst(all, c => c.id, used);
}

export const CHARADES_DECKS = Object.entries(WORD_DECKS).map(([id, d]) => ({ id, label: d.label }));
export function charadesWords(deck: string, used: string[]): string[] {
  const words = (WORD_DECKS[deck] || WORD_DECKS.mixed).words;
  return freshFirst(words, w => w.toLowerCase(), used);
}

