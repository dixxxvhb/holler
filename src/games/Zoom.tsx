// Zoom In: everyone films something for 5 seconds, then pinches to pick where the others start (how close, and on
// what). Everyone else watches it start there and pull out to the whole picture over 20 seconds. Tap I know it, type
// a guess, then see what it was and say whether you got it. A phone with no camera joins as a guesser.
// Rules live in supabase/games7.sql and games8.sql (where it starts).
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, mediaUrl, publicUrl, type ChatFull, type Game, type Person, type ZoomFocus, type ZoomGuess, type ZoomShot } from '../lib/api';
import { send as liveSend } from '../lib/live';
import { Avatar, Sheet, ago, toast } from '../ui/bits';
import { Icon } from '../ui/icons';
import { first, personIn, standings } from './roundLogic';
import './games.css';

const PULL_MS = 20000;
/** A clip from before the filmer could pick: 8x on the middle. */
const OLD_START: ZoomFocus = { x: 0.5, y: 0.5, z: 8 };
export const PICK_MIN = 2, PICK_MAX = 10, PICK_START = 6;
const hours6 = (iso: string | null | undefined) => !!iso && Date.now() - new Date(iso).getTime() < 6 * 3600e3;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
/** How big the picture is at a point in the pull-out (0 = all the way in), from the start zoom down to 1x.
 *  Exponential, so it feels steady. */
export const zoomScale = (p: number, z = OLD_START.z) => Math.pow(z, 1 - clamp(p, 0, 1));
/** Keep a zoomed view inside the frame: its middle can't sit closer to an edge than half the view. */
export const clampFocus = (x: number, y: number, z: number): ZoomFocus => {
  const h = 0.5 / z; return { x: clamp(x, h, 1 - h), y: clamp(y, h, 1 - h), z };
};
/** Scaling the picture by z about this point puts the focus in the middle of the view. Kept fixed while z eases to 1,
 *  the view slides out to the whole frame and never shows past an edge (the point is always inside the frame). */
export const originOf = (f: ZoomFocus) => (f.z <= 1.001 ? { ox: 0.5, oy: 0.5 }
  : { ox: clamp((f.x * f.z - 0.5) / (f.z - 1), 0, 1), oy: clamp((f.y * f.z - 0.5) / (f.z - 1), 0, 1) });
export const focusOf = (s: ZoomShot): ZoomFocus => (s.focus && typeof s.focus.z === 'number' ? s.focus : OLD_START);
const xLabel = (z: number) => `${Math.round(z * 10) / 10}x`;
/** Got it before a third of the pull-out: 3. Before two thirds: 2. After: 1. Didn't get it: 0. */
export const zoomPoints = (g?: ZoomGuess | null) => (!g || g.got !== true ? 0 : g.at < 1 / 3 ? 3 : g.at < 2 / 3 ? 2 : 1);

export function zoomScores(g: Game): Record<string, number> {
  const s: Record<string, number> = Object.fromEntries(g.order.map(id => [id, 0]));
  for (const sh of g.shots || []) for (const [who, r] of Object.entries(sh.guesses || {})) s[who] = (s[who] || 0) + zoomPoints(r);
  return s;
}

/** The clip fewest people got (ties: the one people needed longest on). */
function hardest(g: Game): { shot: ZoomShot; got: number; of: number } | null {
  const rows = (g.shots || []).map(shot => {
    const rs = Object.values(shot.guesses || {}).filter(r => r.got != null);
    const got = rs.filter(r => r.got);
    return { shot, got: got.length, of: rs.length, late: got.length ? got.reduce((n, r) => n + r.at, 0) / got.length : 2 };
  }).filter(r => r.of > 0);
  if (rows.length < 2) return null;
  rows.sort((a, b) => a.got / a.of - b.got / b.of || b.late - a.late);
  return rows[0];
}

