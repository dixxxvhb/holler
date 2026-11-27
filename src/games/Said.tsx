// Who Said It: everyone gets a prompt about them. You answer everyone else's (yours stays hidden), then you match what
// everyone wrote about you to who wrote it. 1 for each right match; your answer fools someone, 1 for you.
// No camera needed. Rules live in supabase/games7.sql; the prompts live in content/said.ts.
import { useEffect, useMemo, useState } from 'react';
import { api, type ChatFull, type Game, type Person, type SaidAnswer, type SaidBoard } from '../lib/api';
import { send as liveSend } from '../lib/live';
import { Avatar, Sheet, ago, tone, toast } from '../ui/bits';
import { Icon } from '../ui/icons';
import { SAID, saidPrompt } from './content/said';
import { freshFirst, shuffle } from './content/shuffle';
import { first, markUsed, personIn, standings, usedIn } from './roundLogic';
import './games.css';

const hours6 = (iso: string | null | undefined) => !!iso && Date.now() - new Date(iso).getTime() < 6 * 3600e3;
const draftKey = (id: string) => `holler.said.draft.${id}`;
const readDraft = (id: string): Record<string, string> => { try { return JSON.parse(localStorage.getItem(draftKey(id)) || '{}'); } catch { return {}; } };
const keepDraft = (id: string, d: Record<string, string> | null) => { try { if (d) localStorage.setItem(draftKey(id), JSON.stringify(d)); else localStorage.removeItem(draftKey(id)); } catch { /* private mode */ } };

/** right + fooled, from the server's tally. */
export function saidScores(g: Game): Record<string, number> {
  return Object.fromEntries(g.order.map(id => [id, (g.scores?.[id]?.right || 0) + (g.scores?.[id]?.fooled || 0)]));
}

// ---------------------------------------------------------------- start
export function SaidStart({ open, onClose, chat, me, onStarted }: {
  open: boolean; onClose: () => void; chat: ChatFull; me: Person; onStarted: (g: Game) => void;
}) {
  const others = useMemo(() => chat.members.filter(m => m.id !== me.id), [chat.members, me.id]);
  const [who, setWho] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setWho(others.slice(0, 5).map(o => o.id)); }, [open, others]);
  const toggle = (id: string) => setWho(o => (o.includes(id) ? o.filter(x => x !== id) : o.length >= 5 ? o : [...o, id]));
  const line = [me.id, ...who];
  const start = async () => {
    setBusy(true);
    try {
      const key = `holler.said.${chat.id}`;
      const pool = freshFirst(shuffle(SAID), p => p.id, usedIn(key));
      const prompts = Object.fromEntries(line.map((id, i) => [id, pool[i].id]));
      const g = await api.gameStart2(chat.id, 'said', line, { prompts });
      Object.values(prompts).forEach(id => markUsed(key, id));
      liveSend(chat.id, 'chat', { game: g.id });
      onStarted(g);
    } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Who Said It">
      <p className="g-sub">Everyone gets a prompt about them, like "{saidPrompt('said-01', first(me))}". You answer everyone else's. Then you see what everyone wrote about you, and guess who said each one.</p>
      <span className="lbl">Playing</span>
      <div className="g-order-tools">
        <span className="chip on g-me-chip"><Avatar p={me} size={18} /> You</span>
        {others.map(o => <button key={o.id} className={`chip ${who.includes(o.id) ? 'on' : ''}`} onClick={() => toggle(o.id)}><Avatar p={o} size={18} /> {first(o)}</button>)}
      </div>
      {line.length < 3 && <p className="g-warn">Pick at least 2 people to play with.</p>}
      <p className="g-fine">Write like someone else and you score when they pin it on the wrong person. No camera needed.</p>
      <button className="btn g-go wide" disabled={busy || line.length < 3} onClick={() => void start()}>Start</button>
    </Sheet>
  );
}

