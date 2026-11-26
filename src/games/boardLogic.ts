// Tic-Tac-Toe and Checkers on the phone: the same rules as supabase/games3.sql, used only to show what you can do.
// The server checks every move again, so a mistake here can only hide a move, never allow a wrong one.

// ---------------------------------------------------------------- Tic-Tac-Toe
export const TTT_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
/** The winning line, if there is one. */
export function tttLine(b: string): number[] | null {
  return TTT_LINES.find(([a, c, d]) => b[a] !== '.' && b[a] === b[c] && b[a] === b[d]) || null;
}

// ---------------------------------------------------------------- Checkers
// 64 squares, row by row from the top. 'd'/'D' = the first player (starts at the bottom, moves up),
// 'l'/'L' = the second player (starts at the top, moves down). Capitals are kings.
export type Side = 'd' | 'l';
const at = (b: string, r: number, c: number) => (r >= 0 && r < 8 && c >= 0 && c < 8 ? b[r * 8 + c] : null);
const dirs = (ch: string) => (ch === 'd' ? [-1] : ch === 'l' ? [1] : ch === 'D' || ch === 'L' ? [-1, 1] : []);
const opp = (s: Side): Side => (s === 'd' ? 'l' : 'd');
const put = (b: string, i: number, ch: string) => b.slice(0, i) + ch + b.slice(i + 1);

function jumps(b: string, i: number): number[] {
  const ch = b[i]; const side = ch.toLowerCase() as Side; const r = Math.floor(i / 8), c = i % 8; const out: number[] = [];
  if (side !== 'd' && side !== 'l') return out;
  for (const dr of dirs(ch)) for (const dc of [-1, 1]) {
    if (at(b, r + dr, c + dc)?.toLowerCase() === opp(side) && at(b, r + 2 * dr, c + 2 * dc) === '.') out.push((r + 2 * dr) * 8 + c + 2 * dc);
  }
  return out;
}
function steps(b: string, i: number): number[] {
  const ch = b[i]; const r = Math.floor(i / 8), c = i % 8; const out: number[] = [];
  for (const dr of dirs(ch)) for (const dc of [-1, 1]) if (at(b, r + dr, c + dc) === '.') out.push((r + dr) * 8 + c + dc);
  return out;
}

/** Every full jump path from square i (a jump must keep going; a new king stops). */
function jumpPaths(b: string, i: number): number[][] {
  const ch = b[i]; const side = ch.toLowerCase(); const far = side === 'd' ? 0 : 7; const out: number[][] = [];
  for (const n of jumps(b, i)) {
    let nb = put(put(put(b, i, '.'), (i + n) / 2, '.'), n, ch);
    const crowned = ch === side && Math.floor(n / 8) === far;
    if (crowned) { nb = put(nb, n, ch.toUpperCase()); out.push([i, n]); continue; }
    const more = jumpPaths(nb, n);
    if (more.length) for (const m of more) out.push([i, ...m]); else out.push([i, n]);
  }
  return out;
}

/** All legal moves for a side, as paths of squares. Captures are compulsory. */
export function legalMoves(b: string, side: Side): number[][] {
  const mine = [...b].map((ch, i) => (ch.toLowerCase() === side ? i : -1)).filter(i => i >= 0);
  const caps = mine.flatMap(i => jumpPaths(b, i));
  if (caps.length) return caps;
  return mine.flatMap(i => steps(b, i).map(n => [i, n]));
}

/** The board after a legal path (the screen shows it right away; the server's answer replaces it). */
export function applyPath(b: string, path: number[]): string {
  let ch = b[path[0]]; const side = ch.toLowerCase(); const far = side === 'd' ? 0 : 7;
  for (let k = 0; k < path.length - 1; k++) {
    const a = path[k], n = path[k + 1];
    b = put(b, a, '.');
    if (Math.abs(Math.floor(n / 8) - Math.floor(a / 8)) === 2) b = put(b, (a + n) / 2, '.');
    if (ch === side && Math.floor(n / 8) === far) ch = ch.toUpperCase();
    b = put(b, n, ch);
  }
  return b;
}

export const count = (b: string, side: Side) => [...b].filter(ch => ch.toLowerCase() === side).length;
