// On The Spot: three questions each, shown only once you start recording. You answer on camera against a
// 10 second clock, so everyone gets to watch you sweat. Rules live in supabase/games4.sql.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, mediaUrl, publicUrl, type ChatFull, type Game, type Person, type Polo, type SpotTake } from '../lib/api';
import { send as liveSend } from '../lib/live';
import type { Studio } from '../lib/studio';
import { Avatar, Sheet, ago, toast } from '../ui/bits';
import { Icon } from '../ui/icons';
import { QUESTIONS } from './content/quiz';
import { freshFirst, shuffle } from './content/shuffle';
import { TRIVIA_DECKS, answerPoints, question } from './quickLogic';
import { GAME_NAME, first, markUsed, owes, personIn, standings, usedIn } from './roundLogic';
import './games.css';

export const SPOT_SEC = 10;
type Pick = { pick: number; ms: number };
const hours6 = (iso: string | null | undefined) => !!iso && Date.now() - new Date(iso).getTime() < 6 * 3600e3;

/** Three questions per person (easy, medium, hard), nobody sharing one, fresh ones first. */
function dealSpot(people: string[], deck: string, used: string[]): Record<string, string[]> {
  const pool = freshFirst(shuffle(deck === 'mixed' ? QUESTIONS : QUESTIONS.filter(q => q.cat === deck)), q => q.id, used);
  const taken = new Set<string>(); const out: Record<string, string[]> = {};
  for (const id of people) {
    out[id] = [1, 2, 3].map(d => {
      const q = pool.find(x => !taken.has(x.id) && x.difficulty === d) || pool.find(x => !taken.has(x.id))!;
      taken.add(q.id); return q.id;
    });
  }
  return out;
}

export function spotScores(g: Game): Record<string, number> {
  const s: Record<string, number> = Object.fromEntries(g.order.map(id => [id, 0]));
  for (const t of g.takes || []) s[t.who] = t.qids.reduce((n, id, i) => n + answerPoints(question(id), t.picks[i]), 0);
  return s;
}

// ---------------------------------------------------------------- start
export function SpotStart({ open, onClose, chat, me, onStarted }: {
  open: boolean; onClose: () => void; chat: ChatFull; me: Person; onStarted: (g: Game) => void;
}) {
  const others = useMemo(() => chat.members.filter(m => m.id !== me.id), [chat.members, me.id]);
  const [who, setWho] = useState<string[]>([]);
  const [deck, setDeck] = useState('mixed');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setWho(others.slice(0, 4).map(o => o.id)); }, [open, others]);
  const toggle = (id: string) => setWho(o => (o.includes(id) ? o.filter(x => x !== id) : o.length >= 4 ? o : [...o, id]));
  const line = [me.id, ...who];
  const start = async () => {
    setBusy(true);
    try {
      const key = `holler.trivia.${chat.id}`;
      const qids = dealSpot(line, deck, usedIn(key));
      const g = await api.gameStart2(chat.id, 'spot', line, { deck, qids });
      Object.values(qids).flat().forEach(id => markUsed(key, id));
      liveSend(chat.id, 'chat', { game: g.id });
      onStarted(g);
    } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  return (
    <Sheet open={open} onClose={onClose} title="On The Spot">
      <p className="g-sub">Three trivia questions each, on camera. They only appear once you start recording, with {SPOT_SEC} seconds for each. Say it out loud, tap your answer, and everyone watches you sweat.</p>
      <span className="lbl">Questions from</span>
      <div className="g-order-tools">{TRIVIA_DECKS.map(d => <button key={d.id} className={`chip ${deck === d.id ? 'on' : ''}`} onClick={() => setDeck(d.id)}>{d.label}</button>)}</div>
      <span className="lbl">Playing</span>
      <div className="g-order-tools">
        <span className="chip on g-me-chip"><Avatar p={me} size={18} /> You</span>
        {others.map(o => <button key={o.id} className={`chip ${who.includes(o.id) ? 'on' : ''}`} onClick={() => toggle(o.id)}><Avatar p={o} size={18} /> {first(o)}</button>)}
      </div>
      {line.length < 2 && <p className="g-warn">Pick at least 1 person to play with.</p>}
      <p className="g-fine">Everyone gets different questions of the same difficulty. Nobody sees theirs until they hit record.</p>
      <button className="btn g-go wide" disabled={busy || line.length < 2} onClick={() => void start()}>Start and take my go</button>
    </Sheet>
  );
}