// ---------------------------------------------------------------- the game page
export function SaidPage({ game, chat, me, onClose, onChanged }: {
  game: Game; chat: ChatFull; me: Person; onClose: () => void; onChanged: (g: Game) => void;
}) {
  const person = personIn(chat, me);
  const playing = game.status === 'playing';
  const writing = playing && game.phase === 'write';
  const inGame = game.order.includes(me.id);
  const wrote = (game.wrote || []).includes(me.id);
  const boards = game.boards || [];
  const [matching, setMatching] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>(() => readDraft(game.id));
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api.game(game.id).then(onChanged).catch(() => {}); }, [game.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (f: () => Promise<Game>, done?: string) => {
    setBusy(true);
    try { const g = await f(); onChanged(g); liveSend(chat.id, 'chat', { game: g.id }); if (done) toast(done); return true; }
    catch (e) { toast((e as Error).message); return false; }
    finally { setBusy(false); }
  };
  const setOne = (id: string, v: string) => { const d = { ...draft, [id]: v }; setDraft(d); keepDraft(game.id, d); };
  const targets = game.order.filter(id => id !== me.id);
  const ready = targets.every(id => (draft[id] || '').trim().length > 0);
  const send = async () => {
    const write = Object.fromEntries(targets.map(id => [id, (draft[id] || '').trim()]));
    if (await act(() => api.saidMove(game.id, { write }), 'Yours are in')) keepDraft(game.id, null);
  };
  const waiting = (game.todo || []).filter(id => id !== me.id);
  const scores = saidScores(game);
  const board = standings(scores);
  const allTied = board.length > 1 && board.every(r => r.place === 1);
  // yours first: it's the good one
  const shown = [...boards].sort((a, b) => (a.about === me.id ? -1 : b.about === me.id ? 1 : 0));
  const live = matching ? boards.find(b => b.about === matching) : null;
  if (live) return <SaidMatch board={live} game={game} chat={chat} me={me} onClose={() => setMatching(null)} onChanged={onChanged} />;

  return (
    <div className="g-page s-page">
      <header className="g-head">
        <button className="icon-btn g-back" onClick={onClose} aria-label="Back"><Icon name="back" /></button>
        <h2>Who Said It</h2>
      </header>
      <p className="g-meta">Started by {game.createdBy === me.id ? 'you' : first(person(game.createdBy || ''))}, {ago(game.createdAt)}. {game.order.length} people.</p>

      {writing && inGame && !wrote && (
        <form className="s-write" onSubmit={e => { e.preventDefault(); if (ready) void send(); }}>
          <p className="g-sub">Answer one for everyone. Nobody sees these until everyone has written, and then they have to guess which one is yours.</p>
          {targets.map(id => {
            const p = person(id); const b = boards.find(x => x.about === id);
            return (
              <label key={id} className="s-w" style={{ ['--c' as string]: tone(p?.color) }}>
                <span className="s-w-head"><Avatar p={p} size={26} /><b>{saidPrompt(b?.prompt, first(p))}</b></span>
                <textarea className="field area" rows={2} maxLength={80} value={draft[id] || ''} onChange={e => setOne(id, e.target.value)}
                  placeholder="Your answer" aria-label={`Your answer about ${first(p)}`} />
              </label>
            );
          })}
          <button type="submit" className="btn g-go wide" disabled={!ready || busy}><Icon name="send" size={18} /> Send my answers</button>
          <p className="g-fine">Yours is a secret until everyone has written. So is the prompt about you.</p>
        </form>
      )}

      {writing && (wrote || !inGame) && (
        <div className="s-wait">
          <b>{wrote ? 'Yours are in' : 'They are writing'}</b>
          <span>{waiting.length ? `Waiting on ${waiting.map(id => first(person(id))).join(', ')}.` : 'Everyone is in.'} Then you'll see what everyone wrote about you.</span>
          {wrote && <span className="s-mine">{boards.filter(b => b.about !== me.id).map(b => {
            const a = b.answers.find(x => x.who === me.id);
            return a ? <span key={b.about}><Avatar p={person(b.about)} size={18} /><em>{saidPrompt(b.prompt, first(person(b.about)))}:</em> {a.text}</span> : null;
          })}</span>}
        </div>
      )}

      {writing && (
        <ol className="g-track">
          {game.order.map(id => (
            <li key={id} className="g-row">
              <Avatar p={person(id)} size={38} />
              <span className="g-row-txt"><b>{id === me.id ? 'You' : first(person(id))}</b><span>{(game.wrote || []).includes(id) ? 'Wrote theirs' : 'Still writing'}</span></span>
              {(game.wrote || []).includes(id) && <Icon name="check" size={18} stroke={3} />}
            </li>
          ))}
        </ol>
      )}

      {!writing && game.status === 'ended' && game.phase === 'write' && <p className="g-meta">This one ended before everyone wrote.</p>}

      {!writing && shown.map(b => (
        <SaidBlock key={b.about} board={b} game={game} chat={chat} me={me} onMatch={() => setMatching(b.about)} />
      ))}

      {!writing && board.some(r => r.pts > 0) && (
        <div className="g-board">
          <span className="lbl">{game.status === 'done' ? (allTied ? 'Final scores: a tie' : 'Final scores') : 'Scores so far'}</span>
          {board.map(r => (
            <div key={r.id} className={`g-board-row ${r.place === 1 && r.pts > 0 && !allTied && game.status === 'done' ? 'top' : ''}`}>
              <i>{r.place}</i><Avatar p={person(r.id)} size={30} />
              <b>{r.id === me.id ? 'You' : first(person(r.id))}<small className="s-pts">{game.scores?.[r.id]?.right || 0} right, fooled {game.scores?.[r.id]?.fooled || 0}</small></b><em>{r.pts}</em>
            </div>
          ))}
          <p className="g-fine">1 for each answer you match to the right person. 1 each time someone pins your answer on someone else.</p>
        </div>
      )}

      {playing && waiting.length > 0 && inGame && (
        <button className="btn wide" disabled={hours6(game.nudgedAt)} onClick={() => void act(() => api.gameNudge(game.id), 'Nudged')}>
          {hours6(game.nudgedAt) ? `Nudged ${ago(game.nudgedAt!)}` : `Nudge ${waiting.length === 1 ? first(person(waiting[0])) : 'everyone still playing'}`}
        </button>
      )}
      {playing && <p className="g-foot">Anyone who waits 2 days gets passed by.</p>}
      {playing && game.createdBy === me.id && <button className="link-btn g-endgame" onClick={() => void act(() => api.gameEnd(game.id), 'Game ended')}>End this game</button>}
    </div>
  );
}

