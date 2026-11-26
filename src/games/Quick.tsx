// Seven Letters and Trivia: everyone plays the same letters or questions on their own time, then the scores come in.
// Rules live in supabase/games3.sql; this file deals, runs your timed go, and shows the results.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type ChatFull, type Game, type Person } from '../lib/api';
import { send as liveSend } from '../lib/live';
import { Avatar, Sheet, ago, toast } from '../ui/bits';
import { Icon } from '../ui/icons';
import { shuffle } from './content/shuffle';
import {
  TRIVIA_COUNT, TRIVIA_DECKS, TRIVIA_SEC, WORD_POINTS, allWords, answerPoints, dealRack, dropGo, loadDict, loadGo,
  pickQuestions, question, saveGo, triviaScores, wordPoints, wordsScores,
} from './quickLogic';
import { GAME_NAME, first, markUsed, owes, personIn, standings, usedIn } from './roundLogic';
import './games.css';

type QuickKind = 'words' | 'trivia';
const hours6 = (iso: string | null | undefined) => !!iso && Date.now() - new Date(iso).getTime() < 6 * 3600e3;

// ---------------------------------------------------------------- start
export function QuickStart({ open, kind, onClose, chat, me, onStarted }: {
  open: boolean; kind: QuickKind; onClose: () => void; chat: ChatFull; me: Person; onStarted: (g: Game) => void;
}) {
  const others = useMemo(() => chat.members.filter(m => m.id !== me.id), [chat.members, me.id]);
  const [who, setWho] = useState<string[]>([]);
  const [sec, setSec] = useState(90);
  const [deck, setDeck] = useState('mixed');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setWho(others.slice(0, 4).map(o => o.id)); if (kind === 'words') void loadDict().catch(() => {}); } }, [open, others, kind]);
  const toggle = (id: string) => setWho(o => (o.includes(id) ? o.filter(x => x !== id) : o.length >= 4 ? o : [...o, id]));
  const line = [me.id, ...who];
  const start = async () => {
    setBusy(true);
    try {
      let g: Game;
      if (kind === 'words') {
        const d = await loadDict();
        const key = `holler.racks.${chat.id}`;
        const { seed, rack } = dealRack(d.seeds, usedIn(key));
        g = await api.gameStart2(chat.id, 'words', line, { rack, turnSec: sec });
        markUsed(key, seed);
      } else {
        const key = `holler.trivia.${chat.id}`;
        const qids = pickQuestions(deck, usedIn(key));
        g = await api.gameStart2(chat.id, 'trivia', line, { deck, qids });
        qids.forEach(id => markUsed(key, id));
      }
      liveSend(chat.id, 'chat', { game: g.id });
      onStarted(g);
    } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  return (
    <Sheet open={open} onClose={onClose} title={GAME_NAME[kind]}>
      <p className="g-sub">{kind === 'words'
        ? 'Everyone gets the same seven letters. Make as many words as you can before the clock runs out. Longer words score more.'
        : `Everyone answers the same ${TRIVIA_COUNT} questions, ${TRIVIA_SEC} seconds each. Right answers score, faster scores more.`}</p>
      {kind === 'words' ? (<>
        <span className="lbl">Your go lasts</span>
        <div className="seg g-seg">{[60, 90, 120].map(s => <button key={s} className={sec === s ? 'on' : ''} onClick={() => setSec(s)}>{s === 60 ? '1 min' : s === 90 ? '1.5 min' : '2 min'}</button>)}</div>
      </>) : (<>
        <span className="lbl">Questions from</span>
        <div className="g-order-tools">{TRIVIA_DECKS.map(d => <button key={d.id} className={`chip ${deck === d.id ? 'on' : ''}`} onClick={() => setDeck(d.id)}>{d.label}</button>)}</div>
      </>)}
      <span className="lbl">Playing</span>
      <div className="g-order-tools">
        <span className="chip on g-me-chip"><Avatar p={me} size={18} /> You</span>
        {others.map(o => <button key={o.id} className={`chip ${who.includes(o.id) ? 'on' : ''}`} onClick={() => toggle(o.id)}><Avatar p={o} size={18} /> {first(o)}</button>)}
      </div>
      {line.length < 2 && <p className="g-warn">Pick at least 1 person to play with.</p>}
      <p className="g-fine">{kind === 'words' ? 'Nobody sees the letters until they start their go, you included.' : 'Nobody sees the questions until they start their go, you included.'}</p>
      <button className="btn g-go wide" disabled={busy || line.length < 2} onClick={() => void start()}>Start</button>
    </Sheet>
  );
}