// ---------------------------------------------------------------- live, over the camera, while you record
export function SpotLive({ game, studio, recording, onDone }: {
  game: Game; studio: Studio | null; recording: boolean; onDone: (picks: Pick[]) => void;
}) {
  const [qids, setQids] = useState<string[] | null>(null);
  const [i, setI] = useState(0);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [shownAt, setShownAt] = useState(0);
  const [locked, setLocked] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const done = useRef(false);
  // the questions arrive the moment recording starts (a retake starts over with the same three)
  useEffect(() => {
    if (!recording) { setI(0); setPicks([]); setLocked(null); done.current = false; return; }
    let gone = false;
    void api.gameBegin(game.id).then(g => { if (gone) return; setQids(g.qids || []); setShownAt(Date.now()); })
      .catch(e => toast((e as Error).message));
    return () => { gone = true; };
  }, [recording, game.id]);
  useEffect(() => { if (!recording) return; const t = window.setInterval(() => setNow(Date.now()), 200); return () => clearInterval(t); }, [recording]);
  const q = qids && i < qids.length ? question(qids[i]) : undefined;
  const left = Math.max(0, SPOT_SEC * 1000 - (now - shownAt));
  const lock = (pick: number) => {
    if (!q || locked !== null || done.current) return;
    const p = [...picks, { pick, ms: Math.min(SPOT_SEC * 1000, Date.now() - shownAt) }];
    setLocked(pick); setPicks(p);
    window.setTimeout(() => {
      setLocked(null);
      if (p.length >= (qids?.length || 3)) { done.current = true; onDone(p); return; }
      setI(p.length); setShownAt(Date.now());
    }, pick === -1 ? 900 : 700);
  };
  useEffect(() => { if (recording && q && locked === null && left <= 0) lock(-1); }); // eslint-disable-line react-hooks/exhaustive-deps
  // the question and its choices are drawn into the video
  useEffect(() => {
    if (!studio) return;
    studio.card = recording && q
      ? { label: `On The Spot  ${i + 1} of ${qids?.length || 3}`, text: q.q, opts: q.options, picked: locked ?? undefined,
          sub: locked === -1 ? 'Out of time' : locked !== null ? 'Locked in' : `${Math.ceil(left / 1000)} seconds` }
      : null;
    studio.markDirty();
  }, [studio, recording, q, i, locked, Math.ceil(left / 1000)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (studio) { studio.card = null; studio.markDirty(); } }, [studio]);

  if (!recording) return (
    <div className="g-banner"><Icon name="timer" size={24} /><span><b>Three questions, on camera</b>
      <em>They appear the moment you hit record. {SPOT_SEC} seconds each. Say it out loud, then tap it.</em></span></div>
  );
  if (!q) return <div className="g-banner"><Icon name="timer" size={24} /><span><b>Here it comes</b><em>Getting your question</em></span></div>;
  return (
    <div className="spot-answers">
      {q.options.map((o, k) => (
        <button key={k} className={`spot-opt ${locked === k ? 'on' : ''}`} disabled={locked !== null} onClick={() => lock(k)}>
          <i>{'ABCD'[k]}</i>{o}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- the game page
export function SpotPage({ game, chat, me, onClose, onTakeTurn, onChanged }: {
  game: Game; chat: ChatFull; me: Person; onClose: () => void; onTakeTurn: (g: Game) => void; onChanged: (g: Game) => void;
}) {
  const person = personIn(chat, me);
  const playing = game.status === 'playing';
  const [watch, setWatch] = useState<SpotTake | null>(null);
  const seen = useRef<Set<string>>(new Set(JSON.parse(localStorage.getItem(`holler.spotseen.${game.id}`) || '[]')));
  useEffect(() => { void api.game(game.id).then(onChanged).catch(() => {}); }, [game.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (f: () => Promise<Game>, done?: string) => {
    try { const g = await f(); onChanged(g); liveSend(chat.id, 'chat', { game: g.id }); if (done) toast(done); } catch (e) { toast((e as Error).message); }
  };
  const markSeen = (who: string) => { seen.current.add(who); try { localStorage.setItem(`holler.spotseen.${game.id}`, JSON.stringify([...seen.current])); } catch { /* ignore */ } };
  const takes = game.takes || [];
  const scores = spotScores(game);
  const board = standings(Object.fromEntries(Object.entries(scores).filter(([id]) => takes.some(t => t.who === id))));
  const allTied = board.length > 1 && board.every(r => r.place === 1);
  const waiting = (game.todo || []).filter(id => id !== me.id);
  const mine = owes(game, me.id);
  if (watch) return <SpotWatch take={watch} game={game} me={me} person={person} onClose={() => { markSeen(watch.who); setWatch(null); }} />;
  return (
    <div className="g-page">
      <header className="g-head">
        <button className="icon-btn g-back" onClick={onClose} aria-label="Back"><Icon name="back" /></button>
        <h2>{GAME_NAME.spot}</h2>
      </header>
      <p className="g-meta">Started by {game.createdBy === me.id ? 'you' : first(person(game.createdBy || ''))}, {ago(game.createdAt)}. Three questions each, {SPOT_SEC} seconds a question.</p>
      {mine && <button className="btn g-go wide" onClick={() => onTakeTurn(game)}>{game.began ? 'Take your go again' : 'Take my go'}</button>}
      {mine && game.began && <p className="g-fine">Your go didn't send last time, so you'll get the same three questions.</p>}
      <ol className="g-track">
        {takes.map(t => {
          const right = t.qids.filter((id, k) => t.picks[k]?.pick === question(id)?.answer).length;
          const showScore = t.who === me.id || seen.current.has(t.who) || !playing;
          return (
            <li key={t.who} className="g-row">
              <button className="g-thumb" onClick={() => setWatch(t)} disabled={!t.clip} aria-label={`Watch ${first(person(t.who))}`}>
                {t.clip?.thumb ? <img src={mediaThumb(t.clip)} alt="" /> : <span className="g-thumb-blank" />}
                <span className="g-thumb-av"><Avatar p={person(t.who)} size={18} /></span>
              </button>
              <span className="g-row-txt"><b>{t.who === me.id ? 'You' : first(person(t.who))}</b>
                <span>{showScore ? `${right} of ${t.qids.length} right, ${scores[t.who]} points` : 'Watch to see how they did'}</span></span>
              {t.clip && <button className={`btn g-row-btn ${showScore ? '' : 'g-go'}`} onClick={() => setWatch(t)}>Watch</button>}
            </li>
          );
        })}
        {game.order.filter(id => !takes.some(t => t.who === id)).map(id => (
          <li key={id} className={`g-row ${id === me.id && mine ? 'up' : ''}`}>
            <Avatar p={person(id)} size={38} />
            <span className="g-row-txt"><b>{id === me.id ? 'You' : first(person(id))}</b><span>{playing ? 'Hasn\'t gone yet' : 'Did not go'}</span></span>
          </li>
        ))}
      </ol>
      {!playing && board.length > 0 && (
        <div className="g-board">
          <span className="lbl">{allTied ? 'Final scores: a tie' : 'Final scores'}</span>
          {board.map(r => (
            <div key={r.id} className={`g-board-row ${r.place === 1 && r.pts > 0 && !allTied ? 'top' : ''}`}>
              <i>{r.place}</i><Avatar p={person(r.id)} size={30} /><b>{r.id === me.id ? 'You' : first(person(r.id))}</b><em>{r.pts}</em>
            </div>
          ))}
          <p className="g-fine">Right answers score 100, plus up to 50 for speed.</p>
        </div>
      )}
      {playing && waiting.length > 0 && game.order.includes(me.id) && (
        <button className="btn wide" disabled={hours6(game.nudgedAt)} onClick={() => void act(() => api.gameNudge(game.id), 'Nudged')}>
          {hours6(game.nudgedAt) ? `Nudged ${ago(game.nudgedAt!)}` : `Nudge ${waiting.length === 1 ? first(person(waiting[0])) : 'everyone still playing'}`}
        </button>
      )}
      {!playing && !game.hidden && takes.length > 0 && (
        <button className={`btn wide ${game.savedAt ? '' : 'g-go'}`} onClick={() => void act(() => api.gameSave(game.id, !game.savedAt), game.savedAt ? 'Not saved' : 'Saved. These clips stay.')}>
          <Icon name="star" size={18} fill={game.savedAt ? 'currentColor' : undefined} /> {game.savedAt ? 'Saved' : 'Save these clips'}
        </button>
      )}
      <p className="g-foot">{playing ? 'Anyone who waits 2 days gets passed by.' : game.savedAt ? 'Saved, so these clips stay.' : 'Clips hide a week after the game unless someone saves them.'}</p>
      {playing && game.createdBy === me.id && <button className="link-btn g-endgame" onClick={() => void act(() => api.gameEnd(game.id), 'Game ended')}>End this game</button>}
    </div>
  );
}

const mediaThumb = (p: Polo) => publicUrl(p.thumb || '');

// ---------------------------------------------------------------- watch someone's go, then see how they did
function SpotWatch({ take, game, me, person, onClose }: {
  take: SpotTake; game: Game; me: Person; person: (id: string) => Person | undefined; onClose: () => void;
}) {
  const vid = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<'watch' | 'reveal'>(take.clip ? 'watch' : 'reveal');
  const [needTap, setNeedTap] = useState(false);
  useEffect(() => {
    if (phase !== 'watch' || !take.clip?.path) return;
    let gone = false;
    void mediaUrl(take.clip.path).then(u => { const v = vid.current; if (gone || !v) return; v.src = u; v.play().then(() => setNeedTap(false)).catch(() => setNeedTap(true)); });
    return () => { gone = true; };
  }, [phase, take.clip?.path]);
  const who = take.who === me.id ? 'You' : first(person(take.who));
  const total = take.qids.reduce((n, id, i) => n + answerPoints(question(id), take.picks[i]), 0);
  return (
    <div className="g-reveal">
      {phase === 'watch' && (<>
        <video ref={vid} playsInline className="g-rv-vid" onEnded={() => setPhase('reveal')} onClick={() => { if (needTap) void vid.current?.play().then(() => setNeedTap(false)); }} />
        <div className="g-rv-top">
          <span className="g-rv-ic"><Icon name="timer" size={22} /></span>
          <span className="g-rv-who"><b>On The Spot</b><span>{who} {take.who === me.id ? 'are' : 'is'} sweating</span></span>
          <button className="icon-btn glass" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        {needTap && <div className="paused tap g-rv-tap"><Icon name="play" size={56} fill="currentColor" /><span>Tap to play</span></div>}
        <button className="g-rv-skip" onClick={() => { vid.current?.pause(); setPhase('reveal'); }}>See the answers</button>
      </>)}
      {phase === 'reveal' && (
        <div className="g-end">
          <button className="icon-btn glass g-rv-x" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
          <div className="g-box"><small><Avatar p={person(take.who)} size={18} /> {who}</small><p>{total} points</p></div>
          {take.qids.map((id, k) => {
            const q = question(id); if (!q) return null;
            const p = take.picks[k]; const ok = p?.pick === q.answer;
            return (
              <div key={id} className={`spot-rev ${ok ? 'ok' : ''}`}>
                <small>{k + 1}. {q.q}</small>
                <b><Icon name={ok ? 'check' : 'close'} size={16} /> {p && p.pick >= 0 ? q.options[p.pick] : 'Ran out of time'}{ok && p ? `, ${(p.ms / 1000).toFixed(1)} s` : ''}</b>
                {!ok && <span>Answer: {q.options[q.answer]}</span>}
              </div>
            );
          })}
          {take.clip && <button className="btn wide" onClick={() => setPhase('watch')}><Icon name="play" size={16} fill="currentColor" /> Watch again</button>}
          {game.status !== 'playing' && <p className="g-fine">Right answers score 100, plus up to 50 for speed.</p>}
        </div>
      )}
    </div>
  );
}
