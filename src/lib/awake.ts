// Keep the screen on while Holler is open and in front, so it never dims or locks mid-recording, mid-watch or mid-game.
// A phone left on the table with Holler open still gets to sleep: after 5 minutes with no touch, and nothing recording
// or playing, the lock is let go; the next touch takes it again.
// (The browser drops a wake lock by itself whenever the app leaves the front, so it is asked for again on return.
// iPhone: Safari 16.4 and up; Home Screen apps from iOS 18.4. Where it is not supported, nothing happens.)
type Lock = { release: () => Promise<void>; released?: boolean; addEventListener?: (t: 'release', f: () => void) => void };
const IDLE_MS = 5 * 60 * 1000;

let lock: Lock | null = null;
let asking = false;
let lastTouch = Date.now();
let started = false;

/** Something is going on that the person is watching or making, even with their hands off the screen. */
function busy(): boolean {
  if (document.querySelector('.chat.is-rec')) return true;   // a take is running
  for (const v of Array.from(document.querySelectorAll('video, audio')) as HTMLMediaElement[]) {
    if (!v.paused && !v.ended && !v.muted && v.currentTime > 0) return true;   // a holler is playing (the live camera preview is muted)
  }
  return false;
}

async function take() {
  if (lock || asking || document.hidden || !('wakeLock' in navigator)) return;
  asking = true;
  try {
    const l = await (navigator as Navigator & { wakeLock: { request: (t: 'screen') => Promise<Lock> } }).wakeLock.request('screen');
    lock = l;
    l.addEventListener?.('release', () => { if (lock === l) lock = null; });
  } catch { /* low battery mode, or not allowed right now: try again on the next touch */ }
  asking = false;
}
function drop() { const l = lock; lock = null; void l?.release().catch(() => {}); }

/** Call once when the app starts. */
export function startAwake() {
  if (started || typeof document === 'undefined') return;
  started = true;
  const touch = () => { lastTouch = Date.now(); void take(); };
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, touch, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) lock = null; else { lastTouch = Date.now(); void take(); } });
  setInterval(() => {
    if (document.hidden) return;
    if (busy()) { lastTouch = Date.now(); void take(); return; }
    if (lock && Date.now() - lastTouch > IDLE_MS) drop();
  }, 30000);
  void take();
}
