import { useEffect, useState } from 'react';
import { useApp } from '../App';
import { api, publicUrl } from '../lib/api';
import { onPresence, presenceOf } from '../lib/live';
import { Avatar, AvatarStack, Sheet, ago, chatTitle, THEMES, toast, tone } from './bits';
import { Icon } from './icons';
import { isIOS } from '../lib/speech';
import { enablePush, pushState } from '../lib/push';

function PushNudge() {
  const [st, setSt] = useState('');
  const [hide, setHide] = useState(() => { try { return !!localStorage.getItem('holler.pushnudge'); } catch { return false; } });
  useEffect(() => { void pushState().then(setSt); }, []);
  if (hide || st !== 'off') return null;
  const done = () => { try { localStorage.setItem('holler.pushnudge', '1'); } catch { /* */ } setHide(true); };
  return (
    <div className="hint">
      <div><b>Want a ping when someone hollers?</b><span>Even when Holler is closed.</span>
        <span className="row gap" style={{ marginTop: 6 }}><button className="btn primary" style={{ minHeight: 40 }} onClick={async () => { const r = await enablePush(); setSt(r); if (r === 'on') toast('Pings on'); done(); }}>Turn on</button></span>
      </div>
      <button className="icon-btn" aria-label="Dismiss" onClick={done}><Icon name="close" size={18} /></button>
    </div>
  );
}

function InstallHint() {
  const standalone = (navigator as unknown as { standalone?: boolean }).standalone || matchMedia('(display-mode: standalone)').matches;
  const [hide, setHide] = useState(() => { try { return !!localStorage.getItem('holler.hint'); } catch { return false; } });
  const [code, setCode] = useState('');
  const show = !standalone && !hide && isIOS();
  useEffect(() => {
    if (!show) return;
    const get = () => api.linkCode().then(setCode).catch(() => {});
    void get(); const i = setInterval(get, 25 * 60 * 1000); return () => clearInterval(i);
  }, [show]);
  if (!show) return null;
  return (
    <div className="hint">
      <div><b>Put Holler on your Home Screen</b>
        <span>1. Tap Share, then Add to Home Screen.<br />2. Open Holler from your Home Screen and tap "Already signed up in Safari?"<br />3. Enter this code so you stay one person and get pings:</span>
        {code && <span className="hint-code">{code}</span>}
      </div>
      <button className="icon-btn" aria-label="Dismiss" onClick={() => { try { localStorage.setItem('holler.hint', '1'); } catch { /* */ } setHide(true); }}><Icon name="close" size={18} /></button>
    </div>
  );
}

// the cards rise in once, the first time Chats paints in this visit
let rose = false;

function seenLine(seen: string[], others: { id: string; name: string }[]) {
  const names = others.filter(o => seen.includes(o.id)).map(o => o.name.split(' ')[0]);
  if (!names.length) return 'Not seen yet';
  if (names.length === others.length && others.length > 1) return 'Seen by everyone';
  return `Seen by ${names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(' and ')}`;
}

