// Per-device settings (a phone and a laptop can differ).
export function isSimple() { try { return localStorage.getItem('holler.simple') === '1'; } catch { return false; } }
export function setSimple(on: boolean) { try { localStorage.setItem('holler.simple', on ? '1' : '0'); } catch { /* private mode */ } }

/** iPhone Home Screen apps drop camera and mic permission whenever the address changes (WebKit bug
 *  215884), so there the app moves between screens without touching the address. */
export const routeInMemory = (() => {
  try {
    const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
    return ios && standalone;
  } catch { return false; }
})();

/** How this device takes part: 'on' = camera and mic, 'voice' = mic only (voice hollers, notes, games),
 *  'off' = no camera and no mic (notes and games). For a phone whose camera won't behave. */
export type CamMode = 'on' | 'voice' | 'off';
export function camMode(): CamMode { try { const v = localStorage.getItem('holler.cam'); return v === 'voice' || v === 'off' ? v : 'on'; } catch { return 'on'; } }
export function setCamMode(m: CamMode) { try { localStorage.setItem('holler.cam', m); } catch { /* private mode */ } }
