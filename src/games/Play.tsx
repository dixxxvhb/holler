// Holler Play: the Play sheet, starting Pass It On, the game page, the one look, and the guess.
// Rules live in the database (supabase/games.sql); these screens only show state and call the RPCs.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, mediaUrl, type ChatFull, type Game, type Person } from '../lib/api';
import { send as liveSend } from '../lib/live';
import { Avatar, Sheet, ago, toast } from '../ui/bits';
import { Icon } from '../ui/icons';
import { phraseOrder } from './content/cards';
import { shuffle } from './content/shuffle';
import './games.css';

const first = (p?: Person | null) => (p?.name || 'Someone').split(' ')[0];
const local = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const keep = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

import { roleOf } from './roundLogic';
export { roleOf, type Role } from './roundLogic';

// ---------------------------------------------------------------- the Play sheet
export function PlaySheet({ open, onClose, people, onCard, onPassItOn, onRound }: {
  open: boolean; onClose: () => void; people: number; onCard: () => void; onPassItOn: () => void; onRound: (k: 'poker' | 'charades' | 'ttt' | 'checkers' | 'words' | 'trivia' | 'spot' | 'laugh' | 'lastcard' | 'zoom' | 'said') => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Play">
      <p className="g-sub">Everything here is a holler. Play whenever you have a minute; nobody has to be on at the same time.</p>
      <button className="g-opt" onClick={onCard}>
        <span className="g-opt-ic card"><Icon name="cards" size={24} /></span>
        <span className="g-opt-txt"><b>Give me a card</b><span>Something to talk about, on screen while you record. Say it, guess it, or act it.</span></span>
      </button>
      <button className="g-opt game" onClick={onPassItOn} disabled={people < 3}>
        <span className="g-opt-ic pass"><Icon name="chain" size={24} /></span>
        <span className="g-opt-txt"><b>Pass It On</b><span>{people < 3 ? 'Needs 3 or more people in this chat.' : 'You act out a secret phrase. Each person copies only the clip before theirs. The last one guesses.'}</span></span>
        <span className="g-opt-n">3 to 5</span>
      </button>
      <button className="g-opt game" onClick={() => onRound('poker')} disabled={people < 3}>
        <span className="g-opt-ic pass"><Icon name="facecam" size={24} /></span>
        <span className="g-opt-txt"><b>Poker Face</b><span>{people < 3 ? 'Needs 3 or more people in this chat.' : 'Everyone answers the same question to camera. One of you secretly has the real answer. Vote on who.'}</span></span>
        <span className="g-opt-n">3 to 5</span>
      </button>
      <button className="g-opt game" onClick={() => onRound('charades')} disabled={people < 2}>
        <span className="g-opt-ic pass"><Icon name="eye" size={24} /></span>
        <span className="g-opt-txt"><b>Charades Relay</b><span>{people < 2 ? 'Needs 2 or more people in this chat.' : 'Everyone acts out a secret word with no talking. Guess the others. Faster scores more.'}</span></span>
        <span className="g-opt-n">2 to 5</span>
      </button>
      <button className="g-opt game" onClick={() => onRound('spot')} disabled={people < 2}>
        <span className="g-opt-ic pass"><Icon name="timer" size={24} /></span>
        <span className="g-opt-txt"><b>On The Spot</b><span>{people < 2 ? 'Needs 2 or more people in this chat.' : 'Trivia on camera. Your questions appear the moment you hit record. Everyone watches you sweat.'}</span></span>
        <span className="g-opt-n">2 to 5</span>
      </button>
      <button className="g-opt game" onClick={() => onRound('laugh')} disabled={people < 2}>
        <span className="g-opt-ic pass"><Icon name="laugh" size={24} /></span>
        <span className="g-opt-txt"><b>Don't Laugh</b><span>{people < 2 ? 'Needs 2 or more people in this chat.' : 'Record something to crack them up. Watch theirs while your camera watches you. Smile and you\'re out.'}</span></span>
        <span className="g-opt-n">2 to 5</span>
      </button>
      <button className="g-opt game" onClick={() => onRound('zoom')} disabled={people < 2}>
        <span className="g-opt-ic pass"><Icon name="camera" size={24} /></span>
        <span className="g-opt-txt"><b>Zoom In</b><span>{people < 2 ? 'Needs 2 or more people in this chat.' : 'Film something up close. Everyone sees it way zoomed in and pulling out. Name it before it gets obvious.'}</span></span>
        <span className="g-opt-n">2 to 6</span>
      </button>
      <button className="g-opt game" onClick={() => onRound('said')} disabled={people < 3}>
        <span className="g-opt-ic pass"><Icon name="wow" size={24} /></span>
        <span className="g-opt-txt"><b>Who Said It</b><span>{people < 3 ? 'Needs 3 or more people in this chat.' : 'Everyone answers a prompt about each other. Then guess who wrote what about you. No camera needed.'}</span></span>
        <span className="g-opt-n">3 to 6</span>
      </button>
      <span className="lbl g-play-lbl">Quick games</span>
      <button className="g-opt game" onClick={() => onRound('words')} disabled={people < 2}>
        <span className="g-opt-ic pass"><Icon name="letters" size={24} /></span>
        <span className="g-opt-txt"><b>Seven Letters</b><span>{people < 2 ? 'Needs 2 or more people in this chat.' : 'Same seven letters for everyone. Make as many words as you can before the clock runs out.'}</span></span>
        <span className="g-opt-n">2 to 5</span>
      </button>
      <button className="g-opt game" onClick={() => onRound('trivia')} disabled={people < 2}>
        <span className="g-opt-ic pass"><Icon name="quiz" size={24} /></span>
        <span className="g-opt-txt"><b>Trivia</b><span>{people < 2 ? 'Needs 2 or more people in this chat.' : 'Ten questions, fifteen seconds each. Same questions for everyone. Faster scores more.'}</span></span>
        <span className="g-opt-n">2 to 5</span>
      </button>
      <span className="lbl g-play-lbl">Board and card games</span>
      <button className="g-opt game" onClick={() => onRound('lastcard')} disabled={people < 2}>
        <span className="g-opt-ic pass"><Icon name="cards" size={24} /></span>
        <span className="g-opt-txt"><b>Last Card</b><span>{people < 2 ? 'Needs 2 or more people in this chat.' : 'Match by color or number, hit them with Skips and Draw Twos, and get rid of every card first.'}</span></span>
        <span className="g-opt-n">2 to 6</span>
      </button>
      <button className="g-opt game" onClick={() => onRound('checkers')} disabled={people < 2}>
        <span className="g-opt-ic pass"><Icon name="board" size={24} /></span>
        <span className="g-opt-txt"><b>Checkers</b><span>{people < 2 ? 'Needs 2 or more people in this chat.' : 'Classic checkers, one move at a time. Jumps are a must.'}</span></span>
        <span className="g-opt-n">2</span>
      </button>
      <button className="g-opt game" onClick={() => onRound('ttt')} disabled={people < 2}>
        <span className="g-opt-ic pass"><Icon name="grid" size={24} /></span>
        <span className="g-opt-txt"><b>Tic-Tac-Toe</b><span>{people < 2 ? 'Needs 2 or more people in this chat.' : 'Three in a row. Quick, and always good for a rematch.'}</span></span>
        <span className="g-opt-n">2</span>
      </button>
      <p className="g-later">Coming next: The Long Game.</p>
    </Sheet>
  );
}

