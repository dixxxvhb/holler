import { useApp } from '../App';
import type { ChatSummary } from '../lib/api';

export type TabId = 'chats' | 'play' | 'you';
const ROUTE: Record<TabId, string> = { chats: '/', play: '/play', you: '/settings' };
const LABEL: Record<TabId, string> = { chats: 'Chats', play: 'Play', you: 'You' };

/** The three places. Counts: unread hollers in chats that are not muted; games waiting on you. */
export function tabCounts(chats: ChatSummary[]) {
  return { chats: chats.reduce((t, c) => t + (c.muted ? 0 : c.unread), 0), play: chats.reduce((t, c) => t + (c.yourTurn || 0), 0), you: 0 };
}

export function Tabs({ on }: { on: TabId }) {
  const { home, go } = useApp();
  const n = tabCounts(home?.chats || []);
  return (
    <nav className="tabs" aria-label="Places">
      {(['chats', 'play', 'you'] as TabId[]).map(t => (
        <button key={t} className={`tab ${on === t ? 'on' : ''}`} data-tab={t} aria-current={on === t ? 'page' : undefined} onClick={() => { if (on !== t) go(ROUTE[t]); }}>
          <span>{LABEL[t]}</span>
          {n[t] > 0 && <i className="tab-n">{n[t] > 99 ? '99+' : n[t]}</i>}
        </button>
      ))}
    </nav>
  );
}
