// Don't Laugh: everyone records a clip trying to crack the others up. Then everyone watches everyone else's
// with the front camera filming them. The phone watches for a smile (nothing leaves the phone for that);
// crack and your face clip is the proof. Rules live in supabase/games4.sql.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, laughActs, mediaUrl, publicUrl, type ChatFull, type Game, type LaughAct, type Person, type Polo } from '../lib/api';
import { send as liveSend } from '../lib/live';
import { sendRecording } from '../lib/outbox';
import { SmileWatch, loadFace } from '../lib/face';
import type { Studio } from '../lib/studio';
import { Avatar, Sheet, ago, toast } from '../ui/bits';
import { Icon } from '../ui/icons';
import { LiveFace } from './reaction';
import { first, owes, personIn, standings } from './roundLogic';
import './games.css';

const hours6 = (iso: string | null | undefined) => !!iso && Date.now() - new Date(iso).getTime() < 6 * 3600e3;

/** A straight face the whole way: +1. Each person who cracks at your clip: +1 for you. */
export function laughScores(g: Game): Record<string, number> {
  const s: Record<string, number> = Object.fromEntries(g.order.map(id => [id, 0]));
  for (const a of laughActs(g)) for (const [who, r] of Object.entries(a.results || {})) {
    if (!r.done) continue;
    if (r.cracked == null) s[who] = (s[who] || 0) + 1; else s[a.who] = (s[a.who] || 0) + 1;
  }
  return s;
}

// ---------------------------------------------------------------- start
export function LaughStart({ open, onClose, chat, me, onStarted }: {
  open: boolean; onClose: () => void; chat: ChatFull; me: Person; onStarted: (g: Game) => void;
}) {
  const others = useMemo(() => chat.members.filter(m => m.id !== me.id), [chat.members, me.id]);
  const [who, setWho] = useState<string[]>([]);
  const [sec, setSec] = useState(15);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setWho(others.slice(0, 4).map(o => o.id)); }, [open, others]);
  const toggle = (id: string) => setWho(o => (o.includes(id) ? o.filter(x => x !== id) : o.length >= 4 ? o : [...o, id]));
  const line = [me.id, ...who];
  const start = async () => {
    setBusy(true);
    try { const g = await api.gameStart2(chat.id, 'laugh', line, { turnSec: sec }); liveSend(chat.id, 'chat', { game: g.id }); onStarted(g); }
    catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Don't Laugh">
      <p className="g-sub">Everyone records a clip trying to make the others laugh. Then you watch theirs while your camera films your face. The phone spots a smile. Crack, and they see the moment it happened.</p>
      <span className="lbl">Your clip</span>
      <div className="seg g-seg">{[10, 15, 20].map(s => <button key={s} className={sec === s ? 'on' : ''} onClick={() => setSec(s)}>{s} sec</button>)}</div>
      <span className="lbl">Playing</span>
      <div className="g-order-tools">
        <span className="chip on g-me-chip"><Avatar p={me} size={18} /> You</span>
        {others.map(o => <button key={o.id} className={`chip ${who.includes(o.id) ? 'on' : ''}`} onClick={() => toggle(o.id)}><Avatar p={o} size={18} /> {first(o)}</button>)}
      </div>
      {line.length < 2 && <p className="g-warn">Pick at least 1 person to play with.</p>}
      <p className="g-fine">Smile spotting runs on your phone. Only the clips you send leave it.</p>
      <button className="btn g-go wide" disabled={busy || line.length < 2} onClick={() => void start()}>Start and record mine</button>
    </Sheet>
  );
}

export function LaughBanner({ game }: { game: Game }) {
  return <div className="g-banner"><Icon name="laugh" size={24} /><span><b>Make them laugh</b>
    <em>{game.turnSec} seconds. A face, a voice, a bit, a bad joke. It sends itself at the end.</em></span></div>;
}

