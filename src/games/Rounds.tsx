// Poker Face and Charades Relay screens. Both are "everyone at once": nobody waits on a turn order.
// Rules live in the database (supabase/games2.sql); these screens show state and call the RPCs.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, mediaUrl, publicUrl, type ChatFull, type CharadesAct, type Game, type Person } from '../lib/api';
import { send as liveSend } from '../lib/live';
import { Avatar, Sheet, ago, toast } from '../ui/bits';
import { Icon } from '../ui/icons';
import { shuffle } from './content/shuffle';
import {
  CHARADES_DECKS, GAME_NAME, POKER_DECKS, charadesScores, first, guessPoints, markUsed, owes, personIn, pokerCards, pokerScores,
  standings, usedIn, type PokerDeck,
} from './roundLogic';
import './games.css';

const hours6 = (iso: string | null) => !!iso && Date.now() - new Date(iso).getTime() < 6 * 3600e3;

// ---------------------------------------------------------------- start a round game
export function RoundStart({ open, kind, onClose, chat, me, onStarted }: {
  open: boolean; kind: 'poker' | 'charades'; onClose: () => void; chat: ChatFull; me: Person; onStarted: (g: Game) => void;
}) {
  const others = useMemo(() => chat.members.filter(m => m.id !== me.id), [chat.members, me.id]);
  const [who, setWho] = useState<string[]>([]);
  const [pdeck, setPdeck] = useState<PokerDeck>('facts');
  const [ci, setCi] = useState(0);
  const [cdeck, setCdeck] = useState('mixed');
  const [sec, setSec] = useState(15);
  const [busy, setBusy] = useState(false);
  const usedKey = `holler.poker.${chat.id}`;
  const cards = useMemo(() => pokerCards(pdeck, usedIn(usedKey)), [pdeck, usedKey, open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) { setWho(others.slice(0, 4).map(o => o.id)); setCi(0); } }, [open, others]);
  const card = cards[ci % cards.length];
  const line = [me.id, ...who];
  const min = kind === 'poker' ? 3 : 2;
  const toggle = (id: string) => setWho(o => (o.includes(id) ? o.filter(x => x !== id) : o.length >= 4 ? o : [...o, id]));
  const start = async () => {
    setBusy(true);
    try {
      const g = kind === 'poker'
        ? await api.gameStart2(chat.id, 'poker', shuffle(line), { deck: pdeck, cardId: card.id, question: card.question, answer: card.answer })
        : await api.gameStart2(chat.id, 'charades', line, { turnSec: sec, deck: cdeck });
      if (kind === 'poker') markUsed(usedKey, card.id);
      liveSend(chat.id, 'chat', { game: g.id });
      onStarted(g);
    } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  return (
    <Sheet open={open} onClose={onClose} title={GAME_NAME[kind]}>
      <p className="g-sub">{kind === 'poker'
        ? 'Everyone records an answer to the same question, straight to camera. One of you is secretly handed the real answer. Then everyone votes on who was telling the truth.'
        : 'Everyone acts out their own secret word, no talking. Everyone else watches and guesses. The sooner you get it, the more it scores.'}</p>
      {kind === 'poker' ? (<>
        <div className="seg g-seg">{POKER_DECKS.map(d => <button key={d.id} className={pdeck === d.id ? 'on' : ''} onClick={() => { setPdeck(d.id); setCi(0); }}>{d.label}</button>)}</div>
        <div className="g-secret g-open">
          <small>Everyone sees this</small>
          <p>{card?.question}</p>
          <button className="chip" onClick={() => setCi(i => i + 1)}><Icon name="shuffle" size={15} /> Another one</button>
        </div>
        <p className="g-fine">Not even you know who gets the real answer. You might.</p>
      </>) : (<>
        <span className="lbl">Words from</span>
        <div className="g-order-tools">{CHARADES_DECKS.map(d => <button key={d.id} className={`chip ${cdeck === d.id ? 'on' : ''}`} onClick={() => setCdeck(d.id)}>{d.label}</button>)}</div>
        <span className="lbl">Each act</span>
        <div className="seg g-seg">{[10, 15, 20].map(s => <button key={s} className={sec === s ? 'on' : ''} onClick={() => setSec(s)}>{s} sec</button>)}</div>
      </>)}
      <span className="lbl">Playing</span>
      <div className="g-order-tools">
        <span className="chip on g-me-chip"><Avatar p={me} size={18} /> You</span>
        {others.map(o => <button key={o.id} className={`chip ${who.includes(o.id) ? 'on' : ''}`} onClick={() => toggle(o.id)}><Avatar p={o} size={18} /> {first(o)}</button>)}
      </div>
      {line.length < min && <p className="g-warn">{kind === 'poker' ? 'Poker Face needs at least 3 people.' : 'Pick at least 1 person to play with.'}</p>}
      <button className="btn g-go wide" disabled={busy || line.length < min} onClick={() => void start()}>
        {kind === 'poker' ? 'Start and record my answer' : 'Start and act mine'}
      </button>
    </Sheet>
  );
}

