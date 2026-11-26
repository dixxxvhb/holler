// The reveal: every Pass It On clip back to back, then the phrase next to the guess.
// Film my reaction starts on here; your face from the reveal can join the reel (you choose to send it).
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, mediaUrl, publicUrl, type ChatFull, type Game, type Person, type Polo } from '../lib/api';
import { send as liveSend } from '../lib/live';
import { sendRecording } from '../lib/outbox';
import type { Recording, Studio } from '../lib/studio';
import { Avatar, toast } from '../ui/bits';
import { Icon } from '../ui/icons';
import { LiveFace } from './reaction';
import './games.css';

const first = (p?: Person | null) => (p?.name || 'Someone').split(' ')[0];

export function Reveal({ game: g0, chat, me, studio, onClose, onChanged, onPlayAgain }: {
  game: Game; chat: ChatFull; me: Person; studio: Studio | null; onClose: () => void; onChanged: (g: Game) => void; onPlayAgain: () => void;
}) {
  const [game, setGame] = useState(g0);
  const turns = useMemo(() => (game.clips || []).filter(c => c.gameTurn != null).sort((a, b) => (a.gameTurn ?? 0) - (b.gameTurn ?? 0)), [game.clips]);
  const faces = useMemo(() => (game.clips || []).filter(c => c.gameTurn == null), [game.clips]);
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<'reel' | 'end'>(turns.length ? 'reel' : 'end');
  const [needTap, setNeedTap] = useState(false);
  const [t, setT] = useState(0);
  const iFilmed = faces.some(f => f.author === me.id);
  const canFilm = !!studio?.stream && !iFilmed;
  const [film, setFilm] = useState(canFilm);
  const [rec, setRec] = useState<Recording | null>(null);
  const [face, setFace] = useState<Polo | null>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const filming = useRef(false);
  const [isFilming, setIsFilming] = useState(false);
  const person = (id: string) => (id === me.id ? me : chat.members.find(m => m.id === id));
  const clip = turns[i];

  useEffect(() => { void api.game(game.id).then(setGame).catch(() => {}); }, [game.id]);
  useEffect(() => () => { if (filming.current) studio?.cancel(); }, [studio]);

  useEffect(() => {
    if (phase !== 'reel' || !clip?.path) return;
    let gone = false;
    void mediaUrl(clip.path).then(u => {
      const v = vid.current; if (gone || !v) return;
      v.src = u; setT(0);
      v.play().then(() => { setNeedTap(false); void startFilm(); }).catch(() => setNeedTap(true));
    });
    const n = turns[i + 1]; if (n?.path) void mediaUrl(n.path);
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, phase, clip?.id]);

  const startFilm = async () => {
    if (!film || filming.current || !studio?.stream || studio.recording) return;
    try { filming.current = true; await studio.start('video', { videoBits: 500_000 }); setIsFilming(true); } catch { filming.current = false; }
  };
  const stopFilm = async () => {
    if (!filming.current || !studio) return;
    filming.current = false; setIsFilming(false);
    const r = await studio.stop();
    if (r && r.duration >= 1 && r.blob.size >= 1000) setRec(r);
  };
  const toEnd = () => { setPhase('end'); vid.current?.pause(); setTimeout(() => void stopFilm(), 2500); };
  const next = () => { if (i + 1 < turns.length) setI(i + 1); else toEnd(); };

  const sendFace = () => {
    if (!rec) return;
    sendRecording(chat.id, me.id, { ...rec, effects: { ...rec.effects, game: { id: game.id, reveal: true } } }, null,
      () => { void api.game(game.id).then(setGame).catch(() => {}); liveSend(chat.id, 'chat', { game: game.id }); });
    setRec(null); toast('Your reaction joins the reel');
  };
  const save = async () => {
    try { const g = await api.gameSave(game.id, !game.savedAt); setGame(g); onChanged(g); liveSend(chat.id, 'chat', { game: g.id }); toast(g.savedAt ? 'Reel saved. These clips stay.' : 'Reel not saved'); }
    catch (e) { toast((e as Error).message); }
  };

  const label = (c: Polo) => {
    const n = c.gameTurn ?? 0; const who = person(c.author); const prev = turns[turns.indexOf(c) - 1];
    if (n === 0) return <>{first(who)} <em>acts it</em></>;
    if (n >= game.order.length - 1) return <>{first(who)} <em>guesses</em></>;
    return <>{first(who)} <em>copies {first(person(prev?.author || ''))}</em></>;
  };
  const dur = clip?.duration || (vid.current && isFinite(vid.current.duration) ? vid.current.duration : 0);

  if (face) return (
    <div className="g-reveal">
      <video src={publicUrl(face.path || '')} autoPlay playsInline className="g-rv-vid" onEnded={() => setFace(null)} onClick={() => setFace(null)} />
      <div className="g-rv-label"><Avatar p={person(face.author)} size={26} /> {first(person(face.author))} <em>watching the reveal</em></div>
      <button className="icon-btn glass g-rv-x" onClick={() => setFace(null)} aria-label="Close"><Icon name="close" /></button>
    </div>
  );

  return (
    <div className="g-reveal">
      {phase === 'reel' && clip && (<>
        <video ref={vid} playsInline className="g-rv-vid" onEnded={next} onTimeUpdate={e => setT(e.currentTarget.currentTime)}
          onClick={() => { if (needTap) void vid.current?.play().then(() => { setNeedTap(false); void startFilm(); }); else next(); }} />
        <div className="g-rv-bars">{turns.map((c, k) => <i key={c.id}><b style={{ width: k < i ? '100%' : k > i ? '0%' : `${dur ? Math.min(100, (t / dur) * 100) : 0}%` }} /></i>)}</div>
        <div className="g-rv-top">
          <span className="g-rv-ic"><Icon name="chain" size={22} /></span>
          <span className="g-rv-who"><b>Pass It On</b><span>The reveal</span></span>
          <button className="icon-btn glass" onClick={() => { void stopFilm(); onClose(); }} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="g-rv-label"><Avatar p={person(clip.author)} size={26} /> {i + 1} of {turns.length} {label(clip)}</div>
        {needTap && <div className="paused tap g-rv-tap"><Icon name="play" size={56} fill="currentColor" /><span>Tap to play</span></div>}
        {canFilm && film && isFilming && <div className="g-face live"><LiveFace studio={studio} className="g-face-vid" /><span className="g-face-lab"><i className="g-dot" />You</span></div>}
        {canFilm && !isFilming && rec === null && (
          <button className={`g-film ${film ? 'on' : ''}`} onClick={() => setFilm(f => !f)}><span className="g-sw" />Film my reaction</button>
        )}
        <button className="g-rv-skip" onClick={next}>{i + 1 < turns.length ? 'Next' : 'See the answer'}</button>
      </>)}

      {phase === 'end' && (
        <div className="g-end">
          <button className="icon-btn glass g-rv-x" onClick={() => { void stopFilm(); onClose(); }} aria-label="Close"><Icon name="close" /></button>
          <div className="g-pair">
            <div className="g-box">
              <small>{game.guess ? <><Avatar p={person(game.order[game.order.length - 1])} size={18} /> {first(person(game.order[game.order.length - 1]))} guessed</> : 'No guess this time'}</small>
              <p>{game.guess || 'The guesser got skipped.'}</p>
            </div>
            <div className="g-box truth"><small>It was</small><p>{game.phrase}</p></div>
          </div>
          {(faces.length > 0 || rec) && (
            <div className="g-faces">
              {faces.map(f => (
                <button key={f.id} className="g-fr" onClick={() => setFace(f)} aria-label={`${first(person(f.author))} watching the reveal`}>
                  {f.thumb ? <img src={publicUrl(f.thumb)} alt="" /> : <span className="g-fr-blank" />}
                  <span className="g-fr-av"><Avatar p={person(f.author)} size={18} /></span>
                </button>
              ))}
            </div>
          )}
          {rec && (
            <div className="g-sendface">
              <span>Add your face from the reveal to the reel?</span>
              <span className="g-row-btns"><button className="btn" onClick={() => setRec(null)}>Toss it</button><button className="btn primary" onClick={sendFace}>Add it</button></span>
            </div>
          )}
          <button className={`btn wide ${game.savedAt ? '' : 'g-go'}`} onClick={() => void save()}>
            <Icon name="star" size={18} fill={game.savedAt ? 'currentColor' : undefined} /> {game.savedAt ? 'Reel saved' : 'Save the reel'}
          </button>
          {turns.length > 0 && <button className="btn wide" onClick={() => { setI(0); setPhase('reel'); }}><Icon name="play" size={16} fill="currentColor" /> Watch it again</button>}
          <button className="btn wide" onClick={onPlayAgain}>Play again</button>
          <p className="g-fine">{game.savedAt ? 'Saved, so these clips stay.' : `Not saved yet. These clips hide on ${game.hidesAt ? new Date(game.hidesAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'in a week'}.`}</p>
        </div>
      )}
    </div>
  );
}
