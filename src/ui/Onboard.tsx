import { useState } from 'react';
import { api, setToken } from '../lib/api';
import { COLORS, tone } from './bits';
import { isIOS } from '../lib/speech';

const standalone = () => (navigator as unknown as { standalone?: boolean }).standalone || matchMedia('(display-mode: standalone)').matches;

export function Onboard({ onDone, joining }: { onDone: () => void; joining?: string }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[Math.floor(Math.random() * 6)]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState<'new' | 'code'>('new');
  const [code, setCode] = useState('');
  const redeem = async () => {
    if (busy || code.length < 6) return;
    setBusy(true); setErr('');
    try { const r = await api.redeemCode(code); setToken(r.token); onDone(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Try again'); setBusy(false); }
  };
  const homeScreenIPhone = isIOS() && standalone();

  const go = async () => {
    if (!name.trim() || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await api.signup(name.trim(), color);
      setToken(r.token); onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Try again'); setBusy(false); }
  };

  return (
    <div className="onboard" data-you="" style={{ ['--room' as string]: tone(color) }}>
      <div className="ob-hero">
        <div className="ob-rings"><i /><i /><i /></div>
        <h1 className="wordmark">holler</h1>
        <p className="tag">Video messages for your people.<br />Talk when you can. Watch when you can.</p>
      </div>
      {mode === 'code' ? (
        <div className="ob-card">
          <label className="lbl" htmlFor="lc">Your 6-letter code</label>
          <input id="lc" className="field code" autoFocus autoCapitalize="characters" autoComplete="one-time-code" placeholder="ABC123" value={code}
            onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} onKeyDown={e => { if (e.key === 'Enter') void redeem(); }} />
          <p className="fine">Find it where you already use Holler: on the card at the top of its home screen, or in Settings under "Use on another device".</p>
          {err && <p className="err">{err}</p>}
          <button className="btn primary wide" disabled={code.length < 6 || busy} onClick={() => void redeem()}>{busy ? 'One sec' : "That's me"}</button>
          <button className="link-btn" onClick={() => { setMode('new'); setErr(''); }}>I'm new here</button>
        </div>
      ) : (
      <div className="ob-card">
        {homeScreenIPhone && (
          <button className="note as-btn" onClick={() => setMode('code')}>Already signed up in Safari? Tap here and enter the code from there so you stay one person.</button>
        )}
        {joining && <div className="note">You've been invited to a chat. Pick a name and you're in.</div>}
        <label className="lbl" htmlFor="nm">What do your people call you?</label>
        <input id="nm" className="field big" autoFocus={!homeScreenIPhone} maxLength={40} placeholder="Your name" value={name}
          onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void go(); }} />
        <div className="lbl">Your color</div>
        <div className="swatches">
          {COLORS.map(c => <button key={c} className={`sw ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Color ${COLORS.indexOf(c) + 1}`} aria-pressed={c === color} />)}
        </div>
        {err && <p className="err">{err}</p>}
        <button className="btn primary wide" disabled={!name.trim() || busy} onClick={() => void go()}>{busy ? 'One sec' : joining ? 'Join the chat' : "Let's go"}</button>
        <button className="link-btn" onClick={() => setMode('code')}>I already have Holler on another phone or browser</button>
      </div>
      )}
    </div>
  );
}