// ---------------------------------------------------------------- the banner over the camera during a round turn
export function RoundBanner({ game, word, recording, onAnother }: { game: Game; word: string | null; recording: boolean; onAnother: () => void }) {
  if (game.kind === 'poker') return (<>
    <div className="g-banner"><Icon name={game.truthIsMe ? 'eye' : 'facecam'} size={24} />
      <span><b>{game.truthIsMe ? 'You have the real answer' : 'Make one up. Sell it.'}</b>
        <em>{game.truthIsMe ? 'Say it straight. They are reading your face.' : 'One of you has the truth. Make them think it is you.'}</em></span></div>
    {game.truthIsMe && game.answer && <div className="g-secret-mini g-low"><small>Only you see this. The real answer:</small><p>{game.answer}</p></div>}
  </>);
  return (<>
    <div className="g-banner"><Icon name="chain" size={24} /><span><b>Act it out. No words.</b><em>{game.turnSec} seconds. Everyone else guesses.</em></span></div>
    {word && (
      <div className="g-secret-mini g-word">
        <small>Only you see this</small><p>{word}</p>
        {!recording && <button className="chip" onClick={onAnother}><Icon name="shuffle" size={14} /> Another word</button>}
      </div>
    )}
  </>);
}

// ---------------------------------------------------------------- game page
export function RoundPage({ game, chat, me, onClose, onTakeTurn, onWatch, onGuess, onChanged }: {
  game: Game; chat: ChatFull; me: Person; onClose: () => void; onTakeTurn: (g: Game) => void;
  onWatch: (g: Game) => void; onGuess: (g: Game, a: CharadesAct) => void; onChanged: (g: Game) => void;
}) {
  const person = personIn(chat, me);
  const playing = game.status === 'playing';
  const act = async (f: () => Promise<Game>, done?: string) => {
    try { const g = await f(); onChanged(g); liveSend(chat.id, 'chat', { game: g.id }); if (done) toast(done); } catch (e) { toast((e as Error).message); }
  };
  useEffect(() => { void api.game(game.id).then(onChanged).catch(() => {}); }, [game.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = (game.todo || []).filter(id => id !== me.id);
  const scores = game.kind === 'poker' ? pokerScores(game) : charadesScores(game);
  const board = standings(scores);
  const allTied = board.every(r => r.place === 1);
  const showBoard = game.kind === 'charades' ? board.some(r => r.pts > 0) : game.status === 'done';

  return (
    <div className="g-page">
      <header className="g-head">
        <button className="icon-btn g-back" onClick={onClose} aria-label="Back"><Icon name="back" /></button>
        <h2>{GAME_NAME[game.kind]}</h2>
      </header>
      <p className="g-meta">Started by {game.createdBy === me.id ? 'you' : first(person(game.createdBy || ''))}, {ago(game.createdAt)}.
        {game.kind === 'charades' ? ` ${game.turnSec} seconds an act.` : ''}</p>

      {game.kind === 'poker' && <PokerBody game={game} me={me} person={person} onTakeTurn={onTakeTurn} onWatch={onWatch} />}
      {game.kind === 'charades' && <CharadesBody game={game} me={me} person={person} onTakeTurn={onTakeTurn} onGuess={onGuess} />}

      {showBoard && (
        <div className="g-board">
          <span className="lbl">{game.status === 'done' ? (allTied && board.length > 1 ? 'Final scores: a tie' : 'Final scores') : 'Scores so far'}</span>
          {board.map(r => (
            <div key={r.id} className={`g-board-row ${r.place === 1 && r.pts > 0 && !allTied ? 'top' : ''}`}>
              <i>{r.place}</i><Avatar p={person(r.id)} size={30} /><b>{r.id === me.id ? 'You' : first(person(r.id))}</b><em>{r.pts}</em>
            </div>
          ))}
          <p className="g-fine">{game.kind === 'poker'
            ? 'Find the truth: 2. Each person who believes your answer: 1.'
            : 'Get it in the first third of the clip: 3, the middle: 2, the end: 1. The actor gets 1 for everyone who got theirs.'}</p>
        </div>
      )}

      {playing && waiting.length > 0 && (
        <button className="btn wide" onClick={() => void act(() => api.gameNudge(game.id), 'Nudged')} disabled={hours6(game.nudgedAt)}>
          {hours6(game.nudgedAt) ? `Nudged ${ago(game.nudgedAt!)}` : game.kind === 'poker' && game.phase === 'vote' ? 'Nudge the voters' : `Nudge ${waiting.length === 1 ? first(person(waiting[0])) : 'everyone still playing'}`}
        </button>
      )}
      {!playing && !game.hidden && (
        <button className={`btn wide ${game.savedAt ? '' : 'g-go'}`} onClick={() => void act(() => api.gameSave(game.id, !game.savedAt), game.savedAt ? 'Not saved' : 'Saved. These clips stay.')}>
          <Icon name="star" size={18} fill={game.savedAt ? 'currentColor' : undefined} /> {game.savedAt ? 'Saved' : 'Save these clips'}
        </button>
      )}
      <p className="g-foot">{playing
        ? 'Anyone who waits 2 days gets passed by, so a game never stalls.'
        : game.savedAt ? 'Saved, so these clips stay.' : game.hidden ? 'These clips are hidden now.' : `Clips hide ${game.hidesAt ? new Date(game.hidesAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'in a week'} unless someone saves them.`}</p>
      {playing && game.createdBy === me.id && <button className="link-btn g-endgame" onClick={() => void act(() => api.gameEnd(game.id), 'Game ended')}>End this game</button>}
    </div>
  );
}

function PokerBody({ game, me, person, onTakeTurn, onWatch }: {
  game: Game; me: Person; person: (id: string) => Person | undefined; onTakeTurn: (g: Game) => void; onWatch: (g: Game) => void;
}) {
  const playing = game.status === 'playing';
  const answered = (id: string) => (game.recorded || []).includes(id);
  const iAnswered = answered(me.id);
  const voters = game.order.length - 1;
  return (<>
    <div className="g-secret g-open"><small>The question</small><p>{game.question}</p></div>
    {playing && game.truthIsMe && game.answer && <div className="g-secret"><small>Only you see this. You have the real answer.</small><p>{game.answer}</p></div>}
    {playing && game.phase === 'record' && !game.truthIsMe && !iAnswered && <p className="g-meta">You don't have the answer, so make one up and sell it. Somebody here has the real one.</p>}
    {!playing && game.answer && (
      <div className="g-pair">
        <div className="g-box truth"><small><Avatar p={person(game.truth || '')} size={18} /> {game.truth === me.id ? 'You' : first(person(game.truth || ''))} had it</small><p>{game.answer}</p></div>
      </div>
    )}
    <ol className="g-track">
      {game.order.map(id => {
        const p = person(id);
        const sub = !playing
          ? id === game.truth ? 'Told the truth' : `Made it up${Object.values(game.votes || {}).filter(v => v === id).length ? `, fooled ${Object.values(game.votes || {}).filter(v => v === id).length}` : ''}`
          : game.phase === 'vote' ? (answered(id) ? 'Answered' : 'Passed by') : answered(id) ? 'Answered' : 'Has to answer';
        const up = playing && game.phase === 'record' && !answered(id);
        return (
          <li key={id} className={`g-row ${up && id === me.id ? 'up' : ''}`}>
            <Avatar p={p} size={38} />
            <span className="g-row-txt"><b>{id === me.id ? 'You' : first(p)}</b><span>{sub}</span></span>
            {playing && answered(id) && game.phase === 'record' && <span className="g-lock" aria-label="Locked until everyone answers"><Icon name="lock" size={18} /></span>}
            {!playing && game.votes?.[id] && <span className="g-voted">picked <Avatar p={person(game.votes[id])} size={20} /></span>}
          </li>
        );
      })}
    </ol>
    {playing && game.phase === 'vote' && <p className="g-meta">{(game.voted || []).length} of {voters} votes in.</p>}
    {playing && game.phase === 'record' && !iAnswered && <button className="btn g-go wide" onClick={() => onTakeTurn(game)}>Record your answer</button>}
    {playing && game.phase === 'record' && iAnswered && <p className="g-meta">Your answer is in. The answers unlock once everyone has gone.</p>}
    {playing && game.phase === 'vote' && owes(game, me.id) && <button className="btn g-go wide" onClick={() => onWatch(game)}><Icon name="play" size={16} fill="currentColor" /> Watch the answers and vote</button>}
    {playing && game.phase === 'vote' && !owes(game, me.id) && <button className="btn wide" onClick={() => onWatch(game)}><Icon name="play" size={16} fill="currentColor" /> Watch the answers</button>}
    {!playing && game.clips && game.clips.length > 0 && <button className="btn g-go wide" onClick={() => onWatch(game)}><Icon name="play" size={16} fill="currentColor" /> Watch the answers again</button>}
    {game.status === 'ended' && <p className="g-meta">This one ended before the answers were in.</p>}
  </>);
}

function CharadesBody({ game, me, person, onTakeTurn, onGuess }: {
  game: Game; me: Person; person: (id: string) => Person | undefined; onTakeTurn: (g: Game) => void; onGuess: (g: Game, a: CharadesAct) => void;
}) {
  const playing = game.status === 'playing';
  const acts = game.acts || [];
  const mineDone = (game.acted || []).includes(me.id);
  const notYet = game.order.filter(id => !(game.acted || []).includes(id));
  const others = game.order.length - 1;
  return (<>
    {playing && !mineDone && <button className="btn g-go wide" onClick={() => onTakeTurn(game)}>Act yours</button>}
    <ol className="g-track">
      {acts.map(a => {
        const p = person(a.who); const mine = a.who === me.id;
        const got = Object.values(a.results || {}).filter(r => r.ok).length;
        const r = a.mine;
        const sub = mine ? `Your word: ${a.word}. ${got} of ${others} got it.`
          : r?.ok ? `You got it: ${a.word}. +${guessPoints(r.t, a.clip?.duration || game.turnSec)}`
          : r?.done ? `Missed. It was ${a.word}.`
          : !playing ? `It was ${a.word}.`
          : r?.tries ? `${3 - r.tries} ${3 - r.tries === 1 ? 'try' : 'tries'} left`
          : 'Not guessed yet';
        const todo = playing && !mine && !r?.done;
        return (
          <li key={a.who} className={`g-row ${todo ? 'up' : ''}`}>
            <button className="g-thumb" onClick={() => a.clip && onGuess(game, a)} disabled={!a.clip} aria-label={todo ? `Guess ${first(p)}'s` : `Watch ${first(p)}'s`}>
              {a.clip?.thumb ? <img src={publicUrl(a.clip.thumb)} alt="" /> : <span className="g-thumb-blank" />}
              <span className="g-thumb-av"><Avatar p={p} size={18} /></span>
            </button>
            <span className="g-row-txt"><b>{mine ? 'You acted' : `${first(p)} acted`}</b><span>{sub}</span></span>
            {todo && a.clip && <button className="btn g-go g-row-btn" onClick={() => onGuess(game, a)}>Guess</button>}
          </li>
        );
      })}
      {playing && notYet.map(id => (
        <li key={id} className="g-row">
          <Avatar p={person(id)} size={38} />
          <span className="g-row-txt"><b>{id === me.id ? 'You' : first(person(id))}</b><span>Hasn't acted yet</span></span>
        </li>
      ))}
    </ol>
    {game.status === 'ended' && <p className="g-meta">This one ended before anyone acted.</p>}
  </>);
}

// ---------------------------------------------------------------- Poker Face: watch the answers, then vote (or see who lied)
export function PokerWatch({ game: g0, chat, me, onClose, onChanged }: {
  game: Game; chat: ChatFull; me: Person; onClose: () => void; onChanged: (g: Game) => void;
}) {
  const [game, setGame] = useState(g0);
  const person = personIn(chat, me);
  const clips = useMemo(() => [...(game.clips || [])].sort((a, b) => (a.gameTurn ?? 0) - (b.gameTurn ?? 0)), [game.clips]);
  const voting = game.status === 'playing' && owes(game, me.id);
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<'watch' | 'pick'>(clips.length ? 'watch' : 'pick');
  const [needTap, setNeedTap] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const vid = useRef<HTMLVideoElement>(null);
  const clip = clips[i];

  useEffect(() => {
    if (phase !== 'watch' || !clip?.path) return;
    let gone = false;
    void mediaUrl(clip.path).then(u => {
      const v = vid.current; if (gone || !v) return;
      v.src = u; v.play().then(() => setNeedTap(false)).catch(() => setNeedTap(true));
    });
    const n = clips[i + 1]; if (n?.path) void mediaUrl(n.path);
    return () => { gone = true; };
  }, [i, phase, clip?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = () => { if (i + 1 < clips.length) setI(i + 1); else { vid.current?.pause(); setPhase('pick'); } };
  const replay = (k: number) => { setI(k); setPhase('watch'); };

  const vote = async () => {
    if (!pick) return; setBusy(true);
    try {
      const g = await api.gameVote(game.id, pick); setGame(g); onChanged(g); liveSend(chat.id, 'chat', { game: g.id });
      if (g.status === 'playing') { toast('Vote in. You see who lied once everyone votes.'); onClose(); }
    } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  const done = game.status !== 'playing';
  const votesFor = (id: string) => Object.entries(game.votes || {}).filter(([, v]) => v === id).map(([k]) => k);

  return (
    <div className="g-reveal">
      {phase === 'watch' && clip && (<>
        <video ref={vid} playsInline className="g-rv-vid" onEnded={next} onClick={() => { if (needTap) void vid.current?.play().then(() => setNeedTap(false)); else next(); }} />
        <div className="g-rv-bars">{clips.map((c, k) => <i key={c.id}><b style={{ width: k < i ? '100%' : k > i ? '0%' : '50%' }} /></i>)}</div>
        <div className="g-rv-top">
          <span className="g-rv-ic"><Icon name="facecam" size={22} /></span>
          <span className="g-rv-who"><b>Poker Face</b><span>{done ? 'Watch them lie' : 'Who is telling the truth?'}</span></span>
          <button className="icon-btn glass" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="g-rv-label"><Avatar p={person(clip.author)} size={26} /> {i + 1} of {clips.length} {clip.author === me.id ? 'You' : first(person(clip.author))}
          {done && clip.author === game.truth && <em className="g-truth-tag">the truth</em>}</div>
        {needTap && <div className="paused tap g-rv-tap"><Icon name="play" size={56} fill="currentColor" /><span>Tap to play</span></div>}
        <button className="g-rv-skip" onClick={next}>{i + 1 < clips.length ? 'Next' : voting ? 'Vote' : done ? 'See who lied' : 'Done'}</button>
      </>)}

      {phase === 'pick' && (
        <div className="g-end g-pick">
          <button className="icon-btn glass g-rv-x" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
          <div className="g-box"><small>{done ? 'The question' : voting ? 'Who is telling the truth?' : 'The question'}</small><p>{game.question}</p></div>
          {done && game.answer && <div className="g-box truth"><small>The real answer</small><p>{game.answer}</p></div>}
          <div className="g-picks">
            {clips.map((c, k) => {
              const p = person(c.author); const self = c.author === me.id;
              const vf = votesFor(c.author);
              return (
                <button key={c.id} className={`g-pk ${pick === c.author ? 'on' : ''} ${done && c.author === game.truth ? 'truth' : ''}`}
                  disabled={voting && self} onClick={() => (voting && !self ? setPick(c.author) : replay(k))}>
                  {c.thumb ? <img src={publicUrl(c.thumb)} alt="" /> : <span className="g-fr-blank" />}
                  <span className="g-pk-name"><Avatar p={p} size={20} /> {self ? 'You' : first(p)}</span>
                  {done && c.author === game.truth && <span className="g-pk-tag">Truth</span>}
                  {done && vf.length > 0 && <span className="g-pk-votes">{vf.map(v => <Avatar key={v} p={person(v)} size={18} />)}</span>}
                  {!done && game.myVote === c.author && <span className="g-pk-tag">Your vote</span>}
                </button>
              );
            })}
          </div>
          {voting && <button className="btn g-go wide" disabled={!pick || busy} onClick={() => void vote()}>{pick ? `Lock in ${pick === me.id ? 'you' : first(person(pick))}` : 'Tap the one telling the truth'}</button>}
          {!voting && !done && <p className="g-fine">{game.truthIsMe ? 'You had the real answer, so you sit the vote out.' : game.myVote ? 'Your vote is in. Everyone finds out together.' : ''}</p>}
          {clips.length > 0 && <button className="btn wide" onClick={() => replay(0)}><Icon name="play" size={16} fill="currentColor" /> Watch them again</button>}
          {voting && <p className="g-fine">Tap a face to pick. Tap Watch them again to see them all once more.</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Charades Relay: watch one act and guess it
export function CharadesGuess({ game, act, chat, me, onClose, onChanged }: {
  game: Game; act: CharadesAct; chat: ChatFull; me: Person; onClose: () => void; onChanged: (g: Game) => void;
}) {
  const person = personIn(chat, me);
  const actor = person(act.who);
  const canGuess = game.status === 'playing' && act.who !== me.id && !act.mine?.done;
  const vid = useRef<HTMLVideoElement>(null);
  const [needTap, setNeedTap] = useState(false);
  const [asking, setAsking] = useState(false);
  const [t, setT] = useState(0);
  const [text, setText] = useState('');
  const [tries, setTries] = useState(act.mine?.tries || 0);
  const [result, setResult] = useState<{ ok: boolean; word: string; pts: number } | null>(null);
  const settled = () => (act.word ? { ok: !!act.mine?.ok, word: act.word, pts: act.mine?.ok ? guessPoints(act.mine.t, act.clip?.duration || game.turnSec) : 0 } : null);
  const [ended, setEnded] = useState(false);
  const [busy, setBusy] = useState(false);
  const watchOnly = !canGuess;

  useEffect(() => {
    if (!act.clip?.path) return;
    let gone = false;
    void mediaUrl(act.clip.path).then(u => {
      const v = vid.current; if (gone || !v) return;
      v.src = u; v.play().then(() => setNeedTap(false)).catch(() => setNeedTap(true));
    });
    return () => { gone = true; };
  }, [act.clip?.path]);

  const know = () => { const v = vid.current; if (!v) return; v.pause(); setT(v.currentTime || 0); setAsking(true); };
  const send = async () => {
    const g = text.trim(); if (!g) return; setBusy(true);
    try {
      const r = await api.gameGuess(game.id, act.who, g, t);
      onChanged(r.game); liveSend(chat.id, 'chat', { game: game.id });
      setTries(r.tries); setText('');
      if (r.done) { setAsking(false); setResult({ ok: r.ok, word: r.word || '', pts: r.ok ? guessPoints(t, act.clip?.duration || vid.current?.duration || game.turnSec) : 0 }); }
      else { toast(`Not it. ${3 - r.tries} ${3 - r.tries === 1 ? 'try' : 'tries'} left.`); if (!ended) { setAsking(false); void vid.current?.play(); } }
    } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };

  return (
    <div className="g-reveal g-guess">
      <video ref={vid} playsInline className="g-rv-vid" onClick={() => { if (needTap) void vid.current?.play().then(() => setNeedTap(false)); }}
        onEnded={() => { setEnded(true); if (canGuess && !result) { setT(vid.current?.duration || game.turnSec); setAsking(true); } else if (watchOnly && !result) setResult(settled()); }} />
      <div className="g-rv-top">
        <span className="g-rv-ic"><Icon name="chain" size={22} /></span>
        <span className="g-rv-who"><b>{first(actor)} is acting</b><span>{watchOnly ? (act.word ? `It was ${act.word}` : 'Charades Relay') : `${3 - tries} ${3 - tries === 1 ? 'try' : 'tries'} left. Sooner scores more.`}</span></span>
        <button className="icon-btn glass" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      </div>
      {needTap && <div className="paused tap g-rv-tap"><Icon name="play" size={56} fill="currentColor" /><span>Tap to play</span></div>}
      {canGuess && !asking && !result && <button className="btn g-go g-know" onClick={know}>I know it</button>}
      {asking && !result && (
        <form className="g-guessbar" onSubmit={e => { e.preventDefault(); void send(); }}>
          <span className="g-guess-t">You stopped it at {t.toFixed(1)} s</span>
          <input id="g-guess" className="field big" autoFocus maxLength={80} value={text} onChange={e => setText(e.target.value)} placeholder="What is it?" autoComplete="off" autoCapitalize="off" />
          <div className="g-row-btns">
            {!ended && <button type="button" className="btn" onClick={() => { setAsking(false); void vid.current?.play(); }}>Keep watching</button>}
            <button type="submit" className="btn g-go" disabled={!text.trim() || busy}><Icon name="send" size={18} /> Guess</button>
          </div>
        </form>
      )}
      {result && (
        <div className={`g-result ${result.ok ? 'ok' : ''}`}>
          <small>{watchOnly && act.who === me.id ? 'Your word' : result.ok ? `You got it. +${result.pts}` : 'It was'}</small>
          <p>{result.word}</p>
          <span className="g-row-btns">{watchOnly && <button className="btn" onClick={() => { setResult(null); setEnded(false); void vid.current?.play(); }}><Icon name="play" size={16} fill="currentColor" /> Again</button>}
            <button className="btn g-go" onClick={onClose}>Done</button></span>
        </div>
      )}
    </div>
  );
}

