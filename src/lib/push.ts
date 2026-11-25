import { api } from './api';

export type PushState = 'on' | 'off' | 'denied' | 'unsupported' | 'ios-install';

// VAPID public key (the private half lives in Supabase function secrets).
const VAPID_PUBLIC = 'BI2q5Yc8po1cn1FaqA6y8E8XpxgsPHnlAnpyX7y6wJE8AClv2h6od1MEIITD9VpVXP-e4774F2IqRFbPC8j5--o';

function b64ToBytes(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

// The service worker is only registered in production builds; in dev there is nothing to wait for.
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (!existing) return null;
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((res) => setTimeout(() => res(null), 4000)),
    ]);
  } catch { return null; }
}

function supported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function pushState(): Promise<PushState> {
  if (isIos() && !isStandalone()) return 'ios-install';
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registration();
  if (!reg) return 'unsupported';
  try {
    const sub = await reg.pushManager.getSubscription();
    return sub && Notification.permission === 'granted' ? 'on' : 'off';
  } catch { return 'unsupported'; }
}

export async function enablePush(): Promise<PushState> {
  if (isIos() && !isStandalone()) return 'ios-install';
  if (!supported()) return 'unsupported';
  const reg = await registration();
  if (!reg) return 'unsupported';
  try {
    const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (perm === 'denied') return 'denied';
    if (perm !== 'granted') return 'off';
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64ToBytes(VAPID_PUBLIC) as BufferSource,
      });
    }
    await api.pushSub(sub.toJSON(), true);
    return 'on';
  } catch { return 'off'; }
}
