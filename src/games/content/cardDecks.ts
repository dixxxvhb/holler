// The three card decks by name, and the shape of a card. Light on purpose: the first download needs these, not the cards.
export type Deck = 'say' | 'guess' | 'act';
export type Card = { deck: Deck; id: string; text: string; sub: string; answer?: { n: number; source: string; year: number; note?: string } };

export const DECKS: { id: Deck; label: string }[] = [
  { id: 'say', label: 'Say' },
  { id: 'guess', label: 'Guess' },
  { id: 'act', label: 'Act' },
];
