// The games Holler offers, in the order the Play page and the Play sheet show them.
// Light on purpose: this file is in the first download, so no decks and no screens.
import type { GameKind } from '../lib/api';

export type CatalogGroup = 'camera' | 'quick' | 'board';
export type CatalogItem = { kind: GameKind; group: CatalogGroup; icon: string; min: number; max: number; line: string };

export const GROUP_LABEL: Record<CatalogGroup, string> = { camera: 'On camera', quick: 'Quick', board: 'Board and cards' };

export const CATALOG: CatalogItem[] = [
  { kind: 'passiton', group: 'camera', icon: 'chain', min: 3, max: 5, line: 'You act out a secret phrase. Each person copies only the clip before theirs. The last one guesses.' },
  { kind: 'poker', group: 'camera', icon: 'facecam', min: 3, max: 5, line: 'Everyone answers the same question to camera. One of you secretly has the real answer. Vote on who.' },
  { kind: 'charades', group: 'camera', icon: 'eye', min: 2, max: 5, line: 'Everyone acts out a secret word with no talking. Guess the others. Faster scores more.' },
  { kind: 'spot', group: 'camera', icon: 'timer', min: 2, max: 5, line: 'Trivia on camera. Your questions appear the moment you hit record. Everyone watches you sweat.' },
  { kind: 'laugh', group: 'camera', icon: 'laugh', min: 2, max: 5, line: "Record something to crack them up. Watch theirs while your camera watches you. Smile and you're out." },
  { kind: 'zoom', group: 'camera', icon: 'camera', min: 2, max: 6, line: 'Film something up close. Everyone sees it way zoomed in and pulling out. Name it before it gets obvious.' },
  { kind: 'words', group: 'quick', icon: 'letters', min: 2, max: 5, line: 'Same seven letters for everyone. Make as many words as you can before the clock runs out.' },
  { kind: 'trivia', group: 'quick', icon: 'quiz', min: 2, max: 5, line: 'Ten questions, fifteen seconds each. Same questions for everyone. Faster scores more.' },
  { kind: 'said', group: 'quick', icon: 'wow', min: 3, max: 6, line: 'Everyone answers a prompt about each other. Then guess who wrote what about you. No camera needed.' },
  { kind: 'lastcard', group: 'board', icon: 'cards', min: 2, max: 6, line: 'Match by color or number, hit them with Skips and Draw Twos, and get rid of every card first.' },
  { kind: 'checkers', group: 'board', icon: 'board', min: 2, max: 2, line: 'Classic checkers, one move at a time. Jumps are a must.' },
  { kind: 'ttt', group: 'board', icon: 'grid', min: 2, max: 2, line: 'Three in a row. Quick, and always good for a rematch.' },
];
export const GROUPS: CatalogGroup[] = ['camera', 'quick', 'board'];
/** "3 to 5", or just "2" when min and max match. */
export const countLine = (c: CatalogItem) => (c.min === c.max ? String(c.min) : `${c.min} to ${c.max}`);
