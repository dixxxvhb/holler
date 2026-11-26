import { routeInMemory } from './lib/device';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, getToken, setToken, type Home } from './lib/api';
import { onLive, setMe, syncChats } from './lib/live';
import { busy, resumeOutbox } from './lib/outbox';
import { Toaster, toast, chatTitle } from './ui/bits';
import { Onboard } from './ui/Onboard';
import { HomeScreen } from './ui/HomeScreen';
import { ChatScreen } from './ui/ChatScreen';
import { Settings } from './ui/Settings';
import { Saved } from './ui/Saved';
import { ding } from './lib/sound';

type Ctx = { home: Home | null; refresh: () => Promise<void>; go: (h: string) => void; route: string[] };
const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

function parse() { return (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean); }

export default function App() {
  const [route, setRoute] = useState(parse());
  const [home, setHome] = useState<Home | null>(null);
  const [signedIn, setSignedIn] = useState(!!getToken());
  const [loadErr, setLoadErr] = useState('');
  const routeRef = useRef(route); routeRef.current = route;

  useEffect(() => { const f = () => setRoute(parse()); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  const go = useCallback((h: string) => {
    if (routeInMemory) setRoute(h.replace(/^#?\/?/, '').split('/').filter(Boolean));
    else location.hash = h;
  }, []);
  // a tapped notification asks the open app to switch chats (no reload, so no new camera prompt)
  useEffect(() => {
    const f = (e: MessageEvent) => { if (e.data?.type === 'holler-open') go(String(e.data.hash || '/').replace(/^#/, '')); };
    navigator.serviceWorker?.addEventListener('message', f);
    return () => navigator.serviceWorker?.removeEventListener('message', f);
  }, [go]);

  // a link from another device: #/link/<token>
  useEffect(() => {
    if (route[0] === 'link' && route[1]) {
      setToken(route[1]); setSignedIn(true); if (!routeInMemory) history.replaceState(null, '', location.pathname + '#/'); setRoute([]);
      setHome(null); void refresh(); // already signed in as someone else: show the linked person, not the old one
      toast('This device is linked');
    }
  }, [route]);

  const refresh = useCallback(async () => {
    if (!getToken()) return;
    try {
      const h = await api.home();
      setHome(h); setLoadErr('');
      setMe(h.me.id); syncChats(h.chats.map(c => c.id));
      void resumeOutbox(h.me.id, () => { void api.home().then(setHome).catch(() => {}); });
    } catch (e) {
      const m = e instanceof Error ? e.message : '';
      if (/not signed in/.test(m)) { setToken(null); setSignedIn(false); setHome(null); }
      else setLoadErr(m || 'Could not reach Holler');
    }
  }, []);

  useEffect(() => { if (signedIn) void refresh(); }, [signedIn, refresh]);

  // unread count on the Home Screen icon and in the tab title; the service worker adds to it when a push lands
  useEffect(() => {
    if (!home) return;
    const n = home.chats.reduce((t, c) => t + (c.muted ? 0 : c.unread), 0);
    document.title = n ? `(${n}) Holler` : 'Holler';
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    try { void (n ? nav.setAppBadge?.(n) : nav.clearAppBadge?.())?.catch(() => {}); } catch { /* not supported */ }
    void caches?.open('holler-badge').then(c => c.put('./badge', new Response(String(n)))).catch(() => {});
  }, [home]);

  // join links: #/join/CODE (after sign-in); once per code, however often home refreshes meanwhile
  const joining = useRef('');
  useEffect(() => {
    if (!signedIn || !home || route[0] !== 'join' || !route[1] || joining.current === route[1]) return;
    joining.current = route[1];
    api.join(route[1]).then(c => { void refresh(); go(`/c/${c.id}`); toast(`You're in ${chatTitle(c, home.me.id)}`); })
      .catch(e => { toast(e.message); go('/'); })
      .finally(() => { joining.current = ''; });
  }, [signedIn, home, route, refresh, go]);

  // anything new anywhere: refresh home; ping if it's not the chat on screen
  useEffect(() => onLive(e => {
    if (e.type !== 'polo' && e.type !== 'chat') return;
    void refresh();
    const onIt = routeRef.current[0] === 'c' && routeRef.current[1] === e.chat && !document.hidden;
    if (e.type === 'polo' && !e.data?.deleted && !onIt) {
      setHome(h => {
        const c = h?.chats.find(x => x.id === e.chat); const who = c?.members.find(m => m.id === e.from);
        if (c && !c.muted) {
          ding(h?.me.prefs?.sounds !== false);
          const txt = `${who?.name.split(' ')[0] || 'Someone'} hollered${c.name ? ' in ' + c.name : ''}`;
          if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
            try { new Notification('Holler', { body: txt, tag: e.chat, icon: './icon-192.png' }); } catch { /* some browsers need the SW */ }
          } else toast(txt, { label: 'Watch', run: () => go(`/c/${e.chat}`) }, 5000);
        }
        return h;
      });
    }
  }), [refresh, go]);

  useEffect(() => { const i = setInterval(() => { if (!document.hidden && routeRef.current[0] !== 'c') void refresh(); }, 20000); return () => clearInterval(i); }, [refresh]);

  // catch up when the app comes back to the front
  useEffect(() => {
    const f = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', f); return () => document.removeEventListener('visibilitychange', f);
  }, [refresh]);

  useEffect(() => {
    const f = (e: BeforeUnloadEvent) => { if (busy()) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', f); return () => window.removeEventListener('beforeunload', f);
  }, []);

  const ctx = useMemo(() => ({ home, refresh, go, route }), [home, refresh, go, route]);

  let screen;
  if (!signedIn) screen = <Onboard joining={route[0] === 'join' ? route[1] : undefined} onDone={() => setSignedIn(true)} />;
  else if (!home) screen = (
    <div className="center-screen">
      <div className="logo-pulse" />
      {loadErr && <><p className="muted">{loadErr}</p><button className="btn" onClick={() => void refresh()}>Try again</button></>}
    </div>
  );
  else if (route[0] === 'c' && route[1]) screen = <ChatScreen key={route[1]} chatId={route[1]} />;
  else if (route[0] === 'settings') screen = <Settings onSignOut={() => { setToken(null); setSignedIn(false); setHome(null); go('/'); }} />;
  else if (route[0] === 'saved') screen = <Saved />;
  else screen = <HomeScreen />;

  return (
    <AppCtx.Provider value={ctx}>
      {screen}
      <Toaster />
    </AppCtx.Provider>
  );
}
