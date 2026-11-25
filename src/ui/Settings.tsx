import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { useApp } from '../App';
import { api, cacheBytes, clearCache, rid, upload, type Prefs } from '../lib/api';
import { LOOKS } from '../lib/studio';
import { VOICES } from '../lib/voice';
import { speechSupported, isIOS } from '../lib/speech';
import { enablePush, pushState } from '../lib/push';
import { Avatar, COLORS, Sheet, toast } from './bits';
import { Icon } from './icons';

const LIMIT = 1024 ** 3; // the free storage room Holler shares

export function Settings({ onSignOut }: { onSignOut: () => void }) {
  const { home, go, refresh } = useApp();
  const me = home!.me;
  const prefs: Prefs = me.prefs || {};
  const [name, setName] = useState(me.name);
  const [local, setLocal] = useState(0);
  const [link, setLink] = useState<{ url: string; qr: string } | null>(null);
  const [push, setPush] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { void cacheBytes().then(setLocal); void pushState().then(setPush); }, []);

  const set = async (p: Prefs) => { await api.updateMe({ prefs: p }).catch(e => toast(e.message)); void refresh(); };
  const saveName = async () => { if (name.trim() && name !== me.name) { await api.updateMe({ name }); void refresh(); toast('Name saved'); } };

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
    const tok = await api.linkDevice();
    const url = `${location.origin}${location.pathname}#/link/${tok}`;
    setLink({ url, qr: await QRCode.toDataURL(url, { margin: 1, width: 360 }) });
  };

  const used = home!.usage.bytes;
  const pct = Math.min(100, (used / LIMIT) * 100);

  return (
    <div className="page">
      <header className="page-top">
        <button className="icon-btn" onClick={() => go('/')} aria-label="Back"><Icon name="back" /></button>
        <h1>You</h1><span />
      </header>

      <section className="card profile">
        <button className="av-edit" onClick={() => fileRef.current?.click()} aria-label="Change photo">
          <Avatar p={me} size={88} /><span className="av-badge"><Icon name="camera" size={16} /></span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { void onAvatar(e.target.files?.[0]); e.target.value = ''; }} />
        <input className="field" maxLength={40} value={name} onChange={e => setName(e.target.value)} onBlur={() => void saveName()} />
        <div className="swatches">
          {COLORS.map(c => <button key={c} className={`sw ${c === me.color ? 'on' : ''}`} style={{ background: c }} onClick={async () => { await api.updateMe({ color: c }); void refresh(); }} aria-label="Color" />)}
        </div>
        {me.avatar && <button className="link-btn" onClick={async () => { await api.updateMe({ avatar: null }); void refresh(); }}>Remove photo</button>}
      </section>

      <h3 className="sec">Recording</h3>
      <section className="card">
        <Toggle label="HD video" hint="Sharper, about 2.5x the size. Up to 2.5 minutes." on={!!prefs.hd} set={v => void set({ hd: v })} />
        <Toggle label="Live captions" hint={speechSupported() && !isIOS() ? 'Writes down what you say so others can read along and search.' : 'Not available in this browser. Works in Chrome on Android and computers.'} on={prefs.captions !== false} set={v => void set({ captions: v })} />
        <Toggle label="Look before sending" hint="See your holler and choose Send or Retake. Off means it sends the moment you stop, with a few seconds to undo." on={!!prefs.review} set={v => void set({ review: v })} />
        <Toggle label="Simple camera" hint="Turns off looks, drawing and text on video. Use it if recordings come out black or choppy on your phone." on={!!prefs.simple} set={v => void set({ simple: v })} />
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
        <p className="fine">{push === 'on' ? 'On for this device.' : push === 'ios-install' ? 'On iPhone: tap Share, then Add to Home Screen, open Holler from there, then turn this on.' : push === 'denied' ? 'Blocked in your browser settings for this site.' : push === 'unsupported' ? 'This browser cannot do notifications.' : 'Get a ping when someone hollers, even with the app closed.'}</p>
        {push !== 'on' && push !== 'unsupported' && push !== 'ios-install' && (
          <button className="btn primary" onClick={async () => { const r = await enablePush(); setPush(r); toast(r === 'on' ? 'Notifications on' : 'Notifications not turned on'); }}><Icon name="bell" size={18} /> Turn on notifications</button>
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
        <button className="btn danger wide" onClick={() => { if (confirm('Sign out on this device? Make sure you have Holler on another device or you will start fresh.')) onSignOut(); }}>Sign out on this device</button>
      </section>
      <p className="fine center">Holler · made at home · no ads, no paywall</p>

      <Sheet open={!!link} onClose={() => setLink(null)} title="Use on another device">
        {link && <>
          <img className="qr center-block" src={link.qr} alt="Device link QR code" />
          <p className="fine">Scan this with the other device's camera, or send yourself the link. Anyone with this link can act as you, so keep it to yourself.</p>
          <button className="btn wide" onClick={async () => { try { await navigator.clipboard.writeText(link.url); toast('Copied'); } catch { toast(link.url, undefined, 10000); } }}>Copy link</button>
        </>}
      </Sheet>
    </div>
  );
}

function Toggle({ label, hint, on, set }: { label: string; hint?: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span><b>{label}</b>{hint && <em>{hint}</em>}</span>
      <input type="checkbox" checked={on} onChange={e => set(e.target.checked)} />
      <i />
    </label>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="srow"><b>{label}</b>{children}</div>;
}
