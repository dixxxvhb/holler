import { useEffect, useRef, useState } from 'react';
import { useApp } from '../App';
import { api, cacheBytes, clearCache, rid, upload, type Prefs } from '../lib/api';
import { LOOKS } from '../lib/studio';
import { VOICES } from '../lib/voice';
import { speechSupported, isIOS } from '../lib/speech';
import { enablePush, pushState } from '../lib/push';
import { Avatar, COLORS, Sheet, Toggle, ask, toast, tone } from './bits';
import { Icon } from './icons';
import { isSimple, setSimple, camMode, setCamMode, type CamMode } from '../lib/device';
import { ProfileSheet } from './Profile';

const LIMIT = 1024 ** 3; // the free storage room Holler shares

export function Settings({ onSignOut }: { onSignOut: () => void }) {
  const { home, go, refresh } = useApp();
  const me = home!.me;
  // flips show at once; the server's copy catches up on the next refresh
  const [pending, setPending] = useState<Prefs>({});
  const prefs: Prefs = { ...(me.prefs || {}), ...pending };
  const [name, setName] = useState(me.name);
  const [local, setLocal] = useState(0);
  const [link, setLink] = useState<{ url: string; qr: string; code: string } | null>(null);
  const [push, setPush] = useState<string>('');
  const [simple, setSimpleS] = useState(isSimple());
  const [cam, setCam] = useState<CamMode>(camMode());
  const [showMe, setShowMe] = useState(false);
  const [words, setWords] = useState({ about: me.prefs?.about || '', into: me.prefs?.into || '', song: me.prefs?.song || '' });
  const saveWord = (k: 'about' | 'into' | 'song') => { const v = words[k].trim(); if (v === (me.prefs?.[k] || '')) return; void set({ [k]: v }); };
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { void cacheBytes().then(setLocal); void pushState().then(setPush); }, []);

  const set = async (p: Prefs) => {
    setPending(x => ({ ...x, ...p }));
    try { await api.updateMe({ prefs: p }); await refresh(); }
    catch (e) { toast((e as Error).message); }
    setPending(x => { const y = { ...x }; for (const k of Object.keys(p)) delete y[k as keyof Prefs]; return y; });
  };
  const saveName = async () => {
    const n = name.trim();
    if (!n) { setName(me.name); return; }
    if (n === me.name) return;
    try { await api.updateMe({ name: n }); void refresh(); toast('Name saved'); } catch (e) { toast((e as Error).message); setName(me.name); }
  };
  const setColor = async (c: string) => { try { await api.updateMe({ color: c }); void refresh(); } catch (e) { toast((e as Error).message); } };
  const removePhoto = async () => { try { await api.updateMe({ avatar: null }); void refresh(); } catch (e) { toast((e as Error).message); } };

  const onAvatar = async (f?: File) => {
    if (!f) return;
    try {
      const img = await createImageBitmap(f);
      const c = document.createElement('canvas'); c.width = c.height = 320;
      const s = Math.min(img.width, img.height);
      c.getContext('2d')!.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 320, 320);
      const blob = await new Promise<Blob>(r => c.toBlob(b => r(b!), 'image/jpeg', 0.82));
      const path = `avatars/${me.id}/${rid(12)}.jpg`;
      await upload(path, blob);
      await api.updateMe({ avatar: path }); void refresh(); toast('Looking good');
    } catch (e) { toast('Could not use that photo: ' + (e as Error).message); }
  };

  const makeLink = async () => {
    try {
      const [tok, code] = await Promise.all([api.linkDevice(), api.linkCode()]);
      const url = `${location.origin}${location.pathname}#/link/${tok}`;
      setLink({ url, code, qr: await (await import('qrcode')).toDataURL(url, { margin: 1, width: 360, color: { dark: '#15121c', light: '#ffffff' } }) });
    } catch (e) { toast((e as Error).message || 'Could not make a link'); }
  };

  const used = home!.usage.bytes;
  const pct = Math.min(100, (used / LIMIT) * 100);

  return (
    <div className="page has-tabs" data-you="" style={{ ['--room' as string]: tone(me.color) }}>
      <header className="page-top">
        <h1>You</h1><span />
      </header>

      <section className="card profile">
        <button className="av-edit" onClick={() => fileRef.current?.click()} aria-label="Change photo">
          <Avatar p={me} size={64} /><span className="av-badge"><Icon name="camera" size={14} /></span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { void onAvatar(e.target.files?.[0]); e.target.value = ''; }} />
        <input className="field" maxLength={40} aria-label="Your name" value={name} onChange={e => setName(e.target.value)} onBlur={() => void saveName()} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        <div className="swatches">
          {COLORS.map(c => <button key={c} className={`sw ${c === tone(me.color) ? 'on' : ''}`} style={{ background: c }} onClick={() => void setColor(c)} aria-label={`Color ${COLORS.indexOf(c) + 1}`} aria-pressed={c === tone(me.color)} />)}
        </div>
        {me.avatar && <button className="link-btn" onClick={() => void removePhoto()}>Remove photo</button>}
      </section>

      <button className="srow-link" onClick={() => go('/saved')}><b>Saved hollers</b><Icon name="back" size={18} className="chev" /></button>

      <h3 className="sec">Profile</h3>
      <section className="card prof-edit">
        <p className="fine">Everyone in your chats sees these when they tap your name.</p>
        <label className="lbl" htmlFor="pf-about">About you</label>
        <textarea id="pf-about" className="field area sm" rows={2} maxLength={140} placeholder="A line or two about you" value={words.about} onChange={e => setWords(w => ({ ...w, about: e.target.value }))} onBlur={() => saveWord('about')} />
        <label className="lbl" htmlFor="pf-into">Into lately</label>
        <input id="pf-into" className="field" maxLength={60} placeholder="A show, a hobby, a place" value={words.into} onChange={e => setWords(w => ({ ...w, into: e.target.value }))} onBlur={() => saveWord('into')} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        <label className="lbl" htmlFor="pf-song">On repeat</label>
        <input id="pf-song" className="field" maxLength={60} placeholder="The song you can't stop playing" value={words.song} onChange={e => setWords(w => ({ ...w, song: e.target.value }))} onBlur={() => saveWord('song')} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        <p className="fine">Your default look and voice below show on your profile too.</p>
        <button className="btn" onClick={() => setShowMe(true)}><Icon name="eye" size={18} /> See your profile</button>
      </section>

      <h3 className="sec">Recording</h3>
      <section className="card">
        <Row label="On this phone">
          <div className="seg">{([['on', 'Camera'], ['voice', 'Voice only'], ['off', 'Notes']] as [CamMode, string][]).map(([k, l]) => <button key={k} className={cam === k ? 'on' : ''} onClick={() => { setCamMode(k); setCam(k); }}>{l}</button>)}</div>
        </Row>
        <p className="fine">{cam === 'on' ? 'Camera and mic, the full Holler.' : cam === 'voice' ? "No camera on this phone: voice hollers, notes and the games that don't need a camera." : 'No camera or mic on this phone: notes, watching, and board, card and quiz games.'}</p>
        <Toggle label="HD video" hint="Sharper, about 2.5x the size. Up to 2.5 minutes." on={!!prefs.hd} set={v => void set({ hd: v })} />
        <Toggle label="Live captions" hint={speechSupported() && !isIOS() ? 'Writes down what you say so others can read along and search.' : 'Not available in this browser. Works in Chrome on Android and computers.'} on={prefs.captions !== false} set={v => void set({ captions: v })} disabled={!speechSupported() || isIOS()} />
        <Toggle label="Look before sending" hint="See your holler and choose Send or Retake. Off means it sends the moment you stop, with a few seconds to undo." on={!!prefs.review} set={v => void set({ review: v })} />
        <Toggle label="Simple camera" hint="Turns off looks, drawing and text on video, on this device only. Use it if recordings come out black or choppy." on={simple} set={v => { setSimple(v); setSimpleS(v); }} />
        <Row label="Default look"><select className="field sel" value={prefs.look || 'none'} onChange={e => void set({ look: e.target.value })}>{LOOKS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}</select></Row>
        <Row label="Default voice"><select className="field sel" value={prefs.voice || 'none'} onChange={e => void set({ voice: e.target.value })}>{VOICES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}</select></Row>
      </section>

      <h3 className="sec">Watching</h3>
      <section className="card">
        <Row label="Playback speed">
          <div className="seg">{[1, 1.5, 2].map(s => <button key={s} className={(prefs.speed || 1) === s ? 'on' : ''} onClick={() => void set({ speed: s })}>{s}x</button>)}</div>
        </Row>
        <Toggle label="Sounds" hint="A little ding when someone hollers." on={prefs.sounds !== false} set={v => void set({ sounds: v })} />
      </section>

      <h3 className="sec">Notifications</h3>
      <section className="card">
        <p className="fine">{push === 'on' ? 'On for this device.' : push === 'ios-install' ? 'On iPhone: tap Share, then Add to Home Screen, open Holler from there, then turn this on.' : push === 'denied' ? 'Blocked for Holler on this device. Allow notifications for it in your phone or browser settings, then come back here.' : push === 'unsupported' ? 'This browser cannot do notifications.' : 'Get a ping when someone hollers, even with the app closed.'}</p>
        {push !== 'on' && push !== 'unsupported' && push !== 'ios-install' && push !== 'denied' && (
          <button className="btn primary" onClick={async () => { const r = await enablePush().catch(() => 'off'); setPush(r); toast(r === 'on' ? 'Notifications on' : r === 'denied' ? 'Blocked. Allow notifications for this site in your browser settings.' : 'Notifications not turned on'); }}><Icon name="bell" size={18} /> Turn on notifications</button>
        )}
      </section>

      <h3 className="sec">Devices</h3>
      <section className="card">
        <p className="fine">Use Holler on your other phone, tablet or computer as the same you.</p>
        <button className="btn" onClick={() => void makeLink()}><Icon name="link" size={18} /> Use on another device</button>
      </section>

      <h3 className="sec">Storage</h3>
      <section className="card">
        <div className="meter"><i style={{ width: `${pct}%` }} /></div>
        <p className="fine">Everyone's hollers use {(used / 1024 ** 2).toFixed(0)} MB of 1 GB ({home!.usage.count} files). History is kept forever; deleting your own hollers frees room.</p>
        <p className="fine">This device keeps {(local / 1024 ** 2).toFixed(0)} MB of watched hollers so replays load instantly and use no data.</p>
        <button className="btn" onClick={async () => { await clearCache(); setLocal(await cacheBytes()); toast('Cleared'); }}>Clear this device's copies</button>
      </section>

      <section className="card">
        <button className="btn danger wide" onClick={async () => { if (await ask({ title: 'Sign out on this device?', body: 'Make sure you have Holler on another device, or you will start fresh.', yes: 'Sign out', danger: true })) onSignOut(); }}>Sign out on this device</button>
      </section>
      <p className="fine center">Holler · made at home · no ads, no paywall</p>

      <ProfileSheet person={showMe ? me : null} onClose={() => setShowMe(false)} />
      <Sheet open={!!link} onClose={() => setLink(null)} title="Use on another device">
        {link && <>
          <div className="lbl">On the other device, tap "I already have Holler" and enter</div>
          <div className="code-big center">{link.code}</div>
          <p className="fine center">Good for 30 minutes. This is the way to do it for a Home Screen app on iPhone.</p>
          <div className="lbl">Or scan this with the other device's camera</div>
          <img className="qr center-block" src={link.qr} alt="Device link QR code" />
          <p className="fine">Anyone with this code or link can act as you, so keep them to yourself.</p>
          <button className="btn wide" onClick={async () => { try { await navigator.clipboard.writeText(link.url); toast('Copied'); } catch { toast(link.url, undefined, 10000); } }}>Copy link</button>
        </>}
      </Sheet>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="srow"><b>{label}</b>{children}</div>;
}