// ---------------------------------------------------------------- start
export function ZoomStart({ open, onClose, chat, me, canFilm, onStarted }: {
  open: boolean; onClose: () => void; chat: ChatFull; me: Person; canFilm: boolean; onStarted: (g: Game) => void;
}) {
  const others = useMemo(() => chat.members.filter(m => m.id !== me.id), [chat.members, me.id]);
  const [who, setWho] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setWho(others.slice(0, 5).map(o => o.id)); }, [open, others]);
  const toggle = (id: string) => setWho(o => (o.includes(id) ? o.filter(x => x !== id) : o.length >= 5 ? o : [...o, id]));
  const line = [me.id, ...who];
  const start = async () => {
    setBusy(true);
    try { const g = await api.gameStart2(chat.id, 'zoom', line, {}); liveSend(chat.id, 'chat', { game: g.id }); onStarted(g); }
    catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Zoom In">
      <p className="g-sub">Everyone films something for 5 seconds. The others see it way zoomed in, slowly pulling out. Name it before it gets obvious. Sooner scores more.</p>
      <span className="lbl">Playing</span>
      <div className="g-order-tools">
        <span className="chip on g-me-chip"><Avatar p={me} size={18} /> You</span>
        {others.map(o => <button key={o.id} className={`chip ${who.includes(o.id) ? 'on' : ''}`} onClick={() => toggle(o.id)}><Avatar p={o} size={18} /> {first(o)}</button>)}
      </div>
      {line.length < 2 && <p className="g-warn">Pick at least 1 person to play with.</p>}
      <p className="g-fine">{canFilm ? 'No camera on a phone? That person can still play as a guesser.' : 'No camera on this phone, so you\'ll play as a guesser.'}</p>
      <button className="btn g-go wide" disabled={busy || line.length < 2} onClick={() => void start()}>Start</button>
    </Sheet>
  );
}

// ---------------------------------------------------------------- over the camera while you film
export function ZoomLive({ word }: { word: string | null; recording?: boolean }) {
  return (<>
    <div className="g-banner"><Icon name="camera" size={24} /><span><b>Film it</b>
      <em>Next you pick how close they start.</em></span></div>
    {word && <div className="g-secret-mini"><small>Only you see this</small><p>{word}</p></div>}
  </>);
}

