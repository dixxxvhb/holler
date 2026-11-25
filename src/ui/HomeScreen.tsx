import { useEffect, useState } from 'react';
import { useApp } from '../App';
import { api, publicUrl } from '../lib/api';
import { onPresence, presenceOf } from '../lib/live';
import { Avatar, AvatarStack, Sheet, ago, chatTitle, THEMES, toast } from './bits';
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
  if (standalone || hide || !isIOS()) return null;
  return (
    <div className="hint">
      <div><b>Put Holler on your Home Screen</b><span>Tap Share, then Add to Home Screen. Then you can get a ping when someone hollers.</span></div>
      <button className="icon-btn" aria-label="Dismiss" onClick={() => { try { localStorage.setItem('holler.hint', '1'); } catch { /* */ } setHide(true); }}><Icon name="close" size={18} /></button>
    </div>
  );
}

export function HomeScreen() {
  const { home, go, refresh } = useApp();
  const [sheet, setSheet] = useState<'new' | 'join' | null>(null);
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => onPresence(() => tick(t => t + 1)), []);
  useEffect(() => { const i = setInterval(() => tick(t => t + 1), 30000); return () => clearInterval(i); }, []);
  if (!home) return null;
  const me = home.me;

  const create = async () => {
    setBusy(true);
    try { const c = await api.createChat(val.trim()); await refresh(); setSheet(null); setVal(''); go(`/c/${c.id}/invite`); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const join = async () => {
    setBusy(true);
    try { const c = await api.join(val.trim()); await refresh(); setSheet(null); setVal(''); go(`/c/${c.id}`); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="home">
      <header className="home-top">
        <h1 className="wordmark sm">holler</h1>
        <div className="row gap">
          <button className="icon-btn" onClick={() => go('/saved')} aria-label="Saved"><Icon name="bookmark" /></button>
          <button className="me-btn" onClick={() => go('/settings')} aria-label="Settings"><Avatar p={me} size={36} /></button>
        </div>
      </header>

      <InstallHint />
      {home.chats.length > 0 && <PushNudge />}
      {home.chats.length === 0 ? (
        <div className="empty">
          <div className="empty-art"><i /><i /><i /></div>
          <h2>Start a chat with your people</h2>
          <p className="muted">Make a chat, then send the invite link to up to a few friends or family. Or join one with a code.</p>
          <div className="col gap">
            <button className="btn primary wide" onClick={() => setSheet('new')}>Start a chat</button>
            <button className="btn wide" onClick={() => setSheet('join')}>I have a code</button>
          </div>
        </div>
      ) : (
        <ul className="chats">
          {home.chats.map(c => {
            const others = c.members.filter(m => m.id !== me.id);
            const pres = presenceOf(c.id);
            const recording = others.find(o => pres[o.id] === 'recording');
            const here = others.filter(o => pres[o.id]);
            const accent = THEMES[c.theme]?.accent || 'var(--accent)';
            const lastBy = c.members.find(m => m.id === c.last?.author);
            return (
              <li key={c.id}>
                <button className={`chat-card ${c.unread ? 'unread' : ''}`} style={{ ['--accent' as string]: accent }} onClick={() => go(`/c/${c.id}`)}>
                  <div className="cc-thumb">
                    {c.last?.thumb ? <img src={publicUrl(c.last.thumb)} alt="" loading="lazy" /> : c.last?.kind === 'text' ? <span className="cc-text" style={{ background: lastBy?.color, color: '#150c08' }}>{c.last.body}</span> : c.last?.kind === 'audio' ? <Icon name="wave" size={28} /> : <Icon name="camera" size={26} />}
                    {c.unread > 0 && <span className="badge">{c.unread}</span>}
                  </div>
                  <div className="cc-body">
                    <div className="cc-title">{chatTitle(c, me.id)}</div>
                    <div className="cc-sub">
                      {recording ? <span className="live-txt">{recording.name.split(' ')[0]} is recording</span>
                        : c.unread ? <span className="hot">{c.unread} new {c.unread === 1 ? 'holler' : 'hollers'}</span>
                        : c.last ? <span>{lastBy?.id === me.id ? 'You' : lastBy?.name.split(' ')[0]} · {ago(c.last.at)}</span>
                        : <span>No hollers yet</span>}
                      {here.length > 0 && !recording && <span className="here-dot" title="Here now" />}
                    </div>
                  </div>
                  <AvatarStack people={others.length ? others : c.members} size={30} max={3} />
                  {c.muted && <Icon name="bellOff" size={16} className="muted" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {home.chats.length > 0 && (
        <div className="fab-row">
          <button className="btn" onClick={() => setSheet('join')}>Join with code</button>
          <button className="btn primary" onClick={() => setSheet('new')}><Icon name="plus" size={18} /> New chat</button>
        </div>
      )}

      <Sheet open={sheet === 'new'} onClose={() => setSheet(null)} title="New chat">
        <label className="lbl" htmlFor="cn">Name it (optional)</label>
        <input id="cn" className="field" autoFocus maxLength={60} placeholder="The Fam, Besties, Sunday crew" value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void create(); }} />
        <p className="fine">Next you'll get a link to send to the people you want in it.</p>
        <button className="btn primary wide" disabled={busy} onClick={() => void create()}>Make it</button>
      </Sheet>
      <Sheet open={sheet === 'join'} onClose={() => setSheet(null)} title="Join a chat">
        <label className="lbl" htmlFor="jc">Invite code</label>
        <input id="jc" className="field code" autoFocus maxLength={6} placeholder="ABC123" value={val} onChange={e => setVal(e.target.value.toUpperCase())} onKeyDown={e => { if (e.key === 'Enter') void join(); }} />
        <button className="btn primary wide" disabled={busy || val.trim().length < 6} onClick={() => void join()}>Join</button>
      </Sheet>
    </div>
  );
}
