import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../App';
import { api, publicUrl, type ChatFull, type Polo } from '../lib/api';
import { onLive, onPresence, onReconnect, presenceOf, send as liveSend, setStatus } from '../lib/live';
import { onOutbox, outgoing, retry, discard, sendRecording, sendText, undo, UNDO_MS } from '../lib/outbox';
import { LOOKS, Studio, probeFile, type LookId, type Recording, type Stroke } from '../lib/studio';
import { VOICES, type VoiceId } from '../lib/voice';
import { Captioner, isIOS, speechSupported, type Seg } from '../lib/speech';
import { recStart, recStop } from '../lib/sound';
import { Avatar, Sheet, THEMES, chatTitle, clock, toast } from './bits';
import { Icon } from './icons';
import { isSimple, setSimple } from '../lib/device';
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

  const load = useCallback(async () => {
    try { const c = await api.chat(chatId); setChat(c); setErr(''); }
    catch (e) { setErr((e as Error).message); }
  }, [chatId]);

  useEffect(() => { void load(); }, [load]);
  // the invite sheet opens once after making a chat; drop it from the address so a reload doesn't reopen it
  useEffect(() => { if (route[2] === 'invite') history.replaceState(null, '', `${location.pathname}#/c/${chatId}`); }, [route, chatId]);
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
      const s = studio.current; s.look = look; s.voice = voice; s.simple = isSimple();
      await s.open({ hd });
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

  useEffect(() => { if (studio.current) { studio.current.look = look; } }, [look]);
  useEffect(() => { if (studio.current) { studio.current.voice = voice; } }, [voice]);
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
  const begin = async () => {
    const s = studio.current;
    if (!s || camState !== 'on') { void startCam(); return; }
    setPanel(p => (p === 'draw' || p === 'text' ? p : null));
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
    setRecording(false); setLevel(0); setCaption('');
    const segs = captioner.current?.stop() || []; captioner.current = null;
    if (!rec) return;
    if (rec.duration < 0.8) { toast('Too short. Tap once to start, tap again to send.'); return; }
    if (prefs.review) { setReview({ rec, segs, url: URL.createObjectURL(rec.blob) }); }
    else {
      const key = sendRecording(chatId, me.id, rec, segs.length ? JSON.stringify(segs) : null, () => { void load(); void refresh(); });
      toast('Sending', { label: 'Undo', run: () => undo(key) }, UNDO_MS);
    }
    // clear one-shot overlays after a send
    if (s.strokes.length) { s.strokes = []; s.markDirty(); }
  };

  const cancelRec = () => {
    clearInterval(tickRef.current);
    studio.current?.cancel(); captioner.current?.stop(); captioner.current = null;
    setRecording(false); setCaption(''); toast('Discarded');
  };

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
  const onDown = (e: React.PointerEvent) => {
    const s = studio.current; if (!s) return;
    if (panel === 'draw') { drawing.current = true; (e.target as Element).setPointerCapture(e.pointerId); s.live = { color: ink, width: inkW, pts: [ptOf(e)] } as Stroke; s.markDirty(); }
    else if (panel === 'text' && text) { drawing.current = true; (e.target as Element).setPointerCapture(e.pointerId); setTextY(ptOf(e)[1]); }
  };
  const onMove = (e: React.PointerEvent) => {
    const s = studio.current; if (!s || !drawing.current) return;
    if (panel === 'draw' && s.live) { s.live.pts.push(ptOf(e)); s.markDirty(); }
    else if (panel === 'text') setTextY(Math.min(0.92, Math.max(0.08, ptOf(e)[1])));
  };
  const onUp = () => {
    const s = studio.current; drawing.current = false;
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
      <div className="preview" ref={previewRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
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

      {others.filter(o => pres[o.id] === 'recording').map(o => (
        <div key={o.id} className="rec-banner"><Avatar p={o} size={26} /> <b>{o.name.split(' ')[0]}</b> is recording<span className="dots"><i /><i /><i /></span></div>
      ))}

      {!recording && (
        <aside className="rail">
          <button className="rail-btn" onClick={() => void studio.current?.flip()} aria-label="Flip camera"><Icon name="flip" /><span>Flip</span></button>
          {!isSimple() && <>
          <button className={`rail-btn ${panel === 'looks' ? 'on' : ''} ${look !== 'none' ? 'set' : ''}`} onClick={() => toggle('looks')}><Icon name="wand" /><span>Looks</span></button>
          <button className={`rail-btn ${panel === 'voice' ? 'on' : ''} ${voice !== 'none' ? 'set' : ''}`} onClick={() => toggle('voice')}><Icon name="mic" /><span>Voice</span></button>
          <button className={`rail-btn ${panel === 'draw' ? 'on' : ''} ${studio.current?.strokes.length ? 'set' : ''}`} onClick={() => toggle('draw')}><Icon name="pen" /><span>Draw</span></button>
          <button className={`rail-btn ${panel === 'text' ? 'on' : ''} ${text ? 'set' : ''}`} onClick={() => toggle('text')}><Icon name="text" /><span>Text</span></button>
          </>}
          <button className={`rail-btn ${hd ? 'set' : ''}`} onClick={async () => { const v = !hd; setHd(v); await studio.current?.setHD(v); void api.updateMe({ prefs: { hd: v } }); toast(v ? 'HD on: sharper, bigger files' : 'HD off'); }}><Icon name="hd" /><span>{hd ? 'HD' : 'SD'}</span></button>
          <button className={`rail-btn ${audioOnly ? 'set' : ''}`} onClick={() => setAudioOnly(a => !a)}><Icon name="wave" /><span>Voice only</span></button>
          <button className="rail-btn" onClick={() => fileRef.current?.click()}><Icon name="upload" /><span>Upload</span></button>
          <input ref={fileRef} type="file" accept="video/*,audio/*" hidden onChange={e => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
        </aside>
      )}

      <div className="bottom">
        {panel === 'looks' && !recording && (
          <div className="chips">
            {LOOKS.map(l => <button key={l.id} className={`chip ${look === l.id ? 'on' : ''}`} onClick={() => { setLook(l.id); void api.updateMe({ prefs: { look: l.id } }); }}>{l.label}</button>)}
          </div>
        )}
        {panel === 'voice' && !recording && (
          <div className="chips">
            {VOICES.map(v => <button key={v.id} className={`chip ${voice === v.id ? 'on' : ''}`} onClick={() => { setVoice(v.id); void api.updateMe({ prefs: { voice: v.id } }); }}>{v.label}</button>)}
            <span className="chip-note">Your voice changes in the recording.</span>
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
          <button className={`rec ${recording ? 'on' : ''} ${audioOnly ? 'audio' : ''}`} onClick={() => (recording ? void finish() : void begin())} aria-label={recording ? 'Stop and send' : 'Record'}>
            <svg viewBox="0 0 100 100" className="rec-ring">
              <circle cx="50" cy="50" r="46" />
              {recording && <circle cx="50" cy="50" r="46" className="prog" style={{ strokeDashoffset: 289 - (289 * elapsed) / maxSec }} />}
            </svg>
            <span className="rec-core" style={recording ? { transform: `scale(${0.55 + level * 0.25})` } : undefined} />
          </button>
          {recording ? <div className="timer">{clock(elapsed)}</div> : <div className="side-btn ghost" />}
        </div>
        {recording && <div className="rec-hint">Tap to send</div>}
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
