// Per-device settings (a phone and a laptop can differ).
export function isSimple() { try { return localStorage.getItem('holler.simple') === '1'; } catch { return false; } }
export function setSimple(on: boolean) { try { localStorage.setItem('holler.simple', on ? '1' : '0'); } catch { /* private mode */ } }
