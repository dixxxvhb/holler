import { useCallback, useEffect, useRef, useState } from 'react';
import { api, mediaUrl, type ChatFull, type Person, type Polo } from '../lib/api';
import { send as liveSend } from '../lib/live';
import { removeMine } from '../lib/outbox';
import { parseTranscript } from '../lib/speech';
import { pop } from '../lib/sound';
import { Avatar, ago, clock, toast } from './bits';
import { Icon, REACTIONS } from './icons';

const SPEEDS = [1, 1.5, 2];

export function Player({ chat, list, start, me, onClose, onChanged, standalone }: {
  chat: ChatFull | null; list: Polo[]; start: number; me: Person; onClose: () => void; onChanged?: () => void; standalone?: boolean;
}) {
  const [idx, setIdx] = useState(Math.max(0, start));
  const [items, setItems] = useState(list);
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [t, setT] = useState(0);
  const [speed, setSpeed] = useState(me.prefs?.speed || 1);
  const [cc, setCc] = useState(me.prefs?.captions !== false);
  const [bursts, setBursts] = useState<{ id: number; kind: string; x: number; who?: Person }[]>([]);
  const [menu, setMenu] = useState(false);
  const vid = useRef<HTMLVideoElement>(null);
  const aud = useRef<HTMLAudioElement>(null);
  const textTimer = useRef(0);
  const shown = useRef(new Set<string>());
  const holdTimer = useRef(0);
  const held = useRef(false);

  const polo = items[idx];
  const members = chat?.members || [];
  const author = members.find(m => m.id === polo?.author) || (polo?.author === me.id ? me : undefined);
  const segs = parseTranscript(polo?.transcript || null);
  const dur = polo?.duration || 0;
  const el = () => (polo?.kind === 'audio' ? aud.current : vid.current);

  const next = useCallback(() => {
    setIdx(i => { if (i + 1 >= items.length) { onClose(); return i; } return i + 1; });
  }, [items.length, onClose]);
  const prev = () => setIdx(i => Math.max(0, i - 1));

  // load media + mark watched
  useEffect(() => {
    if (!polo) return;
    let gone = false;
    setSrc(null); setT(0); setPaused(false); shown.current = new Set(); clearTimeout(textTimer.current);
    if (polo.author !== me.id && !polo.views.some(v => v.who === me.id)) {
      api.view(polo.id).then(() => liveSend(polo.chat, 'view', { id: polo.id })).catch(() => {});
    }
    if (polo.kind === 'text') {
      setLoading(false);
      const ms = Math.min(9000, 2500 + (polo.body || '').split(/\s+/).length * 280);
      textTimer.current = window.setTimeout(next, ms);
    } else if (polo.path) {
      setLoading(true);
      mediaUrl(polo.path).then(u => { if (!gone) setSrc(u); });
    }
    // warm the next one
    const n = items[idx + 1]; if (n?.path) void mediaUrl(n.path);
    return () => { gone = true; clearTimeout(textTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polo?.id]);

  useEffect(() => { const e = el(); if (e) e.playbackRate = speed; });

  const onTime = () => {
    const e = el(); if (!e) return;
    const now = e.currentTime; setT(now);
    // replay reactions at the moment they were sent
    for (const r of polo.reactions) {
      if (r.t != null && !shown.current.has(r.id) && now >= r.t && now < r.t + 1.5) {
        shown.current.add(r.id);
        burst(r.kind, members.find(m => m.id === r.who));
      }
    }
  };

  const burst = (kind: string, who?: Person) => {
    const id = Date.now() + Math.random();
    setBursts(b => [...b, { id, kind, x: 10 + Math.random() * 70, who }]);
    setTimeout(() => setBursts(b => b.filter(x => x.id !== id)), 2200);
  };

  const react = async (kind: string) => {
    pop(); burst(kind, me);
    const at = polo.kind === 'text' ? null : el()?.currentTime ?? null;
    try {
      const upd = await api.react(polo.id, kind, at);
      for (const r of upd.reactions) shown.current.add(r.id); // already burst locally
      setItems(it => it.map(p => (p.id === upd.id ? { ...p, reactions: upd.reactions } : p)));
      liveSend(polo.chat, 'react', { id: polo.id });
    } catch (e) { toast((e as Error).message); }
  };

  const togglePause = () => {
    const e = el();
    if (polo.kind === 'text') { clearTimeout(textTimer.current); setPaused(p => { if (p) textTimer.current = window.setTimeout(next, 2500); return !p; }); return; }
    if (!e) return;
    if (e.paused) { void e.play(); setPaused(false); } else { e.pause(); setPaused(true); }
  };

  // tap zones: left third back, right third forward, middle pause; long press pauses while held
  const onDown = () => { held.current = false; holdTimer.current = window.setTimeout(() => { held.current = true; el()?.pause(); setPaused(true); }, 280); };
  const onUp = (e: React.PointerEvent) => {
    clearTimeout(holdTimer.current);
    if (held.current) { held.current = false; void el()?.play(); setPaused(false); return; }
    const x = e.clientX / window.innerWidth;
    if (x < 0.28) { const m = el(); if (m && m.currentTime > 2) m.currentTime = 0; else prev(); }
    else if (x > 0.72) next();
    else togglePause();
  };

  const save = async () => {
    const on = !polo.savedBy.includes(me.id);
    await api.save(polo.id, on).catch(() => {});
    setItems(it => it.map(p => (p.id === polo.id ? { ...p, savedBy: on ? [...p.savedBy, me.id] : p.savedBy.filter(x => x !== me.id) } : p)));
    toast(on ? 'Saved forever. Find it under Saved.' : 'Removed from Saved'); onChanged?.();
  };
  const download = async () => {
    if (!polo.path) return;
    const u = await mediaUrl(polo.path);
    const a = document.createElement('a'); a.href = u;
    a.download = `holler-${(author?.name || 'polo').replace(/\W+/g, '-')}-${polo.at.slice(0, 10)}.${polo.path.split('.').pop()}`;
    document.body.appendChild(a); a.click(); a.remove();
  };
  const del = async () => {
    if (!confirm('Delete this holler for everyone?')) return;
    await removeMine(polo).catch(e => toast(e.message));
    const rest = items.filter(p => p.id !== polo.id);
    if (!rest.length) { onClose(); return; }
    setItems(rest); setIdx(i => Math.min(i, rest.length - 1)); setMenu(false); onChanged?.();
  };
  const cycleSpeed = () => { const s = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; setSpeed(s); void api.updateMe({ prefs: { speed: s } }); };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(); else if (e.key === 'ArrowRight') next(); else if (e.key === 'ArrowLeft') prev(); else if (e.key === ' ') { e.preventDefault(); togglePause(); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });

  if (!polo) return null;
  const caption = segs.length ? [...segs].reverse().find(s => s.t <= t + 0.3)?.text || (t < (segs[0]?.t ?? 0) ? '' : '') : '';
  const viewers = polo.views.filter(v => v.who !== polo.author).map(v => members.find(m => m.id === v.who)).filter(Boolean) as Person[];
  const realDur = dur || (el()?.duration && isFinite(el()!.duration) ? el()!.duration : 0);

  return (
    <div className="player">
      <div className="bars">
        {items.map((p, i) => (
          <i key={p.id}><b style={{ width: i < idx ? '100%' : i > idx ? '0%' : `${polo.kind === 'text' ? (paused ? 50 : 100) : realDur ? Math.min(100, (t / realDur) * 100) : 0}%`, transition: i === idx && polo.kind === 'text' && !paused ? `width ${Math.min(9, 2.5 + (polo.body || '').split(/\s+/).length * 0.28)}s linear` : undefined }} /></i>
        ))}
      </div>
      <div className="p-top">
        <Avatar p={author} size={36} />
        <div className="p-who">
          <b>{author?.id === me.id ? 'You' : author?.name || 'Someone'}</b>
          <span>{ago(polo.at)}{polo.effects?.voice && polo.effects.voice !== 'none' ? ` · ${String(polo.effects.voice)} voice` : ''}{polo.effects?.hd ? ' · HD' : ''}</span>
        </div>
        <button className="icon-btn glass" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      </div>

      <div className="stage" onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => clearTimeout(holdTimer.current)}>
        {polo.kind === 'video' && src && (
          <video ref={vid} key={polo.id} src={src} autoPlay playsInline className="p-video"
            onLoadedData={() => setLoading(false)} onCanPlay={() => setLoading(false)} onTimeUpdate={onTime} onEnded={next}
            onError={() => { setLoading(false); toast('This one would not play here'); }}
            onPlay={() => { const e = vid.current; if (e) e.playbackRate = speed; }} />
        )}
        {polo.kind === 'audio' && (
          <div className="p-audio" style={{ ['--c' as string]: author?.color }}>
            <div className="p-audio-ring"><Avatar p={author} size={140} /></div>
            {src && <audio ref={aud} key={polo.id} src={src} autoPlay onCanPlay={() => setLoading(false)} onTimeUpdate={onTime} onEnded={next} />}
          </div>
        )}
        {polo.kind === 'text' && (
          <div className="p-text" style={{ ['--c' as string]: author?.color }}><p>{polo.body}</p></div>
        )}
        {loading && polo.kind !== 'text' && <div className="spinner" />}
        {paused && <div className="paused"><Icon name="play" size={48} fill="currentColor" /></div>}
        {cc && caption && <div className="p-cap">{caption}</div>}
        <div className="bursts">
          {bursts.map(b => {
            const r = REACTIONS.find(x => x.id === b.kind);
            return <span key={b.id} className="burst" style={{ left: `${b.x}%`, color: r?.color }}><Icon name={b.kind} size={44} stroke={2.2} />{b.who && <em>{b.who.id === me.id ? 'You' : b.who.name.split(' ')[0]}</em>}</span>;
          })}
        </div>
      </div>

      <div className="p-bottom">
        <div className="p-meta">
          {polo.kind !== 'text' && <span className="p-time">{clock(t)} / {clock(realDur)}</span>}
          {polo.kind !== 'text' && realDur > 0 && (
            <input className="scrub" type="range" min={0} max={realDur} step={0.05} value={Math.min(t, realDur)} aria-label="Seek"
              onChange={e => { const m = el(); if (m) { m.currentTime = Number(e.target.value); setT(m.currentTime); } }} />
          )}
          {viewers.length > 0 && <span className="seen"><Icon name="eye" size={14} /> {viewers.map(v => <Avatar key={v.id} p={v} size={18} />)}</span>}
          {polo.reactions.length > 0 && (
            <span className="rx-sum">{REACTIONS.filter(r => polo.reactions.some(x => x.kind === r.id)).map(r => <span key={r.id} style={{ color: r.color }}><Icon name={r.id} size={15} /></span>)}<b>{polo.reactions.length}</b></span>
          )}
        </div>
        <div className="reacts">
          {REACTIONS.map(r => <button key={r.id} style={{ color: r.color }} onClick={() => void react(r.id)} aria-label={r.label}><Icon name={r.id} size={26} /></button>)}
        </div>
        <div className="p-tools">
          {polo.kind !== 'text' && <button className="pill-btn" onClick={cycleSpeed}><Icon name="speed" size={16} /> {speed}x</button>}
          {segs.length > 0 && <button className={`pill-btn ${cc ? 'on' : ''}`} onClick={() => setCc(c => !c)}><Icon name="cc" size={16} /> Captions</button>}
          <button className={`pill-btn ${polo.savedBy.includes(me.id) ? 'on' : ''}`} onClick={() => void save()}><Icon name="star" size={16} fill={polo.savedBy.includes(me.id) ? 'currentColor' : undefined} /> {polo.savedBy.includes(me.id) ? 'Saved' : 'Save'}</button>
          {polo.path && <button className="pill-btn" onClick={() => void download()} aria-label="Download"><Icon name="download" size={16} /></button>}
          {polo.author === me.id && !standalone && <button className="pill-btn" onClick={() => setMenu(m => !m)} aria-label="More"><Icon name="trash" size={16} /></button>}
          {!standalone && <button className="pill-btn reply" onClick={onClose}>Reply</button>}
        </div>
        {menu && <div className="p-menu"><button className="btn danger wide" onClick={() => void del()}>Delete for everyone</button></div>}
        {segs.length > 0 && cc && <details className="transcript"><summary>Full transcript</summary><p>{segs.map(s => s.text).join(' ')}</p></details>}
      </div>
    </div>
  );
}
