// The games arrive as their own download, a moment after the room is on screen.
import { useCallback, useEffect, useState } from 'react';

export type Games = typeof import('./all');
let got: Games | null = null;
let going: Promise<Games> | null = null;
/** Fetch the games once. A failed try (no signal) is forgotten, so the next call tries again. */
export function loadGames(): Promise<Games> {
  if (got) return Promise.resolve(got);
  return (going ||= import('./all').then(m => (got = m)).catch(e => { going = null; throw e; }));
}
/** The games once they are here, or null while they load. `again` retries after a failed load. */
export function useGames(): [Games | null, () => void] {
  const [g, setG] = useState<Games | null>(got);
  const again = useCallback(() => { void loadGames().then(setG).catch(() => {}); }, []);
  useEffect(() => { if (!g) again(); }, [g, again]);
  return [g, again];
}
