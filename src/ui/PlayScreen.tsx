// Play: every game waiting on you across all chats, who you are waiting on, and a catalog to start any game.
// In the first download: import only light things here (api types, roundLogic, catalog, bits, icons). Never a game screen or a deck.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../App';
import { api, type ChatSummary, type Game, type GameKind } from '../lib/api';
import { onLive } from '../lib/live';
import { CATALOG, GROUPS, GROUP_LABEL, countLine, type CatalogItem } from '../games/catalog';
import { GAME_NAME, myGo, tileLine } from '../games/roundLogic';
import { AvatarStack, Sheet, chatTitle, toast } from './bits';
import { Icon } from './icons';

const ICON: Record<GameKind, string> = Object.fromEntries(CATALOG.map(c => [c.kind, c.icon])) as Record<GameKind, string>;
const changed = (g: Game) => new Date(g.endedAt || g.turnSince || g.since || g.createdAt).getTime() || 0;
const nudgedRecently = (g: Game) => !!g.nudgedAt && Date.now() - new Date(g.nudgedAt).getTime() < 6 * 3600e3;
const WEEK = 7 * 24 * 3600e3;

let lastGames: Game[] | null = null;   // the last answer, so coming back paints at once
let rose = false;   // the cards rise in once, the first time Play paints in this visit

