import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useApp } from '../App';
import { api, type ChatFull } from '../lib/api';
import { send as liveSend } from '../lib/live';
import { Avatar, Sheet, THEMES, ago, chatTitle, toast } from './bits';
import { Icon } from './icons';

export const inviteLink = (code: string) => `${location.origin}${location.pathname}#/join/${code}`;

export function ChatInfo({ open, onClose, chat, onChanged }: { open: boolean; onClose: () => void; chat: ChatFull; onChanged: () => void }) {
  const { home, go } = useApp();
  const me = home!.me;
  const [name, setName] = useState(chat.name);
  const [qr, setQr] = useState('');
  const link = inviteLink(chat.code);
  useEffect(() => { setName(chat.name); }, [chat.name]);
  useEffect(() => { if (open) QRCode.toDataURL(link, { margin: 1, width: 360, color: { dark: '#15121c', light: '#ffffff' } }).then(setQr).catch(() => {}); }, [open, link]);

  const share = async () => {
    const text = `Come holler with me. Tap to join: ${link}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Join my Holler chat', text, url: link }); return; }
      catch (e) { if ((e as Error)?.name === 'AbortError') return; /* dismissed is not a copy; anything else falls through to copying */ }
    }
    try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { toast(link, undefined, 8000); }
  };
  const saveName = async () => {
    if (name === chat.name) return;
    await api.chatUpdate(chat.id, { name }).catch(e => toast(e.message));
    liveSend(chat.id, 'chat'); onChanged();
  };
  const setTheme = async (t: string) => { await api.chatUpdate(chat.id, { theme: t }).catch(e => toast(e.message)); liveSend(chat.id, 'chat'); onChanged(); };
  const mute = async () => { await api.chatUpdate(chat.id, { muted: !chat.muted }); onChanged(); toast(chat.muted ? 'Sounds back on for this chat' : 'Muted. No pings from this chat.'); };
  const leave = async () => {
    if (!confirm('Leave this chat? You will need the code to get back in.')) return;
    await api.leave(chat.id); liveSend(chat.id, 'chat'); onClose(); go('/');
  };
  const n = chat.polos.length;

  return (
    <Sheet open={open} onClose={onClose} title={chatTitle(chat, me.id)}>
      <div className="invite">
        {qr && <img className="qr" src={qr} alt="Invite QR code" />}
        <div className="invite-side">
          <div className="lbl">Invite code</div>
          <div className="code-big">{chat.code}</div>
          <button className="btn primary" onClick={() => void share()}><Icon name="share" size={18} /> Send invite</button>
          <p className="fine">Anyone with the link or code can join. Up to 12 people.</p>
        </div>
      </div>

      <div className="lbl">People ({chat.members.length})</div>
      <ul className="people">
        {chat.members.map(m => (
          <li key={m.id}><Avatar p={m} size={36} /><span className="pname">{m.id === me.id ? `${m.name} (you)` : m.name}</span><em>{m.id === me.id ? '' : `active ${ago(m.lastSeen)}`}</em></li>
        ))}
      </ul>

      <label className="lbl" htmlFor="chn">Chat name</label>
      <input id="chn" className="field" maxLength={60} placeholder="Name this chat" value={name} onChange={e => setName(e.target.value)} onBlur={() => void saveName()} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />

      <div className="lbl">Color</div>
      <div className="swatches rooms">
        {Object.entries(THEMES).map(([k, v]) => <button key={k} className={`sw ${chat.theme === k ? 'on' : ''}`} data-room={k} onClick={() => void setTheme(k)} aria-label={v.label} aria-pressed={chat.theme === k} />)}
      </div>

      <div className="row gap wrap" style={{ marginTop: 18 }}>
        <button className="btn" onClick={() => void mute()}><Icon name={chat.muted ? 'bell' : 'bellOff'} size={18} /> {chat.muted ? 'Unmute' : 'Mute'}</button>
        <button className="btn danger" onClick={() => void leave()}>Leave chat</button>
      </div>
      <p className="fine">{n} {n === 1 ? 'holler' : 'hollers'} here, kept forever until someone deletes their own.</p>
    </Sheet>
  );
}
