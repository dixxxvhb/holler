// Saving a holler out of Holler and onto the phone. On a phone that means the share sheet, which is the only way a
// web app can reach the camera roll (iPhone: Save Video). Anywhere else it is a plain download.
import { mediaBlob, type Person, type Polo } from './api';

const KEPT = 'holler.kept';
/** Hollers this device has already saved out, so the list can say so. */
export function keptIds(): Set<string> { try { return new Set(JSON.parse(localStorage.getItem(KEPT) || '[]') as string[]); } catch { return new Set(); } }
function markKept(id: string) { try { const s = keptIds(); s.add(id); localStorage.setItem(KEPT, JSON.stringify([...s].slice(-300))); } catch { /* private mode */ } }

const isPhone = () => { try { const ua = navigator.userAgent; return /iP(hone|ad|od)|Android/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); } catch { return false; } };
export const isIPhone = () => { try { return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); } catch { return false; } };

// the last file fetched stays in hand: an iPhone only opens the share sheet straight from a tap, so when the fetch
// took too long for that, the next tap can share at once
let held: { id: string; file: File } | null = null;

async function fileOf(p: Polo, author: Person | undefined, onProgress?: (f: number) => void): Promise<File> {
  if (held?.id === p.id) return held.file;
  if (!p.path) throw new Error('There is no file to save.');
  const blob = await mediaBlob(p.path, onProgress);
  const ext = p.path.split('.').pop() || (p.kind === 'audio' ? 'm4a' : 'mp4');
  const type = (blob.type && blob.type !== 'application/octet-stream' ? blob.type : p.mime || (p.kind === 'audio' ? 'audio/mp4' : 'video/mp4')).split(';')[0];
  const file = new File([blob], `holler-${(author?.name || 'holler').replace(/\W+/g, '-')}-${p.at.slice(0, 10)}-${p.id.slice(0, 4)}.${ext}`, { type });
  held = { id: p.id, file };
  return file;
}

/** 'saved' = handed to the phone (share sheet finished, or the download started); 'again' = the file is ready but the
 *  phone wants a fresh tap to open its share sheet; 'cancelled' = the person closed the sheet. Throws when the file can't be had. */
export async function saveToPhone(p: Polo, author: Person | undefined, onProgress?: (f: number) => void): Promise<'saved' | 'again' | 'cancelled'> {
  const file = await fileOf(p, author, onProgress);
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (isPhone() && typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file] }); markKept(p.id); held = null; return 'saved'; }
    catch (e) {
      const n = (e as DOMException)?.name;
      if (n === 'AbortError') return 'cancelled';
      if (n === 'NotAllowedError') return 'again';
      // anything else: fall through to a download
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a'); a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  markKept(p.id); held = null;
  return 'saved';
}