export function PlayScreen() {
  const { home, go } = useApp();
  const [games, setGames] = useState<Game[] | null>(lastGames);
  const [err, setErr] = useState(false);
  const [pick, setPick] = useState<CatalogItem | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [rise] = useState(() => !rose);
  useEffect(() => { rose = true; }, []);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(() => {
    api.games().then(r => { lastGames = r.games; if (alive.current) { setGames(r.games); setErr(false); } })
      .catch(() => { if (alive.current) setErr(true); });
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const f = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, [load]);
  useEffect(() => onLive(e => { if (e.type === 'polo' || e.type === 'chat') load(); }), [load]);

  if (!home) return null;
  const me = home.me;
  const chatOf = new Map(home.chats.map(c => [c.id, c]));
  const mine = (games || []).filter(g => chatOf.has(g.chat)).map(g => ({ g, c: chatOf.get(g.chat)! }));
  const playing = mine.filter(x => x.g.status === 'playing' && x.g.order.includes(me.id));
  const newest = (a: { g: Game }, b: { g: Game }) => changed(b.g) - changed(a.g);
  const yours = playing.filter(x => myGo(x.g, me.id)).sort(newest);
  const theirs = playing.filter(x => !myGo(x.g, me.id)).sort(newest);
  const done = mine.filter(x => x.g.status !== 'playing' && !x.g.hidden && Date.now() - changed(x.g) < WEEK).sort(newest).slice(0, 6);
  const open = (x: { g: Game; c: ChatSummary }) => go(`/c/${x.c.id}/g/${x.g.id}`);
  // Pass It On has its own wording in the room's dock; the rest share tileLine
  const what = (g: Game, c: ChatSummary) => {
    if (g.kind !== 'passiton') return tileLine(g, me, c);
    if (g.status !== 'playing') return 'Watch the reveal';
    return g.turnPerson === me.id ? 'Your turn' : `${(c.members.find(m => m.id === g.turnPerson)?.name || 'Someone').split(' ')[0]} is up`;
  };
  const line = (x: { g: Game; c: ChatSummary }) => `${chatTitle(x.c, me.id)} · ${what(x.g, x.c)}`;
  const nudge = async (g: Game) => {
    try { const n = await api.gameNudge(g.id); setGames(l => { const nl = (l || []).map(y => (y.id === n.id ? { ...y, nudgedAt: n.nudgedAt || new Date().toISOString() } : y)); lastGames = nl; return nl; }); toast('Nudged'); }
    catch (e) { toast((e as Error).message); }
  };
  const skel = <div className="pl-sk-list" aria-busy="true"><span className="pl-sk" /><span className="pl-sk" /></div>;
  const waiting = games === null && !err;
  const failed = err && games === null;
  const summary = waiting || failed ? '' : yours.length ? `${yours.length} ${yours.length === 1 ? 'game' : 'games'} waiting on you` : 'Nothing is waiting on you';
  let n = 0;   // the order the cards rise in

  return (
    <div className={`home play ${rise ? 'rise' : ''}`} onScroll={e => { const s = (e.currentTarget as HTMLElement).scrollTop > 4; if (s !== scrolled) setScrolled(s); }}>
      <header className={`home-top ${scrolled ? 'scrolled' : ''}`}>
        <div className="ht-txt"><h1 className="shell-title">Play</h1>{summary && <p className="home-sum">{summary}</p>}</div>
      </header>

      {(waiting || failed || yours.length > 0) && <h2 className="sec-lbl">Your go</h2>}
      {waiting ? skel : failed ? (
        <div className="pl-err"><p>Could not load your games.</p><button className="btn" onClick={load}>Try again</button></div>
      ) : yours.length === 0 ? null : (
        <div className="pl-go-list">
          {yours.map(x => (
            <button key={x.g.id} className="pl-go" data-room={x.c.theme || 'ember'} style={{ ['--i' as string]: n++ }} onClick={() => open(x)}>
              <span className="pl-ic"><Icon name={ICON[x.g.kind]} size={24} /></span>
              <span className="pl-txt"><b>{GAME_NAME[x.g.kind]}</b><span>{line(x)}</span></span>
              <span className="pl-pill">Play</span>
            </button>
          ))}
        </div>
      )}

      {theirs.length > 0 && (<>
        <h2 className="sec-lbl">Waiting on them</h2>
        <div className="pl-rows pl-group" style={{ ['--i' as string]: n++ }}>
          {theirs.map(x => (
            <div key={x.g.id} className="pl-row">
              <button className="pl-row-main" onClick={() => open(x)}>
                <span className="pl-ic sm"><Icon name={ICON[x.g.kind]} size={20} /></span>
                <span className="pl-txt"><b>{GAME_NAME[x.g.kind]}</b><span>{line(x)}</span></span>
              </button>
              {x.g.kind === 'passiton' && <button className="pl-nudge" disabled={nudgedRecently(x.g)} onClick={() => void nudge(x.g)}>{nudgedRecently(x.g) ? 'Nudged' : 'Nudge'}</button>}
            </div>
          ))}
        </div>
      </>)}

      <h2 className="sec-lbl">Start a game</h2>
      {GROUPS.map(gr => (
        <div key={gr} className="pl-cat" data-group={gr}>
          <div className="pl-sub">{GROUP_LABEL[gr]}</div>
          <div className="pl-grid">
            {CATALOG.filter(c => c.group === gr).map(c => (
              <button key={c.kind} className="g-tile" style={{ ['--i' as string]: n++ }} onClick={() => setPick(c)}>
                <span className="g-tile-ic"><Icon name={c.icon} size={22} /></span>
                <b>{GAME_NAME[c.kind]}</b>
                <em>{countLine(c)}</em>
              </button>
            ))}
          </div>
        </div>
      ))}

      {done.length > 0 && (<>
        <h2 className="sec-lbl">Just finished</h2>
        <div className="pl-rows pl-group" style={{ ['--i' as string]: n++ }}>
          {done.map(x => (
            <div key={x.g.id} className="pl-row">
              <button className="pl-row-main" onClick={() => open(x)}>
                <span className="pl-ic sm"><Icon name={ICON[x.g.kind]} size={20} /></span>
                <span className="pl-txt"><b>{GAME_NAME[x.g.kind]}</b><span>{line(x)}</span></span>
              </button>
            </div>
          ))}
        </div>
      </>)}

      <Sheet open={!!pick} onClose={() => setPick(null)} title={pick ? GAME_NAME[pick.kind] : ''}>
        {pick && (<>
          <p className="g-sub">{pick.line}</p>
          {home.chats.length === 0 ? (<>
            <p className="g-sub">Start a chat first, then come back and play.</p>
            <button className="btn primary wide" onClick={() => { setPick(null); go('/'); }}>Chats</button>
          </>) : (<>
            <span className="lbl">Play with</span>
            <div className="pl-pick">
              {home.chats.map(c => {
                const short = c.members.length < pick.min;
                const others = c.members.filter(m => m.id !== me.id);
                return (
                  <button key={c.id} className={`pl-chat ${short ? 'short' : ''}`} data-room={c.theme || 'ember'} disabled={short} onClick={() => { const k = pick.kind; setPick(null); go(`/c/${c.id}/start/${k}`); }}>
                    <b>{chatTitle(c, me.id)}</b>
                    {short ? <em>{`Needs ${pick.min} people`}</em> : <AvatarStack people={others.length ? others : c.members} size={30} max={4} />}
                  </button>
                );
              })}
            </div>
          </>)}
        </>)}
      </Sheet>
    </div>
  );
}