// ---------------------------------------------------------------- the game page
export function LaughPage({ game, chat, me, studio, onCamWanted, onClose, onTakeTurn, onChanged }: {
  game: Game; chat: ChatFull; me: Person; studio: Studio | null; onClose: () => void; onTakeTurn: (g: Game) => void; onChanged: (g: Game) => void;
  /** asks the room for the camera (it sleeps unless something uses it); resolves true once it is on */
  onCamWanted?: (on: boolean) => Promise<boolean>;
}) {
  const person = personIn(chat, me);
  const playing = game.status === 'playing';
  const acts = laughActs(game);
  const [watch, setWatch] = useState<LaughAct | null>(null);
  const [view, setView] = useState<{ polo: Polo; title: string } | null>(null);
  useEffect(() => { void api.game(game.id).then(onChanged).catch(() => {}); }, [game.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (f: () => Promise<Game>, done?: string) => {
    try { const g = await f(); onChanged(g); liveSend(chat.id, 'chat', { game: g.id }); if (done) toast(done); } catch (e) { toast((e as Error).message); }
  };
  const mineIn = (game.acted || []).includes(me.id);
  const scores = laughScores(game);
  const board = standings(scores);
  const allTied = board.length > 1 && board.every(r => r.place === 1);
  const waiting = (game.todo || []).filter(id => id !== me.id);
  if (watch) return <LaughWatch act={watch} game={game} chat={chat} me={me} studio={studio} onCamWanted={onCamWanted} onClose={g => { if (g) onChanged(g); setWatch(null); }} />;
  if (view) return <ClipView polo={view.polo} title={view.title} onClose={() => setView(null)} />;
  return (
    <div className="g-page">
      <header className="g-head">
        <button className="icon-btn g-back" onClick={onClose} aria-label="Back"><Icon name="back" /></button>
        <h2>Don't Laugh</h2>
      </header>
      <p className="g-meta">Started by {game.createdBy === me.id ? 'you' : first(person(game.createdBy || ''))}, {ago(game.createdAt)}. {game.turnSec} second clips.</p>
      {playing && !mineIn && game.order.includes(me.id) && <button className="btn g-go wide" onClick={() => onTakeTurn(game)}>Record mine</button>}
      <ol className="g-track">
        {acts.map(a => {
          const p = person(a.who); const own = a.who === me.id;
          const res = Object.entries(a.results || {}).filter(([, r]) => r.done);
          const cracked = res.filter(([, r]) => r.cracked != null);
          const todo = playing && !own && !a.mine?.done && game.order.includes(me.id);
          const sub = own ? (res.length ? `${cracked.length} of ${res.length} cracked` : 'Nobody has watched yet')
            : a.mine?.done ? (a.mine.cracked != null ? `You cracked at ${a.mine.cracked.toFixed(1)} s` : 'Straight face. +1')
            : !playing ? 'You did not watch this one' : 'Watch it without smiling';
          return (
            <li key={a.who} className={`g-row l-row ${todo ? 'up' : ''}`}>
              <button className="g-thumb" disabled={!a.clip} onClick={() => (todo ? setWatch(a) : a.clip && setView({ polo: a.clip, title: `${own ? 'Your' : first(p) + "'s"} clip` }))} aria-label={`${first(p)}'s clip`}>
                {a.clip?.thumb ? <img src={publicUrl(a.clip.thumb)} alt="" /> : <span className="g-thumb-blank" />}
                <span className="g-thumb-av"><Avatar p={p} size={18} /></span>
              </button>
              <span className="g-row-txt"><b>{own ? 'Your clip' : `${first(p)}'s clip`}</b><span>{sub}</span>
                {res.length > 0 && (
                  <span className="l-faces">{res.map(([who, r]) => (
                    <button key={who} className={`l-face ${r.cracked != null ? 'cracked' : ''}`} disabled={!r.clip}
                      onClick={() => r.clip && setView({ polo: r.clip, title: `${who === me.id ? 'You' : first(person(who))} watching ${own ? 'yours' : first(p) + "'s"}` })}>
                      <Avatar p={person(who)} size={22} /><em>{r.cracked != null ? `${r.cracked.toFixed(1)} s` : 'held it'}</em>
                    </button>
                  ))}</span>
                )}
              </span>
              {todo && a.clip && <button className="btn g-go g-row-btn" onClick={() => setWatch(a)}>Watch</button>}
            </li>
          );
        })}
        {playing && game.order.filter(id => !(game.acted || []).includes(id)).map(id => (
          <li key={id} className="g-row">
            <Avatar p={person(id)} size={38} />
            <span className="g-row-txt"><b>{id === me.id ? 'You' : first(person(id))}</b><span>Hasn't recorded yet</span></span>
          </li>
        ))}
      </ol>
      {board.some(r => r.pts > 0) && (
        <div className="g-board">
          <span className="lbl">{game.status === 'done' ? (allTied ? 'Final scores: a tie' : 'Final scores') : 'Scores so far'}</span>
          {board.map(r => (
            <div key={r.id} className={`g-board-row ${r.place === 1 && r.pts > 0 && !allTied && game.status === 'done' ? 'top' : ''}`}>
              <i>{r.place}</i><Avatar p={person(r.id)} size={30} /><b>{r.id === me.id ? 'You' : first(person(r.id))}</b><em>{r.pts}</em>
            </div>
          ))}
          <p className="g-fine">A straight face through a clip: 1. Each person who cracks at yours: 1.</p>
        </div>
      )}
      {playing && waiting.length > 0 && game.order.includes(me.id) && (
        <button className="btn wide" disabled={hours6(game.nudgedAt)} onClick={() => void act(() => api.gameNudge(game.id), 'Nudged')}>
          {hours6(game.nudgedAt) ? `Nudged ${ago(game.nudgedAt!)}` : `Nudge ${waiting.length === 1 ? first(person(waiting[0])) : 'everyone still playing'}`}
        </button>
      )}
      {!playing && !game.hidden && acts.length > 0 && (
        <button className={`btn wide ${game.savedAt ? '' : 'g-go'}`} onClick={() => void act(() => api.gameSave(game.id, !game.savedAt), game.savedAt ? 'Not saved' : 'Saved')}>
          <Icon name="star" size={18} fill={game.savedAt ? 'currentColor' : undefined} /> {game.savedAt ? 'Saved' : 'Save these clips'}
        </button>
      )}
      <p className="g-foot">{playing ? 'You see everyone\'s faces for a clip once you\'ve watched it yourself. Anyone who waits 2 days gets passed by.' : game.savedAt ? 'Saved. A week after the game these clips get 3 days on the leaving list, so you can save them to your camera roll.' : 'Clips hide a week after the game unless someone saves them.'}</p>
      {playing && game.createdBy === me.id && <button className="link-btn g-endgame" onClick={() => void act(() => api.gameEnd(game.id), 'Game ended')}>End this game</button>}
    </div>
  );
}

// ---------------------------------------------------------------- one clip, full screen
function ClipView({ polo, title, onClose }: { polo: Polo; title: string; onClose: () => void }) {
  const vid = useRef<HTMLVideoElement>(null);
  const [needTap, setNeedTap] = useState(false);
  useEffect(() => {
    let gone = false;
    if (polo.path) void mediaUrl(polo.path).then(u => { const v = vid.current; if (gone || !v) return; v.src = u; v.play().then(() => setNeedTap(false)).catch(() => setNeedTap(true)); });
    return () => { gone = true; };
  }, [polo.path]);
  return (
    <div className="g-reveal">
      <video ref={vid} playsInline className="g-rv-vid" onEnded={onClose} onClick={() => { if (needTap) void vid.current?.play().then(() => setNeedTap(false)); }} />
      <div className="g-rv-top">
        <span className="g-rv-ic"><Icon name="laugh" size={22} /></span>
        <span className="g-rv-who"><b>Don't Laugh</b><span>{title}</span></span>
        <button className="icon-btn glass" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      </div>
      {needTap && <div className="paused tap g-rv-tap"><Icon name="play" size={56} fill="currentColor" /><span>Tap to play</span></div>}
    </div>
  );
}

// ---------------------------------------------------------------- watch theirs with a straight face
function LaughWatch({ act, game, chat, me, studio, onCamWanted, onClose }: {
  act: LaughAct; game: Game; chat: ChatFull; me: Person; studio: Studio | null; onClose: (g?: Game) => void;
  onCamWanted?: (on: boolean) => Promise<boolean>;
}) {
  const person = personIn(chat, me);
  const vid = useRef<HTMLVideoElement>(null);
  const [stage, setStage] = useState<'ready' | 'loading' | 'watching' | 'done'>('ready');
  const [smile, setSmile] = useState(0);
  const [faceOn, setFaceOn] = useState(false);
  const [result, setResult] = useState<number | null | undefined>(undefined); // undefined: not over yet
  const [src, setSrc] = useState<string | null>(null);
  const watcher = useRef<SmileWatch | null>(null);
  const raf = useRef(0);
  const filming = useRef(false);
  const over = useRef(false);
  // the camera sleeps unless something uses it: ask for it as soon as the watch opens, so it is on before the clip
  // plays, and give it back when the watch closes. No camera: the I laughed button still works.
  const studioRef = useRef(studio); studioRef.current = studio;
  const ready = useRef<Promise<boolean>>(Promise.resolve(false));
  const [camFail, setCamFail] = useState(false);
  useEffect(() => {
    if (!onCamWanted) return;
    let gone = false;
    ready.current = onCamWanted(true);
    void ready.current.then(ok => { if (!ok && !gone) setCamFail(true); });
    return () => { gone = true; void onCamWanted(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const camOk = !!onCamWanted && !camFail;
  useEffect(() => { if (act.clip?.path) void mediaUrl(act.clip.path).then(setSrc); }, [act.clip?.path]);
  useEffect(() => () => { cancelAnimationFrame(raf.current); if (filming.current && studio?.recording) studio.cancel(); }, [studio]);

  const finish = async (cracked: number | null) => {
    if (over.current) return; over.current = true;
    cancelAnimationFrame(raf.current);
    setResult(cracked); setStage('done');
    const v = vid.current;
    // keep filming a beat past the crack so the moment is in the clip
    if (cracked != null) await new Promise(r => setTimeout(r, 1500));
    if (v && !v.paused) v.pause();
    let g: Game | undefined;
    try { g = await api.gameLaughed(game.id, act.who, cracked); liveSend(chat.id, 'chat', { game: game.id }); }
    catch (e) { toast((e as Error).message); }
    const st = studioRef.current;
    if (filming.current && st) {
      filming.current = false;
      const rec = await st.stop().catch(() => null);
      if (rec && rec.duration >= 1 && rec.blob.size >= 1000 && act.clip) {
        rec.effects = { ...rec.effects, reactTo: act.clip.id, sync: [{ r: 0, o: 0, rate: 1, playing: true }], game: { id: game.id, of: act.who } };
        sendRecording(chat.id, me.id, rec, null);
      }
    }
    if (g) setFinal(g);
    setSettled(true);
  };
  const [final, setFinal] = useState<Game | null>(null);
  const [settled, setSettled] = useState(false);

  const start = async () => {
    const v = vid.current; if (!v || !src) return;
    setStage('loading');
    // play inside the tap so iPhone allows sound, then hold on the first frame while the camera gets going
    if (v.getAttribute('src') !== src) v.src = src;
    try { await v.play(); } catch { setStage('ready'); toast('Tap Start again to play it'); return; }
    v.pause(); v.currentTime = 0;
    const camOn = camOk && await Promise.race([ready.current, new Promise<boolean>(r => setTimeout(() => r(false), 10000))]);
    const st = studioRef.current;
    if (camOn && st?.stream && !st.recording) {
      const lm = await loadFace();
      if (lm) { watcher.current = new SmileWatch(); setFaceOn(true); }
      try { await st.start('video', { videoBits: 500_000 }); filming.current = true; } catch { /* plays on without filming */ }
    }
    try { await v.play(); } catch {
      if (filming.current && st?.recording) st.cancel();
      filming.current = false; setStage('ready'); toast('Tap Start again to play it'); return;
    }
    setStage('watching');
    const loop = () => {
      const w = watcher.current; const s2 = studioRef.current;
      if (w && s2) {
        if (w.tick(s2.video)) { void finish(Math.round(v.currentTime * 10) / 10); return; }
        setSmile(w.seen ? Math.min(1, w.smile / w.line) : 0);
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
  };

  const actor = first(person(act.who));
  return (
    <div className="g-reveal l-watch">
      <video ref={vid} playsInline className="g-rv-vid" onEnded={() => void finish(null)} />
      <div className="g-rv-top">
        <span className="g-rv-ic"><Icon name="laugh" size={22} /></span>
        <span className="g-rv-who"><b>Don't Laugh</b><span>{actor}'s clip</span></span>
        {stage !== 'watching' && <button className="icon-btn glass" onClick={() => onClose(final || undefined)} aria-label="Close"><Icon name="close" /></button>}
      </div>
      {stage === 'watching' && camOk && studio && <div className="l-me"><LiveFace studio={studio} className="l-me-vid" />
        {faceOn && <span className="l-meter"><i style={{ height: `${Math.round(smile * 100)}%` }} /></span>}</div>}
      {stage === 'watching' && <button className="g-rv-skip l-gave" onClick={() => void finish(Math.round((vid.current?.currentTime || 0) * 10) / 10)}>I laughed</button>}
      {(stage === 'ready' || stage === 'loading') && (
        <div className="g-end l-ready">
          <div className="g-box"><small><Avatar p={person(act.who)} size={18} /> {actor} is trying to make you laugh</small>
            <p>Keep a straight face for the whole clip.</p></div>
          <p className="g-meta">{camOk ? 'Your camera films your face while it plays. Smile, and you\'re out, and ' + actor + ' gets to see it.' : 'The camera is off, so this one runs on your honor. Tap I laughed if you crack.'}</p>
          <button className="btn g-go wide" disabled={!src || stage === 'loading'} onClick={() => void start()}>{stage === 'loading' ? 'Getting ready...' : 'Start'}</button>
          <p className="g-fine">You only get one watch.</p>
        </div>
      )}
      {stage === 'done' && (
        <div className="g-end l-done">
          <div className={`g-box ${result == null ? 'truth' : ''}`}><small>{actor}'s clip</small>
            <p>{result == null ? 'Straight face. +1' : `You cracked at ${result.toFixed(1)} seconds`}</p></div>
          <p className="g-meta">{result == null ? `Not even a smile. ${actor} gets nothing for this one.` : `${actor} gets a point, and your face goes to the game.`}</p>
          <button className="btn g-go wide" disabled={!settled} onClick={() => onClose(final || undefined)}>{settled ? 'Done' : 'Saving...'}</button>
        </div>
      )}
    </div>
  );
}