// ---------------------------------------------------------------- the game page
export function QuickPage({ game, chat, me, onClose, onChanged }: {
  game: Game; chat: ChatFull; me: Person; onClose: () => void; onChanged: (g: Game) => void;
}) {
  const person = personIn(chat, me);
  const kind = game.kind as QuickKind;
  const playing = game.status === 'playing';
  const inGame = game.order.includes(me.id);
  const mine = owes(game, me.id);
  const played = (id: string) => (game.played || []).includes(id);
  const [going, setGoing] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api.game(game.id).then(onChanged).catch(() => {}); }, [game.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // came back mid-go (the app closed): carry on where it was
  useEffect(() => { if (mine && game.began && !played(me.id)) setGoing(true); }, [game.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (f: () => Promise<Game>, done?: string) => {
    setBusy(true);
    try { const g = await f(); onChanged(g); liveSend(chat.id, 'chat', { game: g.id }); if (done) toast(done); return g; }
    catch (e) { toast((e as Error).message); return null; }
    finally { setBusy(false); }
  };
  const begin = async () => {
    if (kind === 'words') { try { await loadDict(); } catch { toast('The word list would not load. Try again on wifi.'); return; } }
    const g = await act(() => api.gameBegin(game.id));
    if (g) setGoing(true);
  };
  const finish = async (play: { words: string[] } | { answers: { pick: number; ms: number }[] }) => {
    const g = await act(() => api.gamePlay(game.id, play));
    if (g) { dropGo(game.id); setGoing(false); }
    return !!g;
  };

  if (going && game.began && !played(me.id)) {
    return kind === 'words'
      ? <WordsGo game={game} onDone={words => finish({ words })} onClose={() => setGoing(false)} />
      : <TriviaGo game={game} onDone={answers => finish({ answers })} onClose={() => setGoing(false)} />;
  }

  const scores = kind === 'words' ? wordsScores(game) : triviaScores(game);
  const board = standings(Object.fromEntries(Object.entries(scores).filter(([id]) => played(id) || !playing)));
  const allTied = board.length > 1 && board.every(r => r.place === 1);
  const waiting = (game.todo || []).filter(id => id !== me.id);
  const seeResults = !!game.plays;

  return (
    <div className="g-page">
      <header className="g-head">
        <button className="icon-btn g-back" onClick={onClose} aria-label="Back"><Icon name="back" /></button>
        <h2>{GAME_NAME[kind]}</h2>
      </header>
      <p className="g-meta">Started by {game.createdBy === me.id ? 'you' : first(person(game.createdBy || ''))}, {ago(game.createdAt)}.
        {kind === 'words' ? ` ${game.turnSec} seconds a go.` : ` ${TRIVIA_COUNT} questions.`}</p>

      {mine && !game.began && (
        <div className="q-ready">
          <Icon name={kind === 'words' ? 'letters' : 'quiz'} size={30} />
          <b>{kind === 'words' ? 'Seven letters. As many words as you can.' : `${TRIVIA_COUNT} questions, ${TRIVIA_SEC} seconds each.`}</b>
          <span>{kind === 'words'
            ? `The clock starts when you tap. Words are 3 to 7 letters. ${Object.entries(WORD_POINTS).map(([n, p]) => `${n} letters: ${p}`).join(', ')}.`
            : 'The clock starts when you tap. Right answers score 100, plus up to 50 for speed.'}</span>
          <button className="btn g-go wide" disabled={busy} onClick={() => void begin()}>Start my go</button>
        </div>
      )}
      {mine && game.began && !played(me.id) && (
        <button className="btn g-go wide" onClick={() => setGoing(true)}>Back to my go</button>
      )}

      <ol className="g-track">
        {game.order.map(id => (
          <li key={id} className={`g-row ${playing && id === me.id && mine ? 'up' : ''}`}>
            <Avatar p={person(id)} size={38} />
            <span className="g-row-txt"><b>{id === me.id ? 'You' : first(person(id))}</b>
              <span>{played(id) ? (seeResults ? `${scores[id] || 0} points` : 'Played') : playing ? 'Hasn\'t played yet' : 'Did not play'}</span></span>
            {played(id) && !seeResults && <span className="g-lock" aria-label="Hidden until you play"><Icon name="lock" size={18} /></span>}
          </li>
        ))}
      </ol>
      {playing && inGame && !mine && <p className="g-meta">Your go is in. {waiting.length ? 'The rest unlock as people play.' : ''}</p>}

      {seeResults && board.length > 0 && (
        <div className="g-board">
          <span className="lbl">{game.status === 'done' ? (allTied ? 'Final scores: a tie' : 'Final scores') : 'Scores so far'}</span>
          {board.map(r => (
            <div key={r.id} className={`g-board-row ${r.place === 1 && r.pts > 0 && !allTied && game.status === 'done' ? 'top' : ''}`}>
              <i>{r.place}</i><Avatar p={person(r.id)} size={30} /><b>{r.id === me.id ? 'You' : first(person(r.id))}</b><em>{r.pts}</em>
            </div>
          ))}
        </div>
      )}
      {seeResults && kind === 'words' && <WordsResults game={game} me={me} person={person} />}
      {seeResults && kind === 'trivia' && <TriviaResults game={game} me={me} person={person} />}

      {playing && waiting.length > 0 && inGame && (
        <button className="btn wide" disabled={busy || hours6(game.nudgedAt)} onClick={() => void act(() => api.gameNudge(game.id), 'Nudged')}>
          {hours6(game.nudgedAt) ? `Nudged ${ago(game.nudgedAt!)}` : `Nudge ${waiting.length === 1 ? first(person(waiting[0])) : 'everyone still playing'}`}
        </button>
      )}
      {game.status === 'ended' && <p className="g-meta">This one ended before anyone played.</p>}
      <p className="g-foot">{playing ? 'Anyone who waits 2 days gets passed by, so a game never stalls.' : `Finished ${game.endedAt ? ago(game.endedAt) : ''}.`}</p>
      {playing && game.createdBy === me.id && <button className="link-btn g-endgame" onClick={() => void act(() => api.gameEnd(game.id), 'Game ended')}>End this game</button>}
    </div>
  );
}

// ---------------------------------------------------------------- the clock for a go
function useClock(endsAt: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 200); return () => clearInterval(t); }, []);
  return Math.max(0, endsAt - now);
}

