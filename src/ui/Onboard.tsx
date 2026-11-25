import { useState } from 'react';
import { api, setToken } from '../lib/api';
import { COLORS } from './bits';

export function Onboard({ onDone, joining }: { onDone: () => void; joining?: string }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[Math.floor(Math.random() * 6)]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const go = async () => {
    if (!name.trim()) return;
    setBusy(true); setErr('');
    try {
      const r = await api.signup(name.trim(), color);
      setToken(r.token); onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Try again'); setBusy(false); }
  };

  return (
    <div className="onboard">
      <div className="ob-hero">
        <div className="ob-rings"><i /><i /><i /></div>
        <h1 className="wordmark">holler</h1>
        <p className="tag">Video messages for your people.<br />Talk when you can. Watch when you can.</p>
      </div>
      <div className="ob-card">
        {joining && <div className="note">You've been invited to a chat. Pick a name and you're in.</div>}
        <label className="lbl" htmlFor="nm">What do your people call you?</label>
        <input id="nm" className="field big" autoFocus maxLength={40} placeholder="Your name" value={name}
          onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void go(); }} />
        <div className="lbl">Your color</div>
        <div className="swatches">
          {COLORS.map(c => <button key={c} className={`sw ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Color ${c}`} />)}
        </div>
        {err && <p className="err">{err}</p>}
        <button className="btn primary wide" disabled={!name.trim() || busy} onClick={() => void go()}>{busy ? 'One sec' : joining ? 'Join the chat' : "Let's go"}</button>
        <p className="fine">Already on Holler on another phone? Open Settings there and tap "Use on another device".</p>
      </div>
    </div>
  );
}
