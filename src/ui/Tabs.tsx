import { useEffect, useState } from 'react';
import { useApp } from '../App';
import type { ChatSummary } from '../lib/api';
import { Icon } from './icons';

export type TabId = 'chats' | 'play' | 'you';
const TABS: TabId[] = ['chats', 'play', 'you'];
const ROUTE: Record<TabId, string> = { chats: '/', play: '/play', you: '/settings' };
const LABEL: Record<TabId, string> = { chats: 'Chats', play: 'Play', you: 'You' };
const ICON: Record<TabId, string> = { chats: 'chats', play: 'cards', you: 'you' };

/** The three places. Counts: unread hollers in chats that are not muted; games waiting on you. */
export function tabCounts(chats: ChatSummary[]) {
  return { chats: chats.reduce((t, c) => t + (c.muted ? 0 : c.unread), 0), play: chats.reduce((t, c) => t + (c.yourTurn || 0), 0), you: 0 };
}

// where the chalk pill sat last, so it slides from there even when a page mounts a fresh bar
let lastAt = -1;

export function Tabs({ on }: { on: TabId }) {
  const { home, go } = useApp();
  const n = tabCounts(home?.chats || []);
  const at = TABS.indexOf(on);
  const [pos, setPos] = useState(lastAt < 0 ? at : lastAt);
  useEffect(() => {
    lastAt = at;
    if (pos === at) return;
    const r = requestAnimationFrame(() => setPos(at));
    return () => cancelAnimationFrame(r);
  }, [at]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <nav className="tabs" aria-label="Places">
      <span className="tab-pill" aria-hidden="true" style={{ transform: `translateX(${pos * 100}%)` }} />
      {TABS.map(t => (
        <button key={t} className={`tab ${on === t ? 'on' : ''}`} data-tab={t} aria-current={on === t ? 'page' : undefined} onClick={() => { if (on !== t) go(ROUTE[t]); }}>
          <span className="tab-ic"><Icon name={ICON[t]} size={24} stroke={on === t ? 2.4 : 2} />
            {n[t] > 0 && <i className="tab-n">{n[t] > 99 ? '99+' : n[t]}</i>}</span>
          <span className="tab-lb">{LABEL[t]}</span>
        </button>
      ))}
    </nav>
  );
}