// ---------------------------------------------------------------- Seven Letters: your go
function WordsGo({ game, onDone, onClose }: { game: Game; onDone: (words: string[]) => Promise<boolean>; onClose: () => void }) {
  const rack = game.rack || '';
  const saved = loadGo<{ words: string[]; order: number[] }>(game.id);
  const [dict, setDict] = useState<Set<string> | null>(null);
  const [found, setFound] = useState<string[]>(saved?.words || []);
  const [order, setOrder] = useState<number[]>(saved?.order || [0, 1, 2, 3, 4, 5, 6]);
  const [picked, setPicked] = useState<number[]>([]);
  const [note, setNote] = useState<{ text: string; good: boolean } | null>(null);
  const sent = useRef(false);
  const endsAt = new Date(game.beganAt || Date.now()).getTime() + (game.turnSec || 90) * 1000;
  const left = useClock(endsAt);
  useEffect(() => { void loadDict().then(d => setDict(d.words)).catch(() => toast('The word list would not load.')); }, []);
  useEffect(() => { saveGo(game.id, { words: found, order }); }, [found, order, game.id]);
  const [failed, setFailed] = useState(false);
  const send = async () => {
    if (sent.current) return; sent.current = true; setFailed(false);
    if (!(await onDone(found))) { sent.current = false; setFailed(true); }
  };
  useEffect(() => { if (left <= 0 && !failed) void send(); }); // eslint-disable-line react-hooks/exhaustive-deps

  const word = picked.map(i => rack[i]).join('');
  const say = (text: string, good: boolean) => { setNote({ text, good }); window.setTimeout(() => setNote(n => (n?.text === text ? null : n)), 1400); };
  const enter = () => {
    if (word.length < 3) { say('3 letters or more', false); return; }
    if (found.includes(word)) { say('Already have it', false); setPicked([]); return; }
    if (!dict?.has(word)) { say('Not in the word list', false); setPicked([]); return; }
    setFound(f => [word, ...f]); say(`${word.toUpperCase()} +${wordPoints(word)}`, true); setPicked([]);
  };
  // a keyboard works too
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { enter(); return; }
      if (e.key === 'Backspace') { setPicked(p => p.slice(0, -1)); return; }
      const ch = e.key.toLowerCase();
      if (!/^[a-z]$/.test(ch)) return;
      const i = order.find(k => rack[k] === ch && !picked.includes(k));
      if (i !== undefined) setPicked(p => [...p, i]);
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });
  const pts = found.reduce((n, w) => n + wordPoints(w), 0);
  const sec = Math.ceil(left / 1000);
  return (
    <div className="g-page q-go">
      <header className="q-go-top">
        <button className="icon-btn" onClick={onClose} aria-label="Leave for now (the clock keeps going)"><Icon name="back" /></button>
        <span className={`q-clock ${sec <= 10 ? 'low' : ''}`}>{Math.floor(sec / 60)}:{String(sec % 60).padStart(2, '0')}</span>
        <span className="q-pts">{pts} pts</span>
      </header>
      <i className="q-bar" style={{ width: `${(left / ((game.turnSec || 90) * 1000)) * 100}%` }} />
      <div className={`q-word ${note ? (note.good ? 'good' : 'bad') : ''}`}>{note ? note.text : word ? word.toUpperCase() : <em>Tap letters</em>}</div>
      <div className="q-rack">
        {order.map(i => (
          <button key={i} className={`q-tile ${picked.includes(i) ? 'used' : ''}`} disabled={picked.includes(i)} onClick={() => setPicked(p => [...p, i])}>{rack[i]?.toUpperCase()}</button>
        ))}
      </div>
      <div className="q-tools">
        <button className="btn" onClick={() => setOrder(o => shuffle(o))} aria-label="Shuffle the letters"><Icon name="shuffle" size={18} /></button>
        <button className="btn" onClick={() => setPicked(p => p.slice(0, -1))} disabled={!picked.length}><Icon name="undo" size={18} /> Back</button>
        <button className="btn g-go" onClick={enter} disabled={!word || !dict}>Enter</button>
      </div>
      <div className="q-found">
        <span className="lbl">{found.length} {found.length === 1 ? 'word' : 'words'}</span>
        <p>{found.map(w => <span key={w} className={w.length === 7 ? 'seven' : ''}>{w}</span>)}</p>
      </div>
      {failed
        ? <button className="btn g-go wide" onClick={() => void send()}>That didn't go through. Hand it in again</button>
        : <button className="link-btn" onClick={() => void send()}>{left <= 0 ? 'Handing it in...' : "I'm done, hand it in"}</button>}
    </div>
  );
}

