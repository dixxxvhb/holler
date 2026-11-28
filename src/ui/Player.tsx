import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, mediaUrl, prefetch, publicUrl, type ChatFull, type Person, type Polo } from '../lib/api';
import { send as liveSend } from '../lib/live';
import { removeMine, sendRecording } from '../lib/outbox';
import type { Recording, Studio } from '../lib/studio';
import type { Card } from '../games/content/cardDecks';
import { loadGames } from '../games/load';
import { LiveFace, SyncedVideo, filmOn, readSync, setFilm, type SyncPoint } from '../games/reaction';
import '../games/games.css';
import { parseTranscript } from '../lib/speech';
import { pop } from '../lib/sound';
import { Avatar, ago, ask, clock, toast, tone, when } from './bits';
import { Icon, REACTIONS } from './icons';

const SPEEDS = [1, 1.5, 2];

export function Player({ chat, list, start, me, onClose, onReply, onChanged, standalone, studio, onCamWanted, onAnswerCard }: {
  chat: ChatFull | null; list: Polo[]; start: number; me: Person; onClose: () => void; /** Reply: close and get ready to answer (the room opens its camera) */ onReply?: () => void; onChanged?: () => void; standalone?: boolean;
  studio?: Studio | null; onAnswerCard?: (cardId: string) => void;
  /** asks the room for the camera (it sleeps unless something uses it); resolves true once it is on */
  onCamWanted?: (on: boolean) => Promise<boolean>;
}) {
  const [idx, setIdx] = useState(Math.max(0, start));
  const [items, setItems] = useState(list);
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dl, setDl] = useState<number | null>(null); // first watch: how much of the file is here (null = not known)
  const [paused, setPaused] = useState(false);
  const [t, setT] = useState(0);
  const [speed, setSpeed] = useState(me.prefs?.speed || 1);
  const [cc, setCc] = useState(me.prefs?.captions !== false);
  const [bursts, setBursts] = useState<{ id: number; kind: string; x: number; who?: Person }[]>([]);
  // the gestures are invisible, so say them once, the first time anyone watches anything
  const [hint, setHint] = useState(() => { try { return !localStorage.getItem('holler.phint'); } catch { return false; } });
  useEffect(() => {
    if (!hint) return;
    try { localStorage.setItem('holler.phint', '1'); } catch { /* private mode */ }
    const t = setTimeout(() => setHint(false), 6000);
    return () => clearTimeout(t);
  }, [hint]);
  const [needTap, setNeedTap] = useState(false);
  const vid = useRef<HTMLVideoElement>(null); // one element for every video and voice holler (iOS lets a played element keep playing)
  const textTimer = useRef(0);
  const shown = useRef(new Set<string>());
  const holdTimer = useRef(0);
  const held = useRef(false);
  const start0 = useRef<{ x: number; y: number } | null>(null);
  const [dragY, setDragY] = useState(0);

  const polo = items[idx];
  // ---- reactions: the original a reaction answers, played small beside it in sync ----
  const orig = polo?.reactTo ? (chat?.polos?.find(p => p.id === polo.reactTo) || list.find(p => p.id === polo.reactTo)) : undefined;
  const sync = readSync(polo?.effects);
  const [origSrc, setOrigSrc] = useState<string | null>(null);
  const [swap, setSwap] = useState(false);
  useEffect(() => { setSwap(false); setOrigSrc(null); if (orig?.path) void mediaUrl(orig.path).then(setOrigSrc); }, [orig?.id, orig?.path]);
  const mainEl = useCallback(() => vid.current, []);
  // ---- Film my reaction ----
  const canFilm = !!onCamWanted && !standalone && !!polo && polo.author !== me.id && polo.kind !== 'text' && !!chat;
  const [film, setFilmS] = useState(() => (chat ? filmOn(chat.id) : false));
  // the camera sleeps unless something uses it: with the switch on, ask for it while this player is open (only when
  // there is someone else's holler here to react to), and give it back when the switch goes off or the player closes
  const anyFilmable = useMemo(() => list.some(p => p.author !== me.id && p.kind !== 'text'), [list, me.id]);
  const wantCam = film && anyFilmable && !!onCamWanted && !standalone && !!chat;
  useEffect(() => {
    if (!wantCam || !onCamWanted) return;
    let gone = false;
    void onCamWanted(true).then(ok => {
      if (ok || gone) return;
      toast('Could not start the camera'); setFilmS(false); if (chat) setFilm(chat.id, false);
    });
    return () => { gone = true; void onCamWanted(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantCam]);
  const [filming, setFilming] = useState(false);
  const [afterEnd, setAfterEnd] = useState(false);
  const [review, setReview] = useState<{ rec: Recording; url: string; sync: SyncPoint[]; of: Polo; origUrl: string | null } | null>(null);
  const syncLog = useRef<SyncPoint[]>([]);
  const filmT = useRef(0);
  const then = useRef<(() => void) | null>(null);
  const mark = (playing?: boolean) => {
    const e = vid.current; if (!filming || !e || !studio) return;
    syncLog.current.push({ r: Math.round(studio.elapsed() * 100) / 100, o: Math.round(e.currentTime * 100) / 100, rate: e.playbackRate, playing: playing ?? !e.paused });
  };
  // on: the switch was just flipped on in this same tap (state hasn't caught up yet)
  const startFilm = async (on = film) => {
    if (!canFilm || !on || filming || review || !studio || studio.recording) return;
    try {
      await studio.start('video', { videoBits: 500_000 });
      syncLog.current = [{ r: 0, o: Math.round((vid.current?.currentTime || 0) * 100) / 100, rate: vid.current?.playbackRate || 1, playing: true }];
      setFilming(true); setAfterEnd(false);
    } catch (e) { toast('Could not film: ' + (e as Error).message); }
  };
  const stopFilm = async (action?: () => void) => {
    clearTimeout(filmT.current);
    if (!filming || !studio) { action?.(); return; }
    setFilming(false); setAfterEnd(false);
    const e = vid.current; if (e && !e.paused) e.pause();
    const rec = await studio.stop();
    if (!rec || rec.duration < 1 || rec.blob.size < 1000) { toast('That reaction came out empty'); action?.(); return; }
    then.current = action || null;
    setReview({ rec, url: URL.createObjectURL(rec.blob), sync: syncLog.current, of: polo, origUrl: origSrcFor.current });
  };
  const origSrcFor = useRef<string | null>(null);
  useEffect(() => { origSrcFor.current = src; }, [src]);
  const closeReview = (send: boolean) => {
    const r = review; if (!r || !chat) return;
    if (send) {
      sendRecording(chat.id, me.id, { ...r.rec, effects: { ...r.rec.effects, reactTo: r.of.id, sync: r.sync } }, null, () => onChanged?.());
      toast('Reaction sent');
    }
    URL.revokeObjectURL(r.url); setReview(null);
    const a = then.current; then.current = null; (a || next)();
  };
  useEffect(() => () => { if (studio?.recording) studio.cancel(); }, [studio]);
  // the camera came on while a holler is already playing: start filming now
  useEffect(() => { const e = vid.current; if (studio && film && e && !e.paused) void startFilm(true); }, [studio]); // eslint-disable-line react-hooks/exhaustive-deps
  // ---- cards ----
  const cardId = typeof polo?.effects?.cardId === 'string' ? (polo.effects.cardId as string) : null;
  const [card, setCard] = useState<Card | undefined>();
  useEffect(() => {
    setCard(undefined); if (!cardId) return;
    let gone = false;
    void loadGames().then(g => { if (!gone) setCard(g.cardById(cardId)); }).catch(() => {});   // the cards are in the games download
    return () => { gone = true; };
  }, [cardId]);
  const [answer, setAnswer] = useState(false);
  useEffect(() => setAnswer(false), [polo?.id]);
  const members = chat?.members || [];
  const author = members.find(m => m.id === polo?.author) || (polo?.author === me.id ? me : undefined);
  const segs = parseTranscript(polo?.transcript || null);
  const dur = polo?.duration || 0;
  const el = () => vid.current;

  const next = useCallback(() => {
    setIdx(i => { if (i + 1 >= items.length) { onClose(); return i; } return i + 1; });
  }, [items.length, onClose]);
  const prev = () => setIdx(i => Math.max(0, i - 1));
  const close = () => { if (filming) void stopFilm(onClose); else onClose(); };
  const goNext = () => { if (filming) void stopFilm(next); else next(); };
  const goPrev = () => { if (filming) void stopFilm(prev); else prev(); };
  const ended = () => {
    if (filming) {
      mark(false); setAfterEnd(true);
      filmT.current = window.setTimeout(() => void stopFilm(), 15000);
      return;
    }
    if (card?.answer) { setAnswer(true); clearTimeout(textTimer.current); textTimer.current = window.setTimeout(next, 4000); return; }
    next();
  };

  // load media + mark watched
  useEffect(() => {
    if (!polo) return;
    let gone = false;
    setSrc(null); setT(0); setPaused(false); setNeedTap(false); setDl(null); shown.current = new Set(); clearTimeout(textTimer.current);
    if (polo.author !== me.id && !polo.views.some(v => v.who === me.id)) {
      api.view(polo.id).then(() => liveSend(polo.chat, 'view', { id: polo.id })).catch(() => {});
    }
    if (polo.kind === 'text') {
      setLoading(false); vid.current?.pause();
      const ms = Math.min(9000, 2500 + (polo.body || '').split(/\s+/).length * 280);
      textTimer.current = window.setTimeout(next, ms);
    } else if (polo.path) {
      setLoading(true);
      mediaUrl(polo.path, f => { if (!gone) setDl(f); }).then(u => { if (!gone) setSrc(u); });
    }
    // warm the next one into the device cache (one file at a time, after this one has arrived)
    const n = items[idx + 1]; if (n?.path) prefetch([n.path]);
    return () => { gone = true; clearTimeout(textTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polo?.id]);

  useEffect(() => { const e = el(); if (e) e.playbackRate = speed; });
  // start each one; if the browser wants a tap first (iPhone sound rules), ask for one
  useEffect(() => {
    const e = vid.current; if (!e || !src) return;
    e.src = src; e.playbackRate = speed;
    e.play().then(() => setNeedTap(false)).catch(err => { if (err?.name === 'NotAllowedError') { setNeedTap(true); setLoading(false); } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

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
    if (needTap) { void e.play().then(() => setNeedTap(false)); return; }
    if (e.paused) { void e.play(); setPaused(false); } else { e.pause(); setPaused(true); }
  };

  // tap zones: left third back, right third forward, middle pause; long press pauses while held.
  // Swipes: down closes, left goes to the next one, right goes back.
  const onDown = (e: React.PointerEvent) => {
    start0.current = { x: e.clientX, y: e.clientY };
    held.current = false; holdTimer.current = window.setTimeout(() => { held.current = true; el()?.pause(); setPaused(true); }, 280);
  };
  const onMove = (e: React.PointerEvent) => {
    const s = start0.current; if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) clearTimeout(holdTimer.current);
    if (dy > 0 && dy > Math.abs(dx)) setDragY(dy); else if (dragY) setDragY(0);
  };
  const onUp = (e: React.PointerEvent) => {
    clearTimeout(holdTimer.current);
    const s = start0.current; start0.current = null; setDragY(0);
    const dx = s ? e.clientX - s.x : 0, dy = s ? e.clientY - s.y : 0;
    if (held.current) { held.current = false; void el()?.play(); setPaused(false); if (Math.abs(dx) < 40 && dy < 90) return; }
    if (dy > 110 && dy > Math.abs(dx) * 1.2) { close(); return; }
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.2) { if (dx < 0) goNext(); else goPrev(); return; }
    if (Math.abs(dx) > 20 || Math.abs(dy) > 20) return; // a drag that went nowhere
    const x = e.clientX / window.innerWidth;
    if (x < 0.28) { const m = el(); if (m && m.currentTime > 2) m.currentTime = 0; else goPrev(); }
    else if (x > 0.72) goNext();
    else togglePause();
  };

  const save = async () => {
    const on = !polo.savedBy.includes(me.id);
    try { await api.save(polo.id, on); } catch (e) { toast((e as Error).message || 'Could not save that'); return; }
    setItems(it => it.map(p => (p.id === polo.id ? { ...p, savedBy: on ? [...p.savedBy, me.id] : p.savedBy.filter(x => x !== me.id) } : p)));
    toast(on ? 'Saved. Find it under Saved.' : 'Removed from Saved'); onChanged?.();
  };
  const download = async () => {
    if (!polo.path) return;
    const u = await mediaUrl(polo.path);
    const a = document.createElement('a'); a.href = u;
    a.download = `holler-${(author?.name || 'polo').replace(/\W+/g, '-')}-${polo.at.slice(0, 10)}.${polo.path.split('.').pop()}`;
    document.body.appendChild(a); a.click(); a.remove();
  };
  const del = async () => {
    const e = el(); const was = !!e && !e.paused; if (was) { e!.pause(); setPaused(true); }
    if (!(await ask({ title: 'Delete this holler?', body: 'It goes away for everyone in the chat.', yes: 'Delete for everyone', danger: true }))) { if (was) { void e!.play(); setPaused(false); } return; }
    try { await removeMine(polo); } catch (e) { toast((e as Error).message || 'Could not delete that'); return; }
    const rest = items.filter(p => p.id !== polo.id);
    if (!rest.length) { onClose(); return; }
    setItems(rest); setIdx(i => Math.min(i, rest.length - 1)); onChanged?.();
  };
  const cycleSpeed = () => { const s = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; setSpeed(s); void api.updateMe({ prefs: { speed: s } }); };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (review || document.querySelector('.sheet-wrap:not(.closing)')) return;   // a question is up: the keys are its
      if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') goNext(); else if (e.key === 'ArrowLeft') goPrev(); else if (e.key === ' ') { e.preventDefault(); togglePause(); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });

  if (!polo) return null;
  const caption = segs.length ? [...segs].reverse().find(s => s.t <= t + 0.3)?.text || (t < (segs[0]?.t ?? 0) ? '' : '') : '';
  const viewers = polo.views.filter(v => v.who !== polo.author).map(v => members.find(m => m.id === v.who)).filter(Boolean) as Person[];
  const realDur = dur || (el()?.duration && isFinite(el()!.duration) ? el()!.duration : 0);

  return (
    <div className="player" data-room={chat?.theme} style={dragY ? { transition: 'none', transform: `translateY(${dragY}px) scale(${1 - Math.min(0.12, dragY / 2000)})`, borderRadius: Math.min(28, dragY / 6), opacity: 1 - Math.min(0.5, dragY / 900) } : undefined}>
      <div className="bars">
        {items.map((p, i) => (
          <i key={p.id}><b style={{ width: i < idx ? '100%' : i > idx ? '0%' : `${polo.kind === 'text' ? (paused ? 50 : 100) : realDur ? Math.min(100, (t / realDur) * 100) : 0}%`, transition: i === idx && polo.kind === 'text' && !paused ? `width ${Math.min(9, 2.5 + (polo.body || '').split(/\s+/).length * 0.28)}s linear` : undefined }} /></i>
        ))}
      </div>
      <div className="p-top">
        <Avatar p={author} size={38} />
        <div className="p-who">
          <b>{author?.id === me.id ? 'You' : author?.name || 'Someone'}</b>
          <span>{ago(polo.at)}{polo.effects?.voice && polo.effects.voice !== 'none' ? ` · ${String(polo.effects.voice)} voice` : ''}</span>
        </div>
        <button className="icon-btn glass" onClick={close} aria-label="Close"><Icon name="close" /></button>
      </div>
      {canFilm && !filming && (
        <button className={`g-film ${film ? 'on' : ''}`} onClick={() => { const v = !film; setFilmS(v); if (chat) setFilm(chat.id, v); if (v && !paused && !needTap && !loading) void startFilm(true); }}>
          <span className="g-sw" />Film my reaction
        </button>
      )}
      {filming && <div className="g-face live"><LiveFace studio={studio || null} className="g-face-vid" /><span className="g-face-lab"><i className="g-dot" />You</span></div>}
      {afterEnd && filming && (
        <div className="g-after"><span>Still filming. Keep talking, or</span><button className="btn primary" onClick={() => void stopFilm()}>Done</button></div>
      )}

      <div className="stage" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { clearTimeout(holdTimer.current); start0.current = null; setDragY(0); }}>
        <video ref={vid} playsInline preload="auto" className={`p-video ${polo.kind === 'video' ? '' : 'gone'} ${orig && swap ? 'g-pip' : ''}`}
          onLoadedData={() => setLoading(false)} onCanPlay={() => setLoading(false)} onTimeUpdate={onTime} onEnded={ended}
          onError={() => { if (vid.current?.getAttribute('src')) { setLoading(false); toast('This one would not play here'); } }}
          onPlay={() => { const e = vid.current; if (e) e.playbackRate = speed; }}
          onPlaying={() => { if (filming) mark(true); else void startFilm(); }} onPause={() => mark(false)} onSeeked={() => mark()} onRateChange={() => mark()}
          onClick={orig && swap ? e => { e.stopPropagation(); setSwap(false); } : undefined} />
        {orig && origSrc && (
          <SyncedVideo src={origSrc} sync={sync} main={mainEl} className={swap ? 'p-video g-orig-big' : 'g-pip'} onClick={() => setSwap(s => !s)} />
        )}
        {orig && origSrc && <button type="button" className={`g-pip-lab ${swap ? 'big' : ''}`} onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()} onClick={() => setSwap(s => !s)} aria-label="Swap which video is big"><Icon name="swap" size={14} /> {swap ? (author?.id === me.id ? 'You' : author?.name.split(' ')[0]) : (orig.author === me.id ? 'Yours' : (members.find(m => m.id === orig.author)?.name.split(' ')[0] || 'Theirs'))}</button>}
        {polo.reactTo && !orig && <span className="g-gone">The holler this reacts to is gone.</span>}
        {answer && card?.answer && <div className="g-answer"><small>Real answer</small><b>{card.answer.n}%</b><span>{card.answer.source}, {card.answer.year}</span></div>}
        {polo.kind === 'audio' && (
          <div className="p-audio" style={{ ['--c' as string]: tone(author?.color) }}>
            <div className="p-audio-ring"><Avatar p={author} size={140} /></div>
          </div>
        )}
        {polo.kind === 'text' && (
          <div className="p-text" style={{ ['--c' as string]: tone(author?.color) }}><p>{polo.body}</p></div>
        )}
        {loading && polo.kind === 'video' && (polo.thumb || polo.pending?.thumbUrl) && (
          <img className="p-video" src={polo.thumb ? publicUrl(polo.thumb) : polo.pending?.thumbUrl} alt="" draggable={false} style={{ pointerEvents: 'none' }} />
        )}
        {loading && polo.kind !== 'text' && (dl == null ? <div className="spinner" /> : <LoadRing f={dl} />)}
        {needTap && <div className="paused tap"><Icon name="play" size={56} fill="currentColor" /><span>Tap to play</span></div>}
        {paused && !needTap && <div className="paused"><Icon name="play" size={48} fill="currentColor" /></div>}
        {cc && caption && <div className="p-cap"><span>{caption}</span></div>}
        {hint && !needTap && <div className="p-hint"><span>Tap the sides to skip. Hold to pause. Swipe down to close.</span></div>}
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
          {viewers.length > 0 && polo.author !== me.id && <span className="seen"><Icon name="eye" size={14} /> {viewers.map(v => <Avatar key={v.id} p={v} size={18} />)}</span>}
          {polo.reactions.length > 0 && (
            <span className="rx-sum">{REACTIONS.filter(r => polo.reactions.some(x => x.kind === r.id)).map(r => <span key={r.id} style={{ color: r.color }}><Icon name={r.id} size={15} /></span>)}<b>{polo.reactions.length}</b></span>
          )}
        </div>
        {polo.author === me.id && members.length > 1 && (
          <div className="receipts">
            {members.filter(m => m.id !== me.id).map(m => {
              const v = polo.views.find(x => x.who === m.id);
              return (
                <span key={m.id} className={`rcpt ${v ? 'seen' : ''}`}>
                  <Avatar p={m} size={22} />
                  <b>{m.name.split(' ')[0]}</b>
                  <em>{v ? <><Icon name="eye" size={12} /> {when(v.at)}</> : 'Not yet'}</em>
                </span>
              );
            })}
          </div>
        )}
        <div className="p-tools">
          {polo.kind !== 'text' && <button className="pill-btn" onClick={cycleSpeed} aria-label="Speed">{speed}x</button>}
          {segs.length > 0 && <button className={`pill-btn ${cc ? 'on' : ''}`} onClick={() => setCc(c => !c)} aria-label="Captions" aria-pressed={cc}><Icon name="cc" size={20} /><span className="lb">Captions</span></button>}
          <button className={`pill-btn ${polo.savedBy.includes(me.id) ? 'on' : ''}`} onClick={() => void save()} aria-label={polo.savedBy.includes(me.id) ? 'Saved' : 'Save'}><Icon name="bookmark" size={20} fill={polo.savedBy.includes(me.id) ? 'currentColor' : undefined} /><span className="lb">{polo.savedBy.includes(me.id) ? 'Saved' : 'Save'}</span></button>
          {polo.path && <button className="pill-btn" onClick={() => void download()} aria-label="Download"><Icon name="download" size={20} /></button>}
          {polo.author === me.id && !standalone && <button className="pill-btn" onClick={() => void del()} aria-label="Delete"><Icon name="trash" size={20} /></button>}
          {cardId && onAnswerCard && !standalone && <button className="pill-btn g-cardans" onClick={() => { const id = cardId; void stopFilm(() => { onClose(); onAnswerCard(id); }); }} aria-label="Answer this card"><Icon name="cards" size={20} /><span className="lb">Answer this card</span></button>}
        </div>
        <div className="reacts">
          {REACTIONS.map(r => <button key={r.id} onClick={() => void react(r.id)} aria-label={r.label}><Icon name={r.id} size={26} /></button>)}
        </div>
        {!standalone && <button className="pill-btn reply" onClick={() => { const next = onReply || onClose; if (filming) void stopFilm(next); else next(); }}>Reply</button>}
        {segs.length > 0 && cc && <details className="transcript"><summary>Full transcript</summary><p>{segs.map(s => s.text).join(' ')}</p></details>}
      </div>
      {review && <ReactionReview r={review} onDone={closeReview} />}
    </div>
  );
}

/** First watch: the file comes down whole before it plays (so rewatching is free); this shows how far along it is. */
function LoadRing({ f }: { f: number }) {
  const r = 26, c = 2 * Math.PI * r;
  return (
    <div role="progressbar" aria-label="Loading" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(f * 100)}
      style={{ position: 'absolute', left: '50%', top: '50%', width: 68, height: 68, margin: -34, borderRadius: '50%', background: 'rgba(8, 7, 12, .55)', pointerEvents: 'none' }}>
      <svg width="68" height="68" viewBox="0 0 68 68" aria-hidden="true">
        <circle cx="34" cy="34" r={r} fill="none" stroke="var(--seam-2)" strokeWidth="5" />
        <circle cx="34" cy="34" r={r} fill="none" stroke="var(--chalk)" strokeWidth="5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0.03, Math.min(1, f)))} transform="rotate(-90 34 34)"
          style={{ transition: 'stroke-dashoffset .25s linear' }} />
      </svg>
    </div>
  );
}

function ReactionReview({ r, onDone }: { r: { url: string; sync: SyncPoint[]; origUrl: string | null }; onDone: (send: boolean) => void }) {
  const v = useRef<HTMLVideoElement>(null);
  const main = useCallback(() => v.current, []);
  const [tap, setTap] = useState(false);
  useEffect(() => { v.current?.play().catch(() => setTap(true)); }, [r.url]);
  return (
    <div className="g-review">
      <video ref={v} src={r.url} autoPlay loop playsInline className="p-video" onClick={() => { if (tap) void v.current?.play().then(() => setTap(false)); }} />
      {tap && <button className="paused tap" onClick={() => void v.current?.play().then(() => setTap(false))}><Icon name="play" size={56} fill="currentColor" /><span>Tap to play</span></button>}
      {r.origUrl && <SyncedVideo src={r.origUrl} sync={r.sync} main={main} className="g-pip" muted />}
      <div className="g-review-bar">
        <span className="g-row-btns"><button className="btn" onClick={() => onDone(false)}>Toss it</button><button className="btn primary" onClick={() => onDone(true)}>Send my reaction</button></span>
        <p>Only your face is sent. Their holler plays beside it.</p>
      </div>
    </div>
  );
}
