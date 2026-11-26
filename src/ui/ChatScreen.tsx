import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../App';
import { api, publicUrl, type ChatFull, type Polo } from '../lib/api';
import { onLive, onPresence, onReconnect, presenceOf, send as liveSend, setStatus } from '../lib/live';
import { onOutbox, outgoing, retry, discard, sendRecording, sendText, undo, UNDO_MS } from '../lib/outbox';
import { Studio, probeFile, type Recording, type Stroke } from '../lib/studio';
import { KINDS, LOOKS, lookOf, type LookId, type LookKind } from '../lib/looks';
import { VOICES, type VoiceId } from '../lib/voice';
import { Captioner, isIOS, speechSupported, type Seg } from '../lib/speech';
import { pop, recStart, recStop } from '../lib/sound';
import { Avatar, Sheet, THEMES, chatTitle, clock, toast } from './bits';
import { Icon } from './icons';
import { isSimple, setSimple, routeInMemory } from '../lib/device';
import { Player } from './Player';
import { ChatInfo } from './ChatInfo';

const MAX_SEC = { sd: 300, hd: 150 };
const INK = ['#ffffff', '#111111', '#ff6a3d', '#ffb02e', '#c6f432', '#4fd1a5', '#4cb3ff', '#9b7bff', '#ff7aa2'];

type Panel = null | 'looks' | 'voice' | 'draw' | 'text';