// ---------------------------------------------------------------- after the take: pick where they start
// The take loops at its own shape. Pinch (or the slider) for how close, drag for where. It starts on the middle of what
// you saw while filming (x0, y0, worked out by the recorder), not the middle of the whole frame.
export function ZoomPick({ url, x0, y0, onSend, onRetake }: {
  url: string; x0: number; y0: number; onSend: (f: ZoomFocus) => void; onRetake: () => void;
}) {
  const [f, setF] = useState<ZoomFocus>(() => clampFocus(x0, y0, PICK_START));
  const [ar, setAr] = useState(9 / 16);
  const [room, setRoom] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const vid = useRef<HTMLVideoElement>(null);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const fRef = useRef(f); fRef.current = f;
  useEffect(() => {
    const on = () => setRoom({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on); return () => window.removeEventListener('resize', on);
  }, []);
  useEffect(() => { const v = vid.current; if (!v) return; v.muted = true; v.src = url; void v.play().catch(() => {}); }, [url]);
  // the clip's own shape, as wide as the screen, leaving room for the line and the buttons
  const fw = Math.min(room.w, Math.max(200, room.h - 330) * ar), fh = fw / ar;
  const set = (x: number, y: number, z: number) => setF(clampFocus(x, y, clamp(z, PICK_MIN, PICK_MAX)));
  const down = (e: React.PointerEvent) => { e.currentTarget.setPointerCapture(e.pointerId); pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); };
  const move = (e: React.PointerEvent) => {
    const m = pts.current; const prev = m.get(e.pointerId); if (!prev) return;
    const c = fRef.current;
    if (m.size === 1) set(c.x - (e.clientX - prev.x) / (fw * c.z), c.y - (e.clientY - prev.y) / (fh * c.z), c.z);
    else {
      // two fingers: the spread sets how close, and their middle (half of this finger's move) drags
      const o = [...m.entries()].find(([id]) => id !== e.pointerId)?.[1];
      if (o) {
        const d0 = Math.hypot(prev.x - o.x, prev.y - o.y), d1 = Math.hypot(e.clientX - o.x, e.clientY - o.y);
        set(c.x - (e.clientX - prev.x) / 2 / (fw * c.z), c.y - (e.clientY - prev.y) / 2 / (fh * c.z), d0 > 12 ? c.z * (d1 / d0) : c.z);
      }
    }
    m.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const up = (e: React.PointerEvent) => { pts.current.delete(e.pointerId); };
  const { ox, oy } = originOf(f);
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return (
    <div className="g-reveal z-pick">
      <div className="g-rv-top">
        <span className="g-rv-ic"><Icon name="camera" size={22} /></span>
        <span className="g-rv-who"><b>Pick where they start</b><span>Pinch to zoom, drag to move</span></span>
      </div>
      <div className="z-pick-mid">
        <div className="z-pick-frame" style={{ width: fw, height: fh }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <div className="z-wrap" style={{ transformOrigin: `${ox * 100}% ${oy * 100}%`, transform: `scale(${f.z})` }}>
            <video ref={vid} playsInline muted loop className="z-vid"
              onLoadedMetadata={e => { const v = e.currentTarget; if (v.videoWidth && v.videoHeight) setAr(v.videoWidth / v.videoHeight); }} />
          </div>
          <span className="z-pick-x">{xLabel(f.z)}</span>
        </div>
      </div>
      <div className="z-pick-bar">
        <b>They start here, then it pulls out.</b>
        <span className="z-slide">
          <em>Wider</em>
          <input id="z-zoom" type="range" min={PICK_MIN} max={PICK_MAX} step={0.1} value={f.z} aria-label="How close they start"
            onChange={e => set(f.x, f.y, Number(e.target.value))} />
          <em>Closer</em>
        </span>
        <span className="g-row-btns">
          <button className="btn" onClick={onRetake}>Retake</button>
          <button className="btn g-go" onClick={() => onSend({ x: r3(f.x), y: r3(f.y), z: Math.round(f.z * 100) / 100 })}><Icon name="send" size={18} /> Send it</button>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the game page
export function ZoomPage({ game, chat, me, canFilm, onClose, onFilm, onCamera, onChanged }: {
  game: Game; chat: ChatFull; me: Person; canFilm: boolean; onClose: () => void; onFilm: (g: Game, word: string) => void;
  onCamera: () => void; onChanged: (g: Game) => void;
}) {
  const person = personIn(chat, me);
  const playing = game.status === 'playing';
  const shots = game.shots || [];
  const [open, setOpen] = useState<ZoomShot | null>(null);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api.game(game.id).then(onChanged).catch(() => {}); }, [game.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (f: () => Promise<Game>, done?: string) => {
    setBusy(true);
    try { const g = await f(); onChanged(g); liveSend(chat.id, 'chat', { game: g.id }); if (done) toast(done); } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  const inGame = game.order.includes(me.id);
  const mineIn = (game.filmed || []).includes(me.id) || (game.skipped || []).includes(me.id);
  const needFilm = playing && inGame && !mineIn;
  const scores = zoomScores(game);
  const board = standings(scores);
  const allTied = board.length > 1 && board.every(r => r.place === 1);
  const hard = !playing ? hardest(game) : null;
  const waiting = (game.todo || []).filter(id => id !== me.id);
  const live = open ? shots.find(s => s.who === open.who) || open : null;
  if (live) return <ZoomGuessScreen shot={live} game={game} chat={chat} me={me} onClose={() => setOpen(null)} onChanged={onChanged} />;
  const film = () => { const w = word.trim(); if (!w) return; onFilm(game, w); };
  return (
    <div className="g-page">
      <header className="g-head">
        <button className="icon-btn g-back" onClick={onClose} aria-label="Back"><Icon name="back" /></button>
        <h2>Zoom In</h2>
      </header>
      <p className="g-meta">Started by {game.createdBy === me.id ? 'you' : first(person(game.createdBy || ''))}, {ago(game.createdAt)}. 5 second clips, 20 seconds to pull out.</p>
      {needFilm && canFilm && (
        <form className="g-secret z-film" onSubmit={e => { e.preventDefault(); film(); }}>
          <small>Only you see this</small>
          <p>What are you filming?</p>
          <input id="z-word" className="field big" maxLength={40} value={word} onChange={e => setWord(e.target.value)} placeholder="the cat's ear" autoComplete="off" />
          <span className="z-film-note">Something you can film up close. Hold it in the middle with the whole thing in frame.</span>
          <span className="g-row-btns">
            <button type="button" className="btn" disabled={busy} onClick={() => void act(() => api.zoomMove(game.id, { skip: true }), 'You\'re guessing this one')}>Just guess</button>
            <button type="submit" className="btn g-go" disabled={!word.trim()}><Icon name="camera" size={18} /> Film it</button>
          </span>
        </form>
      )}
      {needFilm && !canFilm && (
        <div className="q-ready">
          <Icon name="camera" size={28} />
          <b>No camera on this phone</b>
          <span>You can still play. Guess everyone else's as they come in.</span>
          <button className="btn g-go wide" disabled={busy} onClick={() => void act(() => api.zoomMove(game.id, { skip: true }), 'You\'re in as a guesser')}>Join as a guesser</button>
          <button className="link-btn" onClick={onCamera}>Turn the camera on instead</button>
        </div>
      )}
      <ol className="g-track">
        {shots.map(s => {
          const p = person(s.who); const own = s.who === me.id;
          const rs = Object.entries(s.guesses || {});
          const done = rs.filter(([, r]) => r.got != null);
          const todo = playing && !own && inGame && s.mine?.got == null;
          const sub = own ? (done.length ? `${done.filter(([, r]) => r.got).length} of ${done.length} got it` : 'Nobody has guessed yet')
            : s.mine?.got != null ? (s.mine.got ? `You got it. +${zoomPoints(s.mine)}` : 'Stumped you')
            : s.mine ? 'Say if you got it' : !playing ? 'You did not guess this one' : 'What is it?';
          return (
            <li key={s.who} className={`g-row z-row ${todo ? 'up' : ''}`}>
              <button className="g-thumb" disabled={!s.clip} onClick={() => setOpen(s)} aria-label={`${first(p)}'s clip`}>
                {s.clip?.thumb ? <img src={publicUrl(s.clip.thumb)} alt="" /> : <span className="g-thumb-blank" />}
                <span className="g-thumb-av"><Avatar p={p} size={18} /></span>
              </button>
              <span className="g-row-txt">
                <b>{own ? 'Yours' : `${first(p)}'s`}{s.answer ? <>: <em className="z-ans">{s.answer}</em></> : null}</b>
                <span>{sub}</span>
                {rs.length > 0 && (
                  <span className="z-guesses">{rs.map(([who, r]) => (
                    <span key={who} className={`z-g ${r.got ? 'got' : r.got === false ? 'miss' : ''}`}>
                      <Avatar p={person(who)} size={18} /><b>{who === me.id ? 'You' : first(person(who))}:</b> {r.text}
                      {r.got && <Icon name="check" size={13} stroke={3} />}
                    </span>
                  ))}</span>
                )}
              </span>
              {todo && s.clip && <button className="btn g-go g-row-btn" onClick={() => setOpen(s)}>{s.mine ? 'Finish' : 'Guess'}</button>}
              {!todo && s.clip && <button className="btn g-row-btn" onClick={() => setOpen(s)}>Watch</button>}
            </li>
          );
        })}
        {game.order.filter(id => !(game.filmed || []).includes(id)).map(id => (
          <li key={id} className="g-row">
            <Avatar p={person(id)} size={38} />
            <span className="g-row-txt"><b>{id === me.id ? 'You' : first(person(id))}</b>
              <span>{(game.skipped || []).includes(id) ? 'Just guessing' : playing ? 'Hasn\'t filmed yet' : 'Did not film'}</span></span>
          </li>
        ))}
      </ol>
      {!playing && hard && (
        <div className="g-box truth z-hard">
          <small><Avatar p={person(hard.shot.who)} size={18} /> The hardest one, {hard.shot.who === me.id ? 'yours' : `${first(person(hard.shot.who))}'s`}</small>
          <p>{hard.shot.answer}</p>
          <span>{hard.got === 0 ? `Nobody got it. ${hard.of === 1 ? 'One guess' : `${hard.of} guesses`}, all wrong.` : `Only ${hard.got} of ${hard.of} got it.`}</span>
        </div>
      )}
      {!playing && board.length > 0 && (
        <div className="g-board">
          <span className="lbl">{allTied ? 'Final scores: a tie' : 'Final scores'}</span>
          {board.map(r => (
            <div key={r.id} className={`g-board-row ${r.place === 1 && r.pts > 0 && !allTied ? 'top' : ''}`}>
              <i>{r.place}</i><Avatar p={person(r.id)} size={30} /><b>{r.id === me.id ? 'You' : first(person(r.id))}</b><em>{r.pts}</em>
            </div>
          ))}
          <p className="g-fine">Got it in the first third of the pull-out: 3. The middle third: 2. After that: 1.</p>
        </div>
      )}
      {playing && waiting.length > 0 && inGame && (
        <button className="btn wide" disabled={hours6(game.nudgedAt)} onClick={() => void act(() => api.gameNudge(game.id), 'Nudged')}>
          {hours6(game.nudgedAt) ? `Nudged ${ago(game.nudgedAt!)}` : `Nudge ${waiting.length === 1 ? first(person(waiting[0])) : 'everyone still playing'}`}
        </button>
      )}
      {!playing && !game.hidden && shots.length > 0 && (
        <button className={`btn wide ${game.savedAt ? '' : 'g-go'}`} onClick={() => void act(() => api.gameSave(game.id, !game.savedAt), game.savedAt ? 'Not saved' : 'Saved')}>
          <Icon name="star" size={18} fill={game.savedAt ? 'currentColor' : undefined} /> {game.savedAt ? 'Saved' : 'Save these clips'}
        </button>
      )}
      <p className="g-foot">{playing ? 'You see what a clip was, and everyone\'s guesses for it, once you\'ve guessed it yourself. Anyone who waits 2 days gets passed by.'
        : game.savedAt ? 'Saved. A week after the game these clips get 3 days on the leaving list, so you can save them to your camera roll.' : 'Clips hide a week after the game unless someone saves them.'}</p>
      {playing && game.createdBy === me.id && <button className="link-btn g-endgame" onClick={() => void act(() => api.gameEnd(game.id), 'Game ended')}>End this game</button>}
    </div>
  );
}

// ---------------------------------------------------------------- guess one: the pull-out, the guess, the reveal
function ZoomGuessScreen({ shot, game, chat, me, onClose, onChanged }: {
  shot: ZoomShot; game: Game; chat: ChatFull; me: Person; onClose: () => void; onChanged: (g: Game) => void;
}) {
  const person = personIn(chat, me);
  const own = shot.who === me.id;
  const canGuess = game.status === 'playing' && !own && game.order.includes(me.id) && !shot.mine;
  const vid = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [stage, setStage] = useState<'ready' | 'zoom' | 'type' | 'reveal'>(canGuess ? 'ready' : 'reveal');
  const [p, setP] = useState(canGuess ? 0 : 1);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [needTap, setNeedTap] = useState(false);
  const raf = useRef(0);
  const t0 = useRef(0);
  const frame = useRef<HTMLDivElement>(null);
  // the picture at its cover size, so the focus (in the video's own frame) lands where the filmer put it
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const fit = () => {
    const v = vid.current, fr = frame.current; if (!v || !fr || !v.videoWidth || !v.videoHeight) return;
    const W = fr.clientWidth, H = fr.clientHeight, k = Math.max(W / v.videoWidth, H / v.videoHeight);
    const width = v.videoWidth * k, height = v.videoHeight * k;
    setBox({ left: (W - width) / 2, top: (H - height) / 2, width, height });
  };
  useEffect(() => { window.addEventListener('resize', fit); return () => window.removeEventListener('resize', fit); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const focus = focusOf(shot);
  const { ox, oy } = originOf(focus);
  const name = own ? 'Your' : `${first(person(shot.who))}'s`;
  useEffect(() => { if (shot.clip?.path) void mediaUrl(shot.clip.path).then(setSrc).catch(() => toast('That clip would not load. Try again in a moment.')); }, [shot.clip?.path]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  // watching one you've already done: play it whole, with sound
  useEffect(() => {
    const v = vid.current; if (!v || !src || canGuess) return;
    v.src = src; v.muted = false; v.play().then(() => setNeedTap(false)).catch(() => setNeedTap(true));
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  const begin = async () => {
    const v = vid.current; if (!v || !src) return;
    v.muted = true; if (v.getAttribute('src') !== src) v.src = src;
    try { await v.play(); } catch { toast('Tap Start again to play it'); return; }
    setStage('zoom'); t0.current = performance.now();
    const loop = () => {
      const x = Math.min(1, (performance.now() - t0.current) / PULL_MS);
      setP(x);
      if (x >= 1) { setStage('type'); return; }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
  };
  const know = () => { cancelAnimationFrame(raf.current); setP(Math.min(1, (performance.now() - t0.current) / PULL_MS)); setStage('type'); };
  const send = async () => {
    const g = text.trim(); if (!g || busy) return;
    setBusy(true);
    // sound on inside the tap, so iPhone lets it play
    const v = vid.current; if (v) { v.muted = false; v.currentTime = 0; void v.play().catch(() => setNeedTap(true)); }
    try {
      const r = await api.zoomMove(game.id, { who: shot.who, at: Math.round(p * 1000) / 1000, guess: g });
      onChanged(r); liveSend(chat.id, 'chat', { game: game.id }); setStage('reveal');
    } catch (e) { toast((e as Error).message); if (v) v.muted = true; }
    setBusy(false);
  };
  const say = async (got: boolean) => {
    setBusy(true);
    try { const r = await api.zoomMove(game.id, { who: shot.who, got }); onChanged(r); liveSend(chat.id, 'chat', { game: game.id }); }
    catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  const scale = stage === 'reveal' ? 1 : zoomScale(p, focus.z);
  const others = Object.entries(shot.guesses || {}).filter(([who]) => who !== me.id);
  const mine = shot.mine;
  return (
    <div className={`g-reveal z-guess ${stage}`}>
      <div className="z-frame" ref={frame}>
        {/* iPhone: scale a wrapper, never the video itself */}
        <div className="z-wrap" style={{ ...(box || {}), transformOrigin: `${ox * 100}% ${oy * 100}%`, transform: `scale(${scale})` }}>
          <video ref={vid} playsInline loop muted className="z-vid" onLoadedMetadata={fit}
            onClick={() => { if (needTap) void vid.current?.play().then(() => setNeedTap(false)); }} />
        </div>
      </div>
      <div className="g-rv-top">
        <span className="g-rv-ic"><Icon name="camera" size={22} /></span>
        <span className="g-rv-who"><b>Zoom In</b><span>{name} clip{stage === 'zoom' || stage === 'type' ? `, ${scale.toFixed(1)}x` : ''}</span></span>
        {stage !== 'zoom' && <button className="icon-btn glass" onClick={onClose} aria-label="Close"><Icon name="close" /></button>}
      </div>
      {(stage === 'zoom' || stage === 'type') && <span className="z-bar"><i style={{ width: `${p * 100}%` }} /></span>}
      {needTap && <div className="paused tap g-rv-tap"><Icon name="play" size={56} fill="currentColor" /><span>Tap to play</span></div>}
      {stage === 'ready' && (
        <div className="g-end z-ready">
          <div className="g-box"><small><Avatar p={person(shot.who)} size={18} /> {first(person(shot.who))} filmed something</small>
            <p>What is it?</p></div>
          <p className="g-meta">It starts {xLabel(focus.z)} zoomed in and pulls out over 20 seconds. Tap I know it the moment you know. Sooner scores more.</p>
          <button className="btn g-go wide" disabled={!src} onClick={() => void begin()}>{src ? 'Start' : 'Getting it ready...'}</button>
          <p className="g-fine">You only get one guess.</p>
        </div>
      )}
      {stage === 'zoom' && <button className="btn g-go g-know" onClick={know}>I know it</button>}
      {stage === 'type' && (
        <form className="g-guessbar" onSubmit={e => { e.preventDefault(); void send(); }}>
          <span className="g-guess-t">{p >= 1 ? 'All the way out. Your best guess?' : `You stopped it at ${zoomScale(p, focus.z).toFixed(1)}x`}</span>
          <input id="z-guess" className="field big" autoFocus maxLength={40} value={text} onChange={e => setText(e.target.value)} placeholder="What is it?" autoComplete="off" />
          <button type="submit" className="btn g-go" disabled={!text.trim() || busy}><Icon name="send" size={18} /> Guess</button>
        </form>
      )}
      {stage === 'reveal' && (
        <div className="g-result z-result">
          <small>{own ? 'Yours was' : 'It was'}</small>
          <p>{shot.answer || '...'}</p>
          {mine && <span className="z-you">You said <b>{mine.text}</b>{mine.got != null ? (mine.got ? `. +${zoomPoints(mine)}` : '. No points this time.') : ''}</span>}
          {others.length > 0 && (
            <span className="z-others">{others.map(([who, r]) => (
              <span key={who} className={`z-g ${r.got ? 'got' : r.got === false ? 'miss' : ''}`}><Avatar p={person(who)} size={20} /><b>{first(person(who))}:</b> {r.text}{r.got && <Icon name="check" size={13} stroke={3} />}</span>
            ))}</span>
          )}
          {!own && others.length === 0 && game.status === 'playing' && <span className="z-you">Nobody else has guessed this one yet.</span>}
          {mine && mine.got == null ? (<>
            <b className="z-ask">Did you get it?</b>
            <span className="g-row-btns">
              <button className="btn" disabled={busy || !shot.answer} onClick={() => void say(false)}>No</button>
              <button className="btn g-go" disabled={busy || !shot.answer} onClick={() => void say(true)}><Icon name="check" size={18} stroke={3} /> Yes</button>
            </span>
          </>) : <button className="btn g-go" onClick={onClose}>Done</button>}
        </div>
      )}
    </div>
  );
}