function WordsResults({ game, me, person }: { game: Game; me: Person; person: (id: string) => Person | undefined }) {
  const [all, setAll] = useState<string[] | null>(null);
  const rack = game.rack || '';
  useEffect(() => { void loadDict().then(d => setAll(allWords(d.words, rack))).catch(() => {}); }, [rack]);
  const plays = game.plays || {};
  const by = new Map<string, string[]>();
  for (const [who, p] of Object.entries(plays)) for (const w of p.words || []) by.set(w, [...(by.get(w) || []), who]);
  const missed = (all || []).filter(w => !by.has(w) && w.length >= 4); // longest first; short ones are mostly odd
  const sevens = (all || []).filter(w => w.length === 7);
  return (
    <div className="q-results">
      <div className="q-rack sm">{[...rack].map((ch, i) => <span key={i} className="q-tile">{ch.toUpperCase()}</span>)}</div>
      {sevens.length > 0 && <p className="g-meta">The seven-letter {sevens.length === 1 ? 'word' : 'words'}: <b>{sevens.join(', ')}</b></p>}
      {Object.entries(plays).map(([who, p]) => (
        <div key={who} className="q-person">
          <span className="q-person-h"><Avatar p={person(who)} size={22} /> {who === me.id ? 'You' : first(person(who))}: {(p.words || []).length} words</span>
          <p>{[...(p.words || [])].sort((a, b) => b.length - a.length || a.localeCompare(b)).map(w => (
            <span key={w} className={`${(by.get(w) || []).length === 1 && Object.keys(plays).length > 1 ? 'only' : ''} ${w.length === 7 ? 'seven' : ''}`}>{w}</span>
          ))}</p>
        </div>
      ))}
      {Object.keys(plays).length > 1 && <p className="g-fine">Underlined: only one person found it.</p>}
      {missed.length > 0 && (
        <div className="q-person">
          <span className="q-person-h">Longest words nobody found</span>
          <p className="q-missed">{missed.slice(0, 12).map(w => <span key={w}>{w}</span>)}</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Trivia: your go
function TriviaGo({ game, onDone, onClose }: { game: Game; onDone: (answers: { pick: number; ms: number }[]) => Promise<boolean>; onClose: () => void }) {
  const qids = game.qids || [];
  const saved = loadGo<{ answers: { pick: number; ms: number }[] }>(game.id);
  const [answers, setAnswers] = useState<{ pick: number; ms: number }[]>(saved?.answers || []);
  const [shownAt, setShownAt] = useState(Date.now());
  const [reveal, setReveal] = useState<number | null>(null); // the pick being shown right or wrong
  const sent = useRef(false);
  const i = answers.length;
  const q = question(qids[i]);
  const left = useClock(shownAt + TRIVIA_SEC * 1000);
  useEffect(() => { saveGo(game.id, { answers }); }, [answers, game.id]);
  const [failed, setFailed] = useState(false);
  const handIn = async () => {
    if (sent.current) return; sent.current = true; setFailed(false);
    if (!(await onDone(answers))) { sent.current = false; setFailed(true); }
  };
  useEffect(() => {
    if (i >= qids.length && qids.length) void handIn();
  }, [i, qids.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const answer = (pick: number) => {
    if (reveal !== null || i >= qids.length) return;
    const ms = Math.min(TRIVIA_SEC * 1000, Date.now() - shownAt);
    setReveal(pick);
    window.setTimeout(() => { setAnswers(a => [...a, { pick, ms }]); setReveal(null); setShownAt(Date.now()); }, pick === -1 ? 1300 : 1000);
  };
  useEffect(() => { if (left <= 0 && reveal === null && i < qids.length) answer(-1); }); // eslint-disable-line react-hooks/exhaustive-deps
  if (!q) return (
    <div className="g-page q-go">
      <p className="g-meta">{failed ? "Your answers didn't go through." : 'Sending your answers...'}</p>
      {failed && <><button className="btn g-go wide" onClick={() => void handIn()}>Try again</button><button className="link-btn" onClick={onClose}>Back</button></>}
    </div>
  );
  const sec = Math.ceil(left / 1000);
  const total = answers.reduce((n, a, k) => n + answerPoints(question(qids[k]), a), 0);
  return (
    <div className="g-page q-go">
      <header className="q-go-top">
        <button className="icon-btn" onClick={onClose} aria-label="Leave for now"><Icon name="back" /></button>
        <span className="q-count">{i + 1} of {qids.length}</span>
        <span className="q-pts">{total} pts</span>
      </header>
      <i className="q-bar" style={{ width: `${reveal !== null ? 0 : (left / (TRIVIA_SEC * 1000)) * 100}%` }} />
      <div className="q-q">
        <small>{q.cat === 'random' ? 'Random' : q.cat.charAt(0).toUpperCase() + q.cat.slice(1)}{reveal === null ? ` · ${sec}` : ''}</small>
        <p>{q.q}</p>
      </div>
      <div className="q-opts">
        {q.options.map((o, k) => (
          <button key={k} className={`q-opt ${reveal !== null && k === q.answer ? 'right' : ''} ${reveal === k && k !== q.answer ? 'wrong' : ''}`}
            disabled={reveal !== null} onClick={() => answer(k)}>{o}</button>
        ))}
      </div>
      {reveal === -1 && <p className="q-note">Out of time</p>}
      {reveal !== null && reveal >= 0 && <p className="q-note">{reveal === q.answer ? 'Right' : 'Not quite'}</p>}
    </div>
  );
}

function TriviaResults({ game, me, person }: { game: Game; me: Person; person: (id: string) => Person | undefined }) {
  const plays = Object.entries(game.plays || {});
  return (
    <div className="q-results">
      <span className="lbl">The questions</span>
      {(game.qids || []).map((id, k) => {
        const q = question(id); if (!q) return null;
        return (
          <div key={id} className="q-review">
            <p>{k + 1}. {q.q}</p>
            <b>{q.options[q.answer]}</b>
            <span className="q-marks">{plays.map(([who, p]) => {
              const a = p.answers?.[k]; const ok = a?.pick === q.answer;
              return <span key={who} className={`q-mark ${ok ? 'ok' : ''}`} title={who === me.id ? 'You' : first(person(who))}>
                <Avatar p={person(who)} size={20} />{ok ? <Icon name="check" size={14} /> : <Icon name="close" size={14} />}
                {!ok && a && a.pick >= 0 && <em>{q.options[a.pick]}</em>}
              </span>;
            })}</span>
          </div>
        );
      })}
    </div>
  );
}