// ---------------------------------------------------------------- start Pass It On
export function StartSheet({ open, onClose, chat, me, onStarted }: {
  open: boolean; onClose: () => void; chat: ChatFull; me: Person; onStarted: (g: Game) => void;
}) {
  const others = useMemo(() => chat.members.filter(m => m.id !== me.id), [chat.members, me.id]);
  const usedKey = `holler.phrases.${chat.id}`;
  const deck = useMemo(() => phraseOrder(JSON.parse(local(usedKey, '[]'))), [usedKey, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pi, setPi] = useState(0);
  const [order, setOrder] = useState<string[]>([]);
  const [sec, setSec] = useState(10);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setPi(0); setOrder(shuffle(others.map(o => o.id)).slice(0, 4)); } }, [open, others]);
  const phrase = deck[pi % deck.length];
  const line = [me.id, ...order];
  const person = (id: string) => (id === me.id ? me : chat.members.find(m => m.id === id));
  const toggle = (id: string) => setOrder(o => (o.includes(id) ? o.filter(x => x !== id) : o.length >= 4 ? o : [...o, id]));
  const start = async () => {
    setBusy(true);
    try {
      const g = await api.gameStart(chat.id, line, sec, phrase.text, phrase.id);
      keep(usedKey, JSON.stringify([...JSON.parse(local(usedKey, '[]')), phrase.id].slice(-80)));
      liveSend(chat.id, 'chat', { game: g.id });
      onStarted(g);
    } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Pass It On">
      <p className="g-sub">Act it out with no words. Everyone after you only sees the clip right before theirs.</p>
      <div className="g-secret">
        <small>Only you see this</small>
        <p>{phrase?.text}</p>
        <button className="chip" onClick={() => setPi(i => i + 1)}><Icon name="shuffle" size={15} /> Another one</button>
      </div>
      <span className="lbl">Order</span>
      <div className="g-order">
        {line.map((id, i) => (
          <div key={id} className="g-step">
            {i > 0 && <span className="g-arrow">&rsaquo;</span>}
            <span className="g-step-in"><Avatar p={person(id)} size={40} /><em>{i === 0 ? 'You act' : i === line.length - 1 ? 'Guesses' : 'Copies'}</em></span>
          </div>
        ))}
      </div>
      <div className="g-order-tools">
        <button className="chip" onClick={() => setOrder(o => shuffle(o))} disabled={order.length < 2}><Icon name="shuffle" size={15} /> Shuffle order</button>
        {others.length > 2 && others.map(o => (
          <button key={o.id} className={`chip ${order.includes(o.id) ? 'on' : ''}`} onClick={() => toggle(o.id)}>{first(o)}</button>
        ))}
      </div>
      {line.length < 3 && <p className="g-warn">Pick at least 2 people to play with.</p>}
      <span className="lbl">Each turn</span>
      <div className="seg g-seg">{[5, 10, 15].map(s => <button key={s} className={sec === s ? 'on' : ''} onClick={() => setSec(s)}>{s} sec</button>)}</div>
      <button className="btn g-go wide" disabled={busy || line.length < 3} onClick={() => void start()}>Start and record my turn</button>
    </Sheet>
  );
}