export function HomeScreen() {
  const { home, go, refresh } = useApp();
  const [sheet, setSheet] = useState<'new' | 'join' | null>(null);
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState('ember');
  const [, tick] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const [rise] = useState(() => !rose);
  useEffect(() => { if (home?.chats.length) rose = true; }, [home]);
  useEffect(() => onPresence(() => tick(t => t + 1)), []);
  useEffect(() => { const i = setInterval(() => tick(t => t + 1), 30000); return () => clearInterval(i); }, []);
  if (!home) return null;
  const me = home.me;

  // a new chat starts on the first color none of your chats use
  const openNew = () => {
    const used = new Set(home.chats.map(c => c.theme));
    setTheme(Object.keys(THEMES).find(k => !used.has(k)) || 'ember');
    setVal(''); setSheet('new');
  };
  const openJoin = () => { setVal(''); setSheet('join'); };
  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const c = await api.createChat(val.trim());
      if (theme !== 'ember') await api.chatUpdate(c.id, { theme }).catch(() => {});
      await refresh(); setSheet(null); setVal(''); go(`/c/${c.id}/invite`); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const join = async () => {
    if (busy || val.trim().length < 6) return;
    setBusy(true);
    try { const c = await api.join(val.trim()); await refresh(); setSheet(null); setVal(''); go(`/c/${c.id}`); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  const block = (c: (typeof home.chats)[number], person: boolean, i: number) => {
    const others = c.members.filter(m => m.id !== me.id);
    const pres = presenceOf(c.id);
    const recording = others.find(o => pres[o.id] === 'recording');
    const here = others.filter(o => pres[o.id]);
    const lastBy = c.members.find(m => m.id === c.last?.author);
    // the status line says the one most important thing; unread leads with the count
    const from = [`${c.unread} new`, lastBy && lastBy.id !== me.id ? lastBy.name.split(' ')[0] : '', c.last ? ago(c.last.at) : ''].filter(Boolean).join(' · ');
    const gameLine = c.yourTurn ? (c.yourTurn > 1 ? `${c.yourTurn} games waiting on you` : 'A game is waiting on you') : '';
    const gameInLine = !!gameLine && !c.unread && !recording;
    return (
      <li key={c.id} className={c.unread ? 'is-unread' : recording ? 'is-live' : ''} style={{ ['--i' as string]: i }}>
        <button className={`chat-card ${person ? 'person' : 'group'} ${c.unread ? 'unread' : ''} ${recording ? 'live' : ''} ${c.yourTurn ? 'your-go' : ''}`} data-room={c.theme || 'ember'} onClick={e => go(c.unread && (e.target as Element).closest('.cc-thumb') ? `/c/${c.id}/watch` : `/c/${c.id}`)}>
          {person && <span className="cc-av"><Avatar p={others[0]} size={56} /></span>}
          <div className="cc-body">
            <div className="cc-title">{chatTitle(c, me.id)}</div>
            <div className="cc-sub">
              {recording ? <span className="live-txt">{recording.name.split(' ')[0]} is recording</span>
                : c.unread ? <span className="hot">{from}</span>
                : gameInLine ? <span className="turn-tag">{gameLine}</span>
                : c.last ? <span>{lastBy?.id === me.id ? 'You' : lastBy?.name.split(' ')[0]} · {ago(c.last.at)}{lastBy?.id === me.id && others.length > 0 ? <> · <span className={c.last.seen?.length ? 'seen-txt' : ''}>{seenLine(c.last.seen || [], others)}</span></> : null}</span>
                : <span>No hollers yet</span>}
              {here.length > 0 && !recording && <span className="here-dot" title="Here now" />}
              {c.muted && <Icon name="bellOff" size={16} className="muted" />}
            </div>
            {gameLine && !gameInLine && <span className="turn-tag pill">{gameLine}</span>}
            {!person && <AvatarStack people={others.length ? others : c.members} size={26} max={4} />}
          </div>
          <div className="cc-thumb">
            {c.last?.thumb ? <img src={publicUrl(c.last.thumb)} alt="" loading="lazy" /> : c.last?.kind === 'text' ? <span className="cc-text" style={{ background: tone(lastBy?.color), color: 'var(--on-color)' }}>{c.last.body}</span> : c.last?.kind === 'audio' ? <Icon name="wave" size={26} /> : <Icon name="camera" size={24} />}
            {c.unread > 0 && <span className="badge" aria-label={`${c.unread} new`}><Icon name="play" size={11} stroke={2.6} fill="currentColor" />{c.unread}</span>}
          </div>
        </button>
      </li>
    );
  };
  // People = chats with exactly two members; Groups = everything else. Inside each: what needs you first (unread, then a game
  // waiting on you; a muted chat does not jump), then the most recent activity.
  const needs = (c: (typeof home.chats)[number]) => (c.unread && !c.muted ? 0 : c.yourTurn ? 1 : 2);
  const order = (a: (typeof home.chats)[number], b: (typeof home.chats)[number]) => needs(a) - needs(b) || (b.lastPoloAt || '').localeCompare(a.lastPoloAt || '') || a.id.localeCompare(b.id);
  const people = home.chats.filter(c => c.members.length === 2).sort(order);
  const groups = home.chats.filter(c => c.members.length !== 2).sort(order);
  // the one line under the title: what is waiting, in plain words
  const nNew = home.chats.reduce((t, c) => t + (c.muted ? 0 : c.unread), 0);
  const nGames = home.chats.reduce((t, c) => t + (c.yourTurn || 0), 0);
  const summary = [nNew ? `${nNew} new ${nNew === 1 ? 'holler' : 'hollers'}` : '', nGames ? `${nGames} ${nGames === 1 ? 'game' : 'games'} waiting` : ''].filter(Boolean).join(' · ') || 'All caught up';
  const sections = [{ id: 'people', label: 'People', list: people, person: true }, { id: 'groups', label: 'Groups', list: groups, person: false }].filter(x => x.list.length);

  return (
    <div className="home" onScroll={e => { const s = (e.currentTarget as HTMLElement).scrollTop > 4; if (s !== scrolled) setScrolled(s); }}>
      <header className={`home-top ${scrolled ? 'scrolled' : ''}`}>
        <div className="ht-txt">
          <h1 className="wordmark sm">holler</h1>
          {home.chats.length > 0 && <p className="home-sum">{summary}</p>}
        </div>
        <button className="new-chat-btn" onClick={openNew} aria-label="New chat"><Icon name="plus" size={24} /></button>
      </header>

      <InstallHint />
      {home.chats.length > 0 && <PushNudge />}
      {home.chats.length === 0 ? (
        <div className="empty" data-you="" style={{ ['--room' as string]: tone(me.color) }}>
          <div className="empty-art"><i /><i /><i /></div>
          <h2>Start a chat with your people</h2>
          <p className="muted">Make a chat, then send the invite link to up to a few friends or family. Or join one with a code.</p>
          <div className="col gap">
            <button className="btn primary wide" onClick={openNew}>Start a chat</button>
            <button className="btn wide" onClick={openJoin}>I have a code</button>
          </div>
        </div>
      ) : (
        <div className={`chat-sections ${rise ? 'rise' : ''}`}>
          {sections.map((x, si) => (
            <section key={x.id} className="chat-sec" aria-label={x.label}>
              {sections.length > 1 && <h2 className="sec-lbl">{x.label}</h2>}
              <ul className="chats">{x.list.map((c, i) => block(c, x.person, i + (si ? sections[0].list.length : 0)))}</ul>
            </section>
          ))}
        </div>
      )}

      <Sheet open={sheet === 'new'} onClose={() => setSheet(null)} title="New chat" room={theme}>
        <label className="lbl" htmlFor="cn">Name it (optional)</label>
        <input id="cn" className="field big" autoFocus maxLength={60} placeholder="The Fam, Besties, Sunday crew" value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void create(); }} />
        <div className="lbl">Color</div>
        <div className="swatches rooms">
          {Object.entries(THEMES).map(([k, v]) => <button key={k} className={`sw ${theme === k ? 'on' : ''}`} data-room={k} onClick={() => setTheme(k)} aria-label={v.label} aria-pressed={theme === k} />)}
        </div>
        <p className="fine">Next you'll get a link to send to the people you want in it.</p>
        <button className="btn primary wide" disabled={busy} onClick={() => void create()}>Make it</button>
        <button className="link-btn sheet-link" onClick={openJoin}>Have a code? Join a chat</button>
      </Sheet>
      <Sheet open={sheet === 'join'} onClose={() => setSheet(null)} title="Join a chat">
        <label className="lbl center" htmlFor="jc">Invite code</label>
        <input id="jc" className="field code" autoFocus autoCapitalize="characters" autoComplete="off" placeholder="ABC123" value={val} onChange={e => setVal(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} onKeyDown={e => { if (e.key === 'Enter') void join(); }} />
        <p className="fine center">It's on the invite they sent you.</p>
        <button className="btn primary wide" disabled={busy || val.trim().length < 6} onClick={() => void join()}>Join</button>
      </Sheet>
    </div>
  );
}