export function ChatScreen({ chatId }: { chatId: string }) {
  const { home, go, refresh, route } = useApp();
  const me = home!.me;
  const prefs = me.prefs || {};
  const [chat, setChat] = useState<ChatFull | null>(null);
  const [err, setErr] = useState('');
  const [, bump] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const studio = useRef<Studio | null>(null);
  const [camState, setCamState] = useState<'off' | 'starting' | 'on' | 'denied'>('off');
  const [panel, setPanel] = useState<Panel>(null);
  const [look, setLook] = useState<LookId>((prefs.look as LookId) || 'none');
  const [voice, setVoice] = useState<VoiceId>((prefs.voice as VoiceId) || 'none');
  const [hd, setHd] = useState(!!prefs.hd);
  const [audioOnly, setAudioOnly] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [ink, setInk] = useState(INK[2]);
  const [inkW, setInkW] = useState(10);
  const [text, setText] = useState('');
  const [textStyle, setTextStyle] = useState<'pill' | 'bold' | 'type'>('pill');
  const [textColor, setTextColor] = useState('#ffffff');
  const [textY, setTextY] = useState(0.72);
  const [player, setPlayer] = useState<{ list: Polo[]; start: number } | null>(null);
  const [info, setInfo] = useState(route[2] === 'invite');
  const [typing, setTyping] = useState(false);
  const [msg, setMsg] = useState('');
  const [caption, setCaption] = useState('');
  const [review, setReview] = useState<{ rec: Recording; segs: Seg[]; url: string } | null>(null);
  const captioner = useRef<Captioner | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const tickRef = useRef(0);
  const [paused, setPaused] = useState(false);
  const local = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
  const keep = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
  const [timer, setTimer] = useState(() => Number(local('holler.timer', '0')));
  const [countdown, setCountdown] = useState(0);
  const countRef = useRef(0);
  const [ring, setRing] = useState(() => local('holler.ring', '0') === '1');
  const [held, setHeld] = useState(false);
  const [kind, setKind] = useState<LookKind>(() => lookOf((prefs.look as string) || 'none').kind);
  const [amts, setAmts] = useState<Record<string, number>>(() => { try { return JSON.parse(local('holler.amt', '{}')); } catch { return {}; } });
  const amt = amts[look] ?? lookOf(look).amt;
  const setAmt = (v: number) => { const n = { ...amts, [look]: v }; setAmts(n); keep('holler.amt', JSON.stringify(n)); };
  const [flash, setFlash] = useState('');
  const flashT = useRef(0);
  const prefT = useRef(0);
  const [cut, setCut] = useState<'' | 'loading' | 'ready' | 'failed'>('');
  const chooseLook = (id: LookId, show = false) => {
    setLook(id); setKind(lookOf(id).kind);
    if (show) { setFlash(lookOf(id).label); clearTimeout(flashT.current); flashT.current = window.setTimeout(() => setFlash(''), 900); }
    clearTimeout(prefT.current); prefT.current = window.setTimeout(() => void api.updateMe({ prefs: { look: id } }), 900);
  };
  const stepLook = (dir: number) => { const i = LOOKS.findIndex(l => l.id === look); chooseLook(LOOKS[(i + dir + LOOKS.length) % LOOKS.length].id, true); };

  const load = useCallback(async () => {
    try { const c = await api.chat(chatId); setChat(c); setErr(''); }
    catch (e) { setErr((e as Error).message); }
  }, [chatId]);

  useEffect(() => { void load(); }, [load]);
  // the invite sheet opens once after making a chat; drop it from the address so a reload doesn't reopen it
  useEffect(() => { if (route[2] === 'invite' && !routeInMemory) history.replaceState(null, '', `${location.pathname}#/c/${chatId}`); }, [route, chatId]);
  useEffect(() => onLive(e => { if (e.chat === chatId) void load(); }), [chatId, load]);
  useEffect(() => onReconnect(id => { if (id === chatId) void load(); }), [chatId, load]);
  // backstop in case a live ping is missed
  useEffect(() => { const i = setInterval(() => { if (!document.hidden) void load(); }, 15000); return () => clearInterval(i); }, [load]);
  useEffect(() => onPresence(() => bump(x => x + 1)), []);
  useEffect(() => onOutbox(() => bump(x => x + 1)), []);
  useEffect(() => { setStatus(chatId, 'here'); return () => setStatus(null); }, [chatId]);
  useEffect(() => { if (chat && !player) setStatus(chatId, recording ? 'recording' : 'here'); }, [recording, player, chat, chatId]);

  // camera
  const startCam = useCallback(async () => {
    if (!canvasRef.current) return;
    setCamState('starting');
    try {
      if (!studio.current) studio.current = new Studio(canvasRef.current);
      const s = studio.current; s.voice = voice; s.simple = isSimple(); s.amt = amt;
      s.onCutout = st => { setCut(st); if (st === 'failed') toast('Background looks could not load here. Try again on wifi, or on a newer phone.'); };
      await s.open({ hd });
      s.setLook(look);
      s.onLevel = v => setLevel(v);
      if (!s.glOk && previewRef.current && !previewRef.current.contains(s.video)) { s.video.className = `raw-video ${s.facing === 'user' ? 'mirror' : ''}`; previewRef.current.appendChild(s.video); }
      setCamState('on');
      // once per device: make sure effects actually record; if not, quietly use the plain camera
      let tested = ''; try { tested = localStorage.getItem('holler.camtest2') || ''; } catch { /* */ }
      if ((tested === '' || tested.startsWith('unsure')) && s.glOk) {
        setTimeout(async () => {
          if (!studio.current || studio.current.recording) return;
          const ok = await studio.current.selfTest();
          const tries = Number(tested.split(':')[1] || 0) + 1;
          // can't tell three times running: leave effects on
          const verdict = ok === true ? 'ok' : ok === false ? 'simple' : tries >= 3 ? 'ok' : `unsure:${tries}`;
          try { localStorage.setItem('holler.camtest2', verdict); } catch { /* */ }
          if (verdict === 'simple') {
            const st = studio.current; st.goSimple();
            if (previewRef.current && !previewRef.current.contains(st.video)) { st.video.className = `raw-video ${st.facing === 'user' ? 'mirror' : ''}`; previewRef.current.appendChild(st.video); }
            setLook('none'); setText(''); st.strokes = [];
            setSimple(true); bump(x => x + 1); toast('Your phone records best with Simple camera, so it is on. Change it in Settings.', undefined, 7000); }
        }, 1500);
      }
    } catch (e) {
      console.warn(e); setCamState('denied');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hd, look, voice]);

  const startRef = useRef(startCam); startRef.current = startCam;
  useEffect(() => {
    void startCam();
    let closedByHide = false;
    const vis = () => {
      if (document.hidden && !studio.current?.recording) { studio.current?.close(); closedByHide = true; setCamState('off'); }
      else if (!document.hidden && closedByHide) { closedByHide = false; void startRef.current(); }
    };
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); studio.current?.close(); studio.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { studio.current?.setLook(look); }, [look]);
  useEffect(() => { if (studio.current) studio.current.amt = amt; }, [amt]);
  useEffect(() => { void studio.current?.setVoice(voice); }, [voice]);
  useEffect(() => { const s = studio.current; if (s) { s.text = text.trim() ? { text, y: textY, style: textStyle, color: textColor } : null; s.markDirty(); } }, [text, textY, textStyle, textColor]);

  // scroll strip to the end on new polos
  const polos = useMemo(() => chat?.polos || [], [chat]);
  const pend = outgoing(chatId);
  useEffect(() => { const el = stripRef.current; if (el) el.scrollLeft = el.scrollWidth; }, [polos.length, pend.length]);

  const unread = polos.filter(p => p.author !== me.id && !p.views.some(v => v.who === me.id));
  const others = chat ? chat.members.filter(m => m.id !== me.id) : [];
  const pres = presenceOf(chatId);
  const theme = THEMES[chat?.theme || 'ember']?.accent || '#ff6a3d';
  const maxSec = hd ? MAX_SEC.hd : MAX_SEC.sd;

  // ---- recording ----
  // timer: count down, then record (tap again during the count to call it off)
  const startCountdown = () => {
    if (countRef.current) { clearInterval(countRef.current); countRef.current = 0; setCountdown(0); return; }
    let n = timer; setCountdown(n); pop();
    countRef.current = window.setInterval(() => {
      n -= 1;
      if (n <= 0) { clearInterval(countRef.current); countRef.current = 0; setCountdown(0); void beginRef.current(); }
      else { setCountdown(n); pop(); }
    }, 1000);
  };
  useEffect(() => () => clearInterval(countRef.current), []);

  const togglePause = () => {
    const s = studio.current; if (!s?.recording) return;
    if (s.paused) { if (s.resume()) { setPaused(false); recStart(); } }
    else if (s.pause()) { setPaused(true); recStop(); }
    else toast('This browser cannot pause a recording');
  };

  // the record button: tap to start and tap to send, or hold and let go to send
  const pressAt = useRef(0);
  const beginP = useRef<Promise<void> | null>(null);
  const onRecDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (studio.current?.recording) { void finish(); return; }
    if (countRef.current || (timer && !audioOnly)) { startCountdown(); return; }
    pressAt.current = Date.now();
    beginP.current = begin();
  };
  const onRecUp = async () => {
    if (!pressAt.current) return;
    const long = Date.now() - pressAt.current > 650; pressAt.current = 0;
    await beginP.current;
    if (long && studio.current?.recording && studio.current.elapsed() >= 1.5) void finish();
  };
  useEffect(() => {
    if (!recording) { setHeld(false); return; }
    const t = setTimeout(() => { if (pressAt.current) setHeld(true); }, 1500);
    return () => clearTimeout(t);
  }, [recording]);

  const begin = async () => {
    const s = studio.current;
    if (!s || camState !== 'on') { void startCam(); return; }
    try {
      await s.start(audioOnly ? 'audio' : 'video');
      recStart();
      setRecording(true); setElapsed(0);
      if (prefs.captions !== false && speechSupported() && !isIOS()) {
        const c = new Captioner(); captioner.current = c;
        c.onChange = () => setCaption((c.segs.slice(-1)[0]?.text ? '' : '') + (c.interim || c.segs.slice(-1)[0]?.text || ''));
        c.start();
      }
      liveSend(chatId, 'chat', { recording: true });
      clearInterval(tickRef.current);
      tickRef.current = window.setInterval(() => {
        const t = s.elapsed(); setElapsed(t);
        if (t >= maxSec) void finish();
      }, 200);
    } catch (e) { toast('Could not start recording: ' + (e as Error).message); }
  };

  const finish = async () => {
    clearInterval(tickRef.current);
    const s = studio.current; if (!s?.recording) return;
    const rec = await s.stop();
    recStop();
    setPaused(false);
    setRecording(false); setLevel(0); setCaption('');
    const segs = captioner.current?.stop() || []; captioner.current = null;
    if (!rec) return;
    if (rec.duration < 1) { toast('Too short. Tap once to start, tap again to send.'); return; }
    if (rec.blob.size < 1000) { toast('That one came out empty. Please try again.'); return; }
    if (prefs.review) { setReview({ rec, segs, url: URL.createObjectURL(rec.blob) }); }
    else {
      const key = sendRecording(chatId, me.id, rec, segs.length ? JSON.stringify(segs) : null, () => { void load(); void refresh(); });
      toast('Sending', { label: 'Undo', run: () => undo(key) }, UNDO_MS);
    }
    // clear one-shot overlays after a send
    if (s.strokes.length) { s.strokes = []; s.markDirty(); }
  };

  const beginRef = useRef(begin); beginRef.current = begin;

  const cancelRec = () => {
    clearInterval(tickRef.current);
    studio.current?.cancel(); captioner.current?.stop(); captioner.current = null;
    setPaused(false);
    setRecording(false); setCaption(''); toast('Discarded');
  };

  // ---- flip (also mid-recording, and by double-tapping the picture) ----
  const flipping = useRef(false);
  const flip = async () => {
    const s = studio.current; if (!s || flipping.current || camState !== 'on') return;
    if (!s.canFlipLive) { toast('Simple camera can flip before you record, not during.'); return; }
    flipping.current = true;
    const ok = await s.flip();
    flipping.current = false;
    if (!s.glOk) s.video.className = `raw-video ${s.facing === 'user' ? 'mirror' : ''}`;
    if (!ok) toast('Could not switch cameras');
    bump(x => x + 1);
  };
  const lastTap = useRef(0);

  // ---- draw ----
  const drawing = useRef(false);
  const ptOf = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    // the canvas is object-fit: cover inside the preview, so map through the cover crop
    const cw = canvasRef.current!.width, ch = canvasRef.current!.height;
    const scale = Math.max(r.width / cw, r.height / ch);
    const dw = cw * scale, dh = ch * scale;
    const x = (e.clientX - r.left - (r.width - dw) / 2) / dw, y = (e.clientY - r.top - (r.height - dh) / 2) / dh;
    return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))] as [number, number];
  };
  const swipe = useRef<{ x: number; y: number; t: number } | null>(null);
  const dragCtr = useRef(false);
  const fx = !isSimple() && !audioOnly;
  const onDown = (e: React.PointerEvent) => {
    const s = studio.current; if (!s) return;
    s.wake();
    if (!panel && !audioOnly) {
      const now = Date.now();
      if (now - lastTap.current < 320) { lastTap.current = 0; void flip(); return; }
      lastTap.current = now;
    }
    if (panel === 'draw') { drawing.current = true; (e.target as Element).setPointerCapture(e.pointerId); s.live = { color: ink, width: inkW, pts: [ptOf(e)] } as Stroke; s.markDirty(); }
    else if (panel === 'text' && text) { drawing.current = true; (e.target as Element).setPointerCapture(e.pointerId); setTextY(ptOf(e)[1]); }
    else if (fx && panel === 'looks' && lookOf(look).drag) { dragCtr.current = true; (e.target as Element).setPointerCapture(e.pointerId); s.ctr = ptOf(e); }
    else if (fx && (!panel || panel === 'looks' || panel === 'voice')) swipe.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  };
  const onMove = (e: React.PointerEvent) => {
    const s = studio.current; if (!s) return;
    if (dragCtr.current) { s.ctr = ptOf(e); return; }
    if (!drawing.current) return;
    if (panel === 'draw' && s.live) { s.live.pts.push(ptOf(e)); s.markDirty(); }
    else if (panel === 'text') setTextY(Math.min(0.92, Math.max(0.08, ptOf(e)[1])));
  };
  const onUp = (e?: React.PointerEvent) => {
    const s = studio.current; drawing.current = false; dragCtr.current = false;
    const sw = swipe.current; swipe.current = null;
    if (sw && e) {
      const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
      if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4 && Date.now() - sw.t < 800) { lastTap.current = 0; stepLook(dx < 0 ? 1 : -1); }
    }
    if (s?.live) { s.strokes.push(s.live); s.live = null; s.markDirty(); bump(x => x + 1); }
  };

  // ---- upload from camera roll ----
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) { toast('That video is over 50 MB. Trim it on your phone first.'); return; }
    try {
      const isAudio = f.type.startsWith('audio');
      const meta = isAudio ? { duration: 0, w: 0, h: 0, thumb: null } : await probeFile(f);
      const ext = (f.name.split('.').pop() || (isAudio ? 'm4a' : 'mp4')).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5);
      const key = sendRecording(chatId, me.id, { blob: f, mime: f.type || 'video/mp4', ext, duration: meta.duration, w: meta.w, h: meta.h, thumb: meta.thumb, kind: isAudio ? 'audio' : 'video', effects: { uploaded: true } }, null, () => { void load(); void refresh(); });
      toast('Sending your video', { label: 'Undo', run: () => undo(key) }, UNDO_MS);
    } catch (e) { toast((e as Error).message); }
  };

  const sendMsg = async () => {
    const b = msg.trim(); if (!b) return;
    setMsg(''); setTyping(false);
    try { await sendText(chatId, b); await load(); void refresh(); } catch (e) { toast((e as Error).message); setMsg(b); }
  };

  const openPlayer = (list: Polo[], start: number) => {
    if (recording) return;
    setPlayer({ list, start });
    setStatus(chatId, 'watching');
  };
  const closePlayer = () => { setPlayer(null); setStatus(chatId, 'here'); void load(); void refresh(); };

  const toggle = (p: Panel) => setPanel(cur => (cur === p ? null : p));

  if (err && !chat) return (
    <div className="center-screen"><p className="muted">{/not in this chat/.test(err) ? "You're not in this chat." : err}</p><button className="btn" onClick={() => go('/')}>Back home</button></div>
  );

  return (
    <div className="chat" style={{ ['--accent' as string]: theme }}>
      <div className="preview" ref={previewRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => onUp()}>
        <canvas ref={canvasRef} className={`cam ${audioOnly ? 'dim' : ''}`} />
        {camState === 'denied' && (
          <div className="cam-off">
            <Icon name="camera" size={40} />
            <p>Holler needs your camera and mic to record.</p>
            <button className="btn primary" onClick={() => void startCam()}>Turn on camera</button>
            <p className="fine">If you said no before, allow camera and mic for this site in your browser settings.</p>
          </div>
        )}
        {camState === 'off' && <div className="cam-off"><button className="btn primary" onClick={() => void startCam()}>Turn on camera</button></div>}
        {audioOnly && <div className="audio-mode"><Avatar p={me} size={120} /><div className="lvl" style={{ transform: `scale(${1 + level * 1.6})` }} /><p>Voice only</p></div>}
        {caption && recording && <div className="live-cap">{caption}</div>}
        {ring && !audioOnly && <div className="ring-light" />}
        {countdown > 0 && <div className="countdown" key={countdown}>{countdown}</div>}
        {recording && paused && <div className="paused-tag"><Icon name="pause" size={16} /> Paused</div>}
        {flash && <div className="look-flash" key={flash}>{flash}</div>}
        {lookOf(look).seg && cut === 'loading' && fx && <div className="cut-tag">Finding you<span className="dots"><i /><i /><i /></span></div>}
      </div>

      <header className="chat-top">
        <button className="icon-btn glass" onClick={() => go('/')} aria-label="Back"><Icon name="back" /></button>
        <button className="chat-title glass" onClick={() => setInfo(true)}>
          <span className="t">{chat ? chatTitle(chat, me.id) : ' '}</span>
          <span className="who">
            {others.map(o => <Avatar key={o.id} p={o} size={22} status={pres[o.id]} />)}
            {others.length === 0 && <span className="fine">Tap to invite people</span>}
          </span>
        </button>
        <button className="icon-btn glass" onClick={() => setInfo(true)} aria-label="Chat info"><Icon name="info" /></button>
      </header>

      {!others.some(o => pres[o.id] === 'recording') && others.filter(o => pres[o.id] === 'watching').slice(0, 1).map(o => (
        <div key={o.id} className="rec-banner watch"><Avatar p={o} size={26} /> <b>{o.name.split(' ')[0]}</b> is watching</div>
      ))}
      {others.filter(o => pres[o.id] === 'recording').map(o => (
        <div key={o.id} className="rec-banner"><Avatar p={o} size={26} /> <b>{o.name.split(' ')[0]}</b> is recording<span className="dots"><i /><i /><i /></span></div>
      ))}

      <aside className={`rail ${recording ? 'live' : ''}`}>
        {(!recording || (!audioOnly && studio.current?.canFlipLive)) && <button className="rail-btn" onClick={() => void flip()} aria-label="Flip camera"><Icon name="flip" /><span>Flip</span></button>}
        {recording && studio.current?.canPause && <button className={`rail-btn ${paused ? 'set' : ''}`} onClick={togglePause} aria-label={paused ? 'Keep recording' : 'Pause'}><Icon name={paused ? 'play' : 'pause'} fill={paused ? 'currentColor' : undefined} /><span>{paused ? 'Resume' : 'Pause'}</span></button>}
        {!isSimple() && <>
          {!(recording && audioOnly) && <button className={`rail-btn ${panel === 'looks' ? 'on' : ''} ${look !== 'none' ? 'set' : ''}`} onClick={() => toggle('looks')}><Icon name="wand" /><span>Looks</span></button>}
          <button className={`rail-btn ${panel === 'voice' ? 'on' : ''} ${voice !== 'none' ? 'set' : ''}`} onClick={() => toggle('voice')}><Icon name="mic" /><span>Voice</span></button>
          {!(recording && audioOnly) && <button className={`rail-btn ${panel === 'draw' ? 'on' : ''} ${studio.current?.strokes.length ? 'set' : ''}`} onClick={() => toggle('draw')}><Icon name="pen" /><span>Draw</span></button>}
          {!(recording && audioOnly) && <button className={`rail-btn ${panel === 'text' ? 'on' : ''} ${text ? 'set' : ''}`} onClick={() => toggle('text')}><Icon name="text" /><span>Text</span></button>}
        </>}
        {!recording && <button className={`rail-btn ${hd ? 'set' : ''}`} onClick={async () => { const v = !hd; setHd(v); await studio.current?.setHD(v); void api.updateMe({ prefs: { hd: v } }); toast(v ? 'HD on: sharper, bigger files' : 'HD off'); }}><Icon name="hd" /><span>{hd ? 'HD' : 'SD'}</span></button>}
        {!recording && <button className={`rail-btn ${timer ? 'set' : ''}`} onClick={() => { const v = timer === 0 ? 3 : timer === 3 ? 10 : 0; setTimer(v); keep('holler.timer', String(v)); toast(v ? `${v} second timer: prop your phone up, tap record, step back` : 'Timer off'); }}><Icon name="timer" /><span>{timer ? `${timer}s` : 'Timer'}</span></button>}
        {!(recording && audioOnly) && <button className={`rail-btn ${ring ? 'set' : ''}`} onClick={() => { const v = !ring; setRing(v); keep('holler.ring', v ? '1' : '0'); if (v && !recording) toast('Light on. Turn your screen brightness up for the most glow.'); }}><Icon name="light" /><span>Light</span></button>}
        {!recording && <button className={`rail-btn ${audioOnly ? 'set' : ''}`} onClick={() => setAudioOnly(a => !a)}><Icon name="wave" /><span>Voice only</span></button>}
        {!recording && <button className="rail-btn" onClick={() => fileRef.current?.click()}><Icon name="upload" /><span>Upload</span></button>}
        <input ref={fileRef} type="file" accept="video/*,audio/*" hidden onChange={e => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
      </aside>

      <div className="bottom">
        {panel === 'looks' && (
          <div className="looks-panel">
            <div className="kind-tabs">
              {KINDS.map(k => <button key={k.id} className={`ktab ${kind === k.id ? 'on' : ''}`} onClick={() => setKind(k.id)}>{k.label}</button>)}
            </div>
            <div className="chips">
              {LOOKS.filter(l => l.kind === kind).map(l => <button key={l.id} className={`chip ${look === l.id ? 'on' : ''}`} onClick={() => chooseLook(l.id)}>{l.label}{l.voice ? <Icon name="mic" size={12} className="chip-ic" /> : null}</button>)}
            </div>
            {look !== 'none' && (
              <label className="amt-row"><span>Less</span>
                <input type="range" min={0} max={1} step={0.01} value={amt} onChange={e => setAmt(Number(e.target.value))} aria-label="Strength" />
                <span>More</span></label>
            )}
            <div className="chip-note">{lookOf(look).kind === kind && lookOf(look).drag ? 'Drag on the picture to move it.' : KINDS.find(k => k.id === kind)?.note} {recording ? '' : 'Swipe across the picture to try the next one, even while recording.'}</div>
          </div>
        )}
        {panel === 'voice' && (
          <div className="chips">
            {VOICES.map(v => <button key={v.id} className={`chip ${voice === v.id ? 'on' : ''}`} onClick={() => { setVoice(v.id); void api.updateMe({ prefs: { voice: v.id } }); }}>{v.label}</button>)}
            <span className="chip-note">{recording ? 'Switch any time. It changes from this moment on.' : 'Your voice changes in the recording. You can switch mid-video too.'}</span>
          </div>
        )}
        {panel === 'draw' && (
          <div className="tools">
            <div className="inks">{INK.map(c => <button key={c} className={`ink ${c === ink ? 'on' : ''}`} style={{ background: c }} onClick={() => setInk(c)} aria-label="Ink color" />)}</div>
            <div className="row gap">
              {[6, 10, 18].map(w => <button key={w} className={`wbtn ${inkW === w ? 'on' : ''}`} onClick={() => setInkW(w)} aria-label={`Brush ${w}`}><i style={{ width: w, height: w }} /></button>)}
              <button className="chip" onClick={() => { const s = studio.current; if (s) { s.strokes.pop(); s.markDirty(); bump(x => x + 1); } }}><Icon name="undo" size={16} /> Undo</button>
              <button className="chip" onClick={() => { const s = studio.current; if (s) { s.strokes = []; s.markDirty(); bump(x => x + 1); } }}>Clear</button>
              <button className="chip on" onClick={() => setPanel(null)}>Done</button>
            </div>
            <div className="chip-note">Draw on the screen. It's part of your video, even while you record.</div>
          </div>
        )}
        {panel === 'text' && (
          <div className="tools">
            <input className="field" autoFocus maxLength={140} placeholder="Say it in words too" value={text} onChange={e => setText(e.target.value)} />
            <div className="row gap wrap">
              {(['pill', 'bold', 'type'] as const).map(s => <button key={s} className={`chip ${textStyle === s ? 'on' : ''}`} onClick={() => setTextStyle(s)}>{s === 'pill' ? 'Label' : s === 'bold' ? 'Big' : 'Typewriter'}</button>)}
              {INK.slice(0, 7).map(c => <button key={c} className={`ink sm ${c === textColor ? 'on' : ''}`} style={{ background: c }} onClick={() => setTextColor(c)} aria-label="Text color" />)}
              {text && <button className="chip" onClick={() => setText('')}>Remove</button>}
              <button className="chip on" onClick={() => setPanel(null)}>Done</button>
            </div>
            <div className="chip-note">Drag on the screen to move it.</div>
          </div>
        )}

        {unread.length > 0 && !recording && !panel && (
          <button className="new-pill" onClick={() => openPlayer(polos, polos.indexOf(unread[0]))}>
            <Icon name="play" size={16} fill="currentColor" /> Watch {unread.length} new
          </button>
        )}

        {!panel && (
          <div className="strip" ref={stripRef}>
            {polos.length === 0 && pend.length === 0 && <div className="strip-empty">{others.length ? 'No hollers yet. Say hi.' : 'Invite your people, then say hi.'}</div>}
            {polos.map((p, i) => {
              const author = chat!.members.find(m => m.id === p.author);
              const seen = p.author === me.id || p.views.some(v => v.who === me.id);
              return (
                <button key={p.id} className={`tile ${seen ? '' : 'new'}`} style={{ ['--c' as string]: author?.color || '#888' }} onClick={() => openPlayer(polos, i)}>
                  {p.kind === 'video' && p.thumb ? <img src={publicUrl(p.thumb)} alt="" loading="lazy" />
                    : p.kind === 'text' ? <span className="tile-text">{p.body}</span>
                    : <span className="tile-audio"><Avatar p={author} size={34} /><Icon name="wave" size={16} /></span>}
                  <span className="tile-av"><Avatar p={author} size={20} /></span>
                  {p.duration ? <span className="tile-dur">{clock(p.duration)}</span> : null}
                  {p.savedBy.includes(me.id) && <span className="tile-star"><Icon name="star" size={12} fill="currentColor" /></span>}
                  {p.author === me.id && others.length > 0 && (() => {
                    const seenBy = others.filter(o => p.views.some(v => v.who === o.id));
                    return seenBy.length
                      ? <span className={`tile-seen ${seenBy.length === others.length ? 'all' : ''}`} title={`Seen by ${seenBy.map(o => o.name.split(' ')[0]).join(', ')}`}>{seenBy.slice(0, 3).map(o => <Avatar key={o.id} p={o} size={16} />)}</span>
                      : <span className="tile-seen none" title="Not watched yet"><Icon name="check" size={12} stroke={3} /></span>;
                  })()}
                </button>
              );
            })}
            {pend.map(o => (
              <div key={o.key} className={`tile pending ${o.error ? 'failed' : ''}`} style={{ ['--c' as string]: me.color }}>
                {o.polo.pending?.thumbUrl ? <img src={o.polo.pending.thumbUrl} alt="" /> : <span className="tile-audio"><Icon name="wave" /></span>}
                {o.error ? (
                  <span className="tile-fail">
                    <button onClick={() => retry(o.key)}>Retry</button>
                    <button onClick={() => discard(o.key)}>Delete</button>
                  </span>
                ) : <span className="tile-prog"><i style={{ width: `${Math.round(o.progress * 100)}%` }} /></span>}
              </div>
            ))}
          </div>
        )}

        <div className="rec-row">
          {recording ? (
            <button className="side-btn" onClick={cancelRec} aria-label="Discard recording"><Icon name="trash" /></button>
          ) : (
            <button className="side-btn" onClick={() => setTyping(true)} aria-label="Send a text"><Icon name="keyboard" /></button>
          )}
          <button className={`rec ${recording ? 'on' : ''} ${audioOnly ? 'audio' : ''} ${paused ? 'is-paused' : ''} ${countdown ? 'counting' : ''}`}
            onPointerDown={onRecDown} onPointerUp={() => void onRecUp()} onPointerCancel={() => { pressAt.current = 0; }} onContextMenu={e => e.preventDefault()}
            onClick={e => { if (e.detail === 0) { if (recording) void finish(); else void begin(); } }}
            aria-label={recording ? 'Stop and send' : countdown ? 'Cancel timer' : 'Record'}>
            <svg viewBox="0 0 100 100" className="rec-ring">
              <circle cx="50" cy="50" r="46" />
              {recording && <circle cx="50" cy="50" r="46" className="prog" style={{ strokeDashoffset: 289 - (289 * elapsed) / maxSec }} />}
            </svg>
            <span className="rec-core" style={recording ? { transform: `scale(${paused ? 0.55 : 0.55 + level * 0.25})` } : undefined} />
          </button>
          {recording ? <div className="timer">{clock(elapsed)}</div> : <div className="side-btn ghost" />}
        </div>
        {recording && <div className="rec-hint">{held ? 'Let go to send' : paused ? 'Paused. Tap Resume to keep going, or tap to send.' : 'Tap to send'}</div>}
        {countdown > 0 && <div className="rec-hint">Tap to call it off</div>}
      </div>

      {review && (
        <div className="review">
          {review.rec.kind === 'video'
            ? <video src={review.url} autoPlay loop playsInline className="p-video" />
            : <div className="p-audio" style={{ ['--c' as string]: me.color }}><div className="p-audio-ring"><Avatar p={me} size={140} /></div><audio src={review.url} autoPlay loop /></div>}
          <div className="review-bar">
            <button className="btn" onClick={() => { URL.revokeObjectURL(review.url); setReview(null); }}><Icon name="undo" size={18} /> Retake</button>
            <button className="btn primary" onClick={() => {
              sendRecording(chatId, me.id, review.rec, review.segs.length ? JSON.stringify(review.segs) : null, () => { void load(); void refresh(); });
              setReview(null); toast('Sent');
            }}><Icon name="send" size={18} /> Send</button>
          </div>
        </div>
      )}
      {player && chat && (
        <Player chat={chat} list={player.list} start={player.start} me={me} onClose={closePlayer} onChanged={() => void load()} />
      )}
      {chat && <ChatInfo open={info} onClose={() => setInfo(false)} chat={chat} onChanged={() => { void load(); void refresh(); }} />}
      <Sheet open={typing} onClose={() => setTyping(false)} title="Send a note">
        <textarea className="field area" autoFocus maxLength={2000} rows={4} placeholder="Type something quick" value={msg} onChange={e => setMsg(e.target.value)} />
        <button className="btn primary wide" disabled={!msg.trim()} onClick={() => void sendMsg()}><Icon name="send" size={18} /> Send</button>
      </Sheet>
    </div>
  );
}