// ---------------------------------------------------------------- the game page
export function GamePage({ game, chat, me, onClose, onTakeTurn, onReveal, onChanged }: {
  game: Game; chat: ChatFull; me: Person; onClose: () => void; onTakeTurn: (g: Game) => void; onReveal: (g: Game) => void; onChanged: (g: Game) => void;
}) {
  const person = (id: string) => (id === me.id ? me : chat.members.find(m => m.id === id));
  const starter = person(game.order[0]);
  const up = game.turnPerson ? person(game.turnPerson) : null;
  const mine = game.status === 'playing' && game.turnPerson === me.id;
  const act = async (f: () => Promise<Game>, done?: string) => {
    try { const g = await f(); onChanged(g); liveSend(chat.id, 'chat', { game: g.id }); if (done) toast(done); } catch (e) { toast((e as Error).message); }
  };
  return (
    <div className="g-page">
      <header className="g-head">
        <button className="icon-btn g-back" onClick={onClose} aria-label="Back"><Icon name="back" /></button>
        <h2>Pass It On</h2>
      </header>
      <p className="g-meta">Started by {game.order[0] === me.id ? 'you' : first(starter)}, {ago(game.createdAt)}. {game.turnSec} seconds a turn.</p>
      <ol className="g-track">
        {game.order.map((id, i) => {
          const p = person(id); const t = game.turns.find(x => x.turn === i);
          const isUp = game.status === 'playing' && game.idx === i;
          const verb = i === 0 ? 'Acted it' : i === game.order.length - 1 ? 'Guessed' : 'Copied it';
          const sub = t ? (t.skipped ? 'Skipped (no turn in 2 days)' : `${verb}, ${ago(t.at)}`) : isUp ? 'Up now'
            : game.status !== 'playing' ? 'Did not get a turn' : i === game.order.length - 1 ? 'Guesses last' : 'Waiting';
          return (
            <li key={id} className={`g-row ${isUp ? 'up' : ''} ${t?.skipped ? 'skip' : ''}`}>
              <Avatar p={p} size={38} />
              <span className="g-row-txt"><b>{id === me.id ? 'You' : first(p)}</b><span>{sub}</span></span>
              {t && !t.skipped && game.status === 'playing' && <span className="g-lock" aria-label="Locked until the reveal"><Icon name="lock" size={18} /></span>}
            </li>
          );
        })}
      </ol>
      {mine && <button className="btn g-go wide" onClick={() => onTakeTurn(game)}>{game.idx === 0 ? 'Act it out' : game.looked ? 'Record your copy' : 'Take your one look'}</button>}
      {game.status === 'playing' && !mine && up && (
        <button className="btn wide" onClick={() => void act(() => api.gameNudge(game.id), `Nudged ${first(up)}`)}
          disabled={!!game.nudgedAt && Date.now() - new Date(game.nudgedAt).getTime() < 6 * 3600e3}>
          {game.nudgedAt && Date.now() - new Date(game.nudgedAt).getTime() < 6 * 3600e3 ? `Nudged ${ago(game.nudgedAt)}` : `Nudge ${first(up)}`}
        </button>
      )}
      {game.status !== 'playing' && !game.hidden && <button className="btn g-go wide" onClick={() => onReveal(game)}><Icon name="play" size={16} fill="currentColor" /> Watch the reveal</button>}
      {game.status === 'ended' && game.turns.length <= 1 && <p className="g-meta">This one ended before anyone went.</p>}
      <p className="g-foot">
        {game.status === 'playing'
          ? 'Clips stay locked until the last guess. Nobody, you included, can peek at the middle of the chain. Anyone who waits 2 days gets skipped.'
          : game.savedAt ? 'The reel is saved, so these clips stay.' : game.hidden ? 'These clips are hidden now.' : `Clips hide ${game.hidesAt ? new Date(game.hidesAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'in a week'} unless someone saves the reel.`}
      </p>
      {game.status === 'playing' && game.createdBy === me.id && (
        <button className="link-btn g-endgame" onClick={() => void act(() => api.gameEnd(game.id), 'Game ended')}>End this game</button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- one look
export function LookScreen({ game, chat, me, onClose, onCopy }: {
  game: Game; chat: ChatFull; me: Person; onClose: () => void; onCopy: (g: Game) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [who, setWho] = useState<Person | undefined>();
  const [state, setState] = useState<'ready' | 'loading' | 'tap' | 'playing' | 'done'>('ready');
  const [err, setErr] = useState('');
  const vid = useRef<HTMLVideoElement>(null);
  const prev = game.turns.filter(t => !t.skipped).slice(-1)[0];
  const prevP = chat.members.find(m => m.id === prev?.who);
  const nextP = chat.members.find(m => m.id === game.order[game.idx + 1]);
  const guessing = game.idx >= game.order.length - 1;
  const watch = async () => {
    setState('loading'); setErr('');
    try {
      const l = await api.gameLook(game.id);
      setWho(chat.members.find(m => m.id === l.who));
      setSrc(await mediaUrl(l.path));
    } catch (e) { setErr((e as Error).message); setState('ready'); }
  };
  useEffect(() => {
    const v = vid.current; if (!v || !src) return;
    v.src = src; v.play().then(() => setState('playing')).catch(() => setState('tap')); // iPhone may want a fresh tap after the fetch
  }, [src]);
  const ended = async () => {
    setState('done');
    try { const g = await api.gameLooked(game.id); onCopy(g); } catch (e) { toast((e as Error).message); onClose(); }
  };
  return (
    <div className="g-look">
      <video ref={vid} playsInline className={`g-look-vid ${state === 'playing' ? 'on' : ''}`} onEnded={() => void ended()}
        onError={() => { if (vid.current?.getAttribute('src')) { setErr('That clip would not play here.'); setState('ready'); } }} />
      {state === 'playing' && who && <div className="g-look-tag"><Avatar p={who} size={24} /> {first(who)}'s take. Watch closely.</div>}
      {state !== 'playing' && (
        <div className="g-look-card">
          <div className="g-chain">{game.order.map((_, i) => <i key={i} className={i < game.idx ? 'd' : i === game.idx ? 'c' : ''} />)}</div>
          <button className="g-bigplay" onClick={() => { if (state === 'tap') { void vid.current?.play().then(() => setState('playing')); } else void watch(); }}
            disabled={state === 'loading' || state === 'done'} aria-label="Watch it once"><Icon name="play" size={42} fill="currentColor" /></button>
          <b>{first(prevP)} passed it to you</b>
          <span>{guessing
            ? `You get one look. Then say out loud what you think the phrase is.`
            : `You get one look. Watch closely, then copy exactly what you saw in ${game.turnSec} seconds. ${nextP ? `${nextP.id === me.id ? 'You' : first(nextP)} only sees yours.` : ''}`}</span>
          {err && <span className="err">{err}</span>}
          <button className="link-btn" onClick={onClose}>Not now</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the guess
export function GuessSheet({ open, initial, onSend, onRetake }: { open: boolean; initial: string; onSend: (guess: string) => void; onRetake: () => void }) {
  const [v, setV] = useState(initial);
  useEffect(() => { if (open) setV(initial); }, [open, initial]);
  return (
    <Sheet open={open} onClose={onRetake} title="What did you guess?">
      <p className="g-sub">This shows next to the real phrase in the reveal. Fix it if the captions got it wrong.</p>
      <input id="g-guess" className="field big" autoFocus maxLength={200} value={v} onChange={e => setV(e.target.value)} placeholder="a ghost at the mall?" />
      <div className="g-row-btns">
        <button className="btn" onClick={onRetake}><Icon name="undo" size={18} /> Retake</button>
        <button className="btn g-go" disabled={!v.trim()} onClick={() => onSend(v.trim())}><Icon name="send" size={18} /> Send guess</button>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- the turn banner over the camera
export function TurnBanner({ game, me, chat, phrase }: { game: Game; me: Person; chat: ChatFull; phrase: string | null }) {
  const role = roleOf(game);
  const nextP = chat.members.find(m => m.id === game.order[game.idx + 1]);
  const title = role === 'act' ? 'Act it out. No words.' : role === 'copy' ? 'Copy what you saw' : 'Say your guess out loud';
  const only = nextP ? `${nextP.id === me.id ? 'You' : first(nextP)} only sees yours.` : '';
  const sub = role === 'guess' ? 'Then type it so the reveal can show it.' : role === 'act' ? only : `No words. ${only}`;
  return (
    <>
      <div className="g-banner"><Icon name={role === 'act' ? 'chain' : 'eye'} size={24} /><span><b>{title}</b><em>{sub}</em></span></div>
      {role === 'act' && phrase && <div className="g-secret-mini"><small>Only you see this</small><p>{phrase}</p></div>}
    </>
  );
}