// ---------------------------------------------------------------- one prompt: match it, or see who said what
function SaidBlock({ board, game, chat, me, onMatch }: { board: SaidBoard; game: Game; chat: ChatFull; me: Person; onMatch: () => void }) {
  const person = personIn(chat, me);
  const about = person(board.about);
  const aboutMe = board.about === me.id;
  const canMatch = game.status === 'playing' && game.order.includes(me.id) && !board.open && board.n >= 2 && !board.mine;
  const others = board.answers.filter(a => a.who !== me.id);
  return (
    <section className={`s-board ${aboutMe ? 'me' : ''}`} style={{ ['--c' as string]: tone(about?.color) }}>
      <header className="s-head">
        <small><Avatar p={about} size={22} /> {aboutMe ? 'About you' : `About ${first(about)}`}</small>
        <p>{saidPrompt(board.prompt, first(about))}</p>
      </header>
      {canMatch && (
        <div className="s-cta">
          <span>{aboutMe ? `${others.length} people wrote about you.` : `${others.length} answers about ${first(about)}.`} Who said which?</span>
          <button className="btn g-go" onClick={onMatch}>Match them</button>
        </div>
      )}
      {!canMatch && !board.open && <div className="s-cta"><span>{board.mine ? 'Matched. It opens soon.' : 'Waiting on the others.'}</span></div>}
      {board.open && <SaidReveal board={board} me={me} person={person} />}
    </section>
  );
}

function SaidReveal({ board, me, person }: { board: SaidBoard; me: Person; person: (id: string) => Person | undefined }) {
  const guessers = Object.entries(board.guesses || {});
  return (
    <ul className="s-answers">
      {board.answers.map(a => {
        const w = a.who ? person(a.who) : undefined;
        const calls = guessers.map(([g, pk]) => ({ g, pick: pk?.picks?.[a.k] })).filter(c => c.pick);
        return (
          <li key={a.k} className="s-ans" style={{ ['--w' as string]: tone(w?.color) }}>
            <p>{a.text}</p>
            <span className="s-by"><Avatar p={w} size={24} /><b>{a.who === me.id ? 'You' : first(w)}</b> said it</span>
            {calls.length > 0 && (
              <span className="s-calls">{calls.map(c => {
                const ok = c.pick === a.who;
                return (
                  <span key={c.g} className={`s-call ${ok ? 'ok' : ''}`}>
                    <Avatar p={person(c.g)} size={18} />
                    {ok ? <>{c.g === me.id ? 'You' : first(person(c.g))} got it <Icon name="check" size={12} stroke={3} /></>
                      : <>{c.g === me.id ? 'You' : first(person(c.g))} said {c.pick === me.id ? 'you' : first(person(c.pick!))}</>}
                  </span>
                );
              })}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- the matching board
function SaidMatch({ board, game, chat, me, onClose, onChanged }: {
  board: SaidBoard; game: Game; chat: ChatFull; me: Person; onClose: () => void; onChanged: (g: Game) => void;
}) {
  const person = personIn(chat, me);
  const about = person(board.about);
  const aboutMe = board.about === me.id;
  const answers: SaidAnswer[] = board.answers.filter(a => a.who !== me.id);
  // whoever wrote about them, except you, in the game's order
  const faces = game.order.filter(id => id !== me.id && id !== board.about && (game.wrote || []).includes(id));
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const pick = (k: string, who: string) => setPicks(p => {
    const n = Object.fromEntries(Object.entries(p).filter(([kk, w]) => w !== who && kk !== k));
    if (p[k] !== who) n[k] = who;
    return n;
  });
  const full = answers.length > 0 && answers.every(a => picks[a.k]);
  const send = async () => {
    setBusy(true);
    try { const g = await api.saidMove(game.id, { about: board.about, picks }); onChanged(g); liveSend(chat.id, 'chat', { game: g.id }); }
    catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  const done = board.open;
  const right = done && board.mine ? answers.filter(a => board.mine!.picks[a.k] === a.who).length : 0;
  return (
    <div className="g-page s-page s-match">
      <header className="g-head">
        <button className="icon-btn g-back" onClick={onClose} aria-label="Back"><Icon name="back" /></button>
        <h2>Who Said It</h2>
      </header>
      <section className={`s-board ${aboutMe ? 'me' : ''}`} style={{ ['--c' as string]: tone(about?.color) }}>
        <header className="s-head">
          <small><Avatar p={about} size={22} /> {aboutMe ? 'About you' : `About ${first(about)}`}</small>
          <p>{saidPrompt(board.prompt, first(about))}</p>
        </header>
        {!done && (
          <ul className="s-answers">
            {answers.map(a => (
              <li key={a.k} className={`s-ans ${picks[a.k] ? 'set' : ''}`} style={{ ['--w' as string]: tone(person(picks[a.k] || '')?.color) }}>
                <p>{a.text}</p>
                <span className="s-faces" role="group" aria-label="Who said it?">
                  {faces.map(f => {
                    const on = picks[a.k] === f; const used = !on && Object.values(picks).includes(f);
                    return (
                      <button key={f} type="button" className={`s-face ${on ? 'on' : ''} ${used ? 'used' : ''}`} onClick={() => pick(a.k, f)} aria-pressed={on}
                        style={{ ['--f' as string]: tone(person(f)?.color) }}>
                        <Avatar p={person(f)} size={28} /><b>{first(person(f))}</b>
                      </button>
                    );
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
        {done && <SaidReveal board={board} me={me} person={person} />}
      </section>
      {!done && <button className="btn g-go wide" disabled={!full || busy} onClick={() => void send()}>{full ? 'Lock it in' : 'Tap a face for each one'}</button>}
      {!done && <p className="g-fine">Each person once. You only get one go.</p>}
      {done && board.mine && <div className="g-box truth s-score"><small>You matched</small><p>{right} of {answers.length} right</p></div>}
      {done && <button className="btn g-go wide" onClick={onClose}>Done</button>}
    </div>
  );
}

