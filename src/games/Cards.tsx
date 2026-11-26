// Last Card: a shedding card game for 2 to 6 people, one turn at a time, whenever you open the chat.
// The server deals, keeps every hand secret and checks every move (supabase/games5.sql); this only shows state.
import { useEffect, useMemo, useState } from 'react';
import { api, type CardEvent, type CardMove, type ChatFull, type Game, type Person } from '../lib/api';
import { send as liveSend } from '../lib/live';
import { Avatar, Sheet, ago, toast } from '../ui/bits';
import { Icon } from '../ui/icons';
import { first, personIn } from './roundLogic';
import { shuffle } from './content/shuffle';
import './games.css';

const hours6 = (iso: string | null | undefined) => !!iso && Date.now() - new Date(iso).getTime() < 6 * 3600e3;
export const COLOR_NAME: Record<string, string> = { r: 'Red', y: 'Yellow', g: 'Green', b: 'Blue' };
const VALUE_NAME: Record<string, string> = { s: 'Skip', r: 'Reverse', d: 'Draw Two', w: 'Wild', f: 'Wild Draw Four' };
const ORDER = 'rygbx', VALUES = '0123456789srdwf';

export const cardName = (c: string) => c[0] === 'x' ? VALUE_NAME[c[1]] : `${COLOR_NAME[c[0]]} ${VALUE_NAME[c[1]] || c[1]}`;
export const fits = (c: string, top: string, color: string) => c[0] === 'x' || c[0] === color || (top[0] !== 'x' && c[1] === top[1]);
const sortHand = (h: string[]) => [...h].sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]) || VALUES.indexOf(a[1]) - VALUES.indexOf(b[1]));

// ---------------------------------------------------------------- one card
function Glyph({ v, big }: { v: string; big?: boolean }) {
  const s = big ? 46 : 22;
  if (v === 's') return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden><circle cx="12" cy="12" r="8.5" /><path d="M6 18 18 6" /></svg>;
  if (v === 'r') return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 9h13l-3.5-3.5M20 15H7l3.5 3.5" /></svg>;
  if (v === 'd') return <span>+2</span>;
  if (v === 'f') return <span>+4</span>;
  if (v === 'w') return <span className="lc-quad" aria-hidden><i /><i /><i /><i /></span>;
  return <span>{v}</span>;
}

export function PlayCard({ code, big, sm, onClick, ok, dim, picked, wildColor, label }: {
  code: string; big?: boolean; sm?: boolean; onClick?: () => void; ok?: boolean; dim?: boolean; picked?: boolean; wildColor?: string; label?: string;
}) {
  const cls = `lc-card c-${code[0]} ${big ? 'big' : ''} ${sm ? 'sm' : ''} ${ok ? 'ok' : ''} ${dim ? 'dim' : ''} ${picked ? 'picked' : ''} ${wildColor ? `w-${wildColor}` : ''}`;
  const inner = (<>
    <em className="lc-corner"><Glyph v={code[1]} /></em>
    <b className="lc-face">{code[0] === 'x' && code[1] === 'f' ? <><span className="lc-quad" aria-hidden><i /><i /><i /><i /></span><span className="lc-plus">+4</span></> : <Glyph v={code[1]} big />}</b>
  </>);
  const aria = label || cardName(code) + (wildColor ? `, ${COLOR_NAME[wildColor]} picked` : '');
  return onClick
    ? <button className={cls} data-card={code} onClick={onClick} aria-label={aria}>{inner}</button>
    : <span className={cls} data-card={code} role="img" aria-label={aria}>{inner}</span>;
}

// ---------------------------------------------------------------- start
export function CardStart({ open, onClose, chat, me, onStarted }: {
  open: boolean; onClose: () => void; chat: ChatFull; me: Person; onStarted: (g: Game) => void;
}) {
  const others = useMemo(() => chat.members.filter(m => m.id !== me.id), [chat.members, me.id]);
  const [pick, setPick] = useState<string[]>([]);
  const [meFirst, setMeFirst] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setPick(others.slice(0, 5).map(o => o.id)); }, [open, others]);
  const toggle = (id: string) => setPick(p => (p.includes(id) ? p.filter(x => x !== id) : p.length >= 5 ? p : [...p, id]));
  const start = async () => {
    setBusy(true);
    try {
      const rest = shuffle(pick);
      const order = meFirst ? [me.id, ...rest] : shuffle([me.id, ...rest]);
      const g = await api.cardStart(chat.id, order);
      liveSend(chat.id, 'chat', { game: g.id });
      onStarted(g);
    } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Last Card">
      <p className="g-sub">Everyone gets 7 cards. Match the top card by color or number, or play a wild. First one out wins. Down to one card? Call Last card, or draw two.</p>
      <div className="lc-fan" aria-hidden>{['r7', 'yr', 'gd', 'b2', 'xw'].map(c => <PlayCard key={c} code={c} sm />)}</div>
      <span className="lbl">Who's in</span>
      <div className="g-order-tools">
        <span className="chip on"><Avatar p={me} size={18} /> You</span>
        {others.map(o => <button key={o.id} className={`chip ${pick.includes(o.id) ? 'on' : ''}`} onClick={() => toggle(o.id)}><Avatar p={o} size={18} /> {first(o)}</button>)}
      </div>
      {others.length > 5 && <p className="g-meta">Up to 6 at a table.</p>}
      <span className="lbl">First turn</span>
      <div className="seg g-seg">
        <button className={meFirst ? 'on' : ''} onClick={() => setMeFirst(true)}>Me</button>
        <button className={!meFirst ? 'on' : ''} onClick={() => setMeFirst(false)}>Random</button>
      </div>
      <button className="btn g-go wide" disabled={busy || pick.length < 1} onClick={() => void start()}>Deal</button>
    </Sheet>
  );
}

// ---------------------------------------------------------------- what just happened, in words
export function describe(ev: CardEvent, name: (id: string) => string): string {
  const who = name(ev.who);
  if (ev.kind === 'draw') return `${who} drew a card`;
  if (ev.kind === 'keep') return `${who} drew and kept it`;
  if (ev.kind === 'idle') return `${who} went 2 days without a turn, so drew one and got passed`;
  if (ev.kind === 'left') return `${who} left the game`;
  let s = `${who} played ${ev.card ? cardName(ev.card) : 'a card'}`;
  if (ev.card?.[0] === 'x' && ev.color) s += ` and picked ${COLOR_NAME[ev.color]}`;
  if (ev.skip) s += `. ${name(ev.skip)} is skipped`;
  if (ev.hit) s += `. ${name(ev.hit)} draws ${ev.n ?? ''} and is skipped`;
  if (ev.called) s += '. Last card!';
  if (ev.forgot) s += `. Forgot to call Last card, so drew ${ev.forgot}`;
  return s;
}

// ---------------------------------------------------------------- the table
export function CardPage({ game, chat, me, onClose, onChanged, onRematch }: {
  game: Game; chat: ChatFull; me: Person; onClose: () => void; onChanged: (g: Game) => void; onRematch: (g: Game) => void;
}) {
  const person = personIn(chat, me);
  const name = (id: string) => (id === me.id ? 'You' : first(person(id)));
  const playing = game.status === 'playing';
  const myTurn = playing && game.turnPerson === me.id;
  const inGame = game.order.includes(me.id);
  const hand = useMemo(() => sortHand(game.hand || []), [game.hand]);
  const top = game.top || 'r0';
  const color = game.color || top[0];
  const [busy, setBusy] = useState(false);
  const [call, setCall] = useState(false);
  const [wild, setWild] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  useEffect(() => { setCall(false); setWild(null); }, [game.version]);
  useEffect(() => { void api.game(game.id).then(onChanged).catch(() => {}); }, [game.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (f: () => Promise<Game>, after?: (g: Game) => void) => {
    setBusy(true);
    try { const g = await f(); onChanged(g); liveSend(chat.id, 'chat', { game: g.id }); after?.(g); }
    catch (e) { toast((e as Error).message); void api.game(game.id).then(onChanged).catch(() => {}); }
    setBusy(false);
  };
  const move = (m: CardMove, after?: (g: Game) => void) => void act(() => api.cardMove(game.id, game.version, m), after);
  const canPlay = (c: string) => myTurn && !busy && (game.drawn ? c === game.drawn : fits(c, top, color));
  const play = (c: string) => {
    if (!canPlay(c)) { if (myTurn) toast(game.drawn ? 'After a draw you can only play the card you drew.' : `That doesn't go on ${cardName(top)}${top[0] === 'x' ? ` (${COLOR_NAME[color]})` : ''}.`); return; }
    if (c[0] === 'x') { setWild(c); return; }
    move({ play: c, last: call || undefined });
  };
  const draw = () => move({ draw: true }, g => { if (g.turnPerson !== me.id) toast('No match. Your turn passed.'); });
  const rematch = async () => {
    setBusy(true);
    try {
      const g = await api.cardStart(chat.id, [...game.order.slice(1), game.order[0]]);
      liveSend(chat.id, 'chat', { game: g.id }); onRematch(g);
    } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };

  const counts = game.counts || {};
  const anyFit = hand.some(c => fits(c, top, color));
  const status = !playing
    ? game.result === 'idle' ? 'Ended. Nobody went for a week.'
      : game.winner === me.id ? 'You won' : game.winner ? `${first(person(game.winner))} won` : 'Game over'
    : myTurn ? (game.drawn ? 'Play it or keep it' : 'Your turn') : `${first(person(game.turnPerson || ''))}'s turn`;
  const log = [...(game.log || [])].reverse();

  return (
    <div className="g-page lc-page">
      <header className="g-head">
        <button className="icon-btn g-back" onClick={onClose} aria-label="Back"><Icon name="back" /></button>
        <h2>Last Card</h2>
      </header>

      <div className="lc-seats" aria-label={`Turn order, going ${game.dir === -1 ? 'backward' : 'forward'}`}>
        {game.order.map((id, k) => (
          <div key={id} className={`lc-seat ${playing && game.turnPerson === id ? 'up' : ''} ${game.winner === id ? 'won' : ''}`}>
            {k > 0 && <span className="lc-dir" aria-hidden>{game.dir === -1 ? '‹' : '›'}</span>}
            <Avatar p={person(id)} size={36} />
            <b>{name(id)}</b>
            <em>{playing && counts[id] === 1 ? <span className="lc-one">Last card</span> : `${counts[id] ?? 0} ${counts[id] === 1 ? 'card' : 'cards'}`}</em>
          </div>
        ))}
      </div>

      <div className="lc-table">
        <button className={`lc-deck ${myTurn && !game.drawn && !busy ? 'go' : ''}`} disabled={!myTurn || !!game.drawn || busy} onClick={draw}
          aria-label={`Draw a card. ${game.deckLeft ?? 0} left in the deck`}>
          <span className="lc-back" /><span className="lc-back" /><span className="lc-back" />
          <em>{myTurn && !game.drawn ? 'Draw' : `${game.deckLeft ?? 0} left`}</em>
        </button>
        <div className="lc-pile">
          <PlayCard key={`${top}-${game.moves}`} code={top} big wildColor={top[0] === 'x' ? color : undefined} />
          <span className={`lc-now c-${color}`}>{COLOR_NAME[color]}</span>
        </div>
      </div>

      <p className={`d-status ${myTurn ? 'mine' : ''}`}>{status}</p>
      {game.last && <p className="lc-last">{describe(game.last as CardEvent, name)}</p>}

      {playing && inGame && hand.length > 0 && (<>
        {myTurn && !game.drawn && hand.length === 2 && (
          <button className={`lc-call ${call ? 'on' : ''}`} onClick={() => setCall(c => !c)} aria-pressed={call}>
            {call ? 'Last card! Now play one' : 'Tap to call Last card before you play'}
          </button>
        )}
        <div className={`lc-hand ${myTurn ? 'turn' : ''}`} aria-label="Your hand">
          {hand.map((c, i) => <PlayCard key={`${c}-${i}`} code={c} onClick={() => play(c)} ok={canPlay(c)} dim={myTurn && !canPlay(c)} picked={game.drawn === c && i === hand.indexOf(c)} />)}
        </div>
        {myTurn && game.drawn && (
          <div className="g-row-btns">
            <button className="btn" disabled={busy} onClick={() => move({ pass: true })}>Keep it</button>
            <button className="btn g-go" disabled={busy} onClick={() => play(game.drawn!)}>Play {cardName(game.drawn)}</button>
          </div>
        )}
        {myTurn && !game.drawn && !anyFit && <p className="g-meta lc-hint">Nothing fits. Tap the deck to draw.</p>}
      </>)}

      {!playing && game.hands && (
        <div className="lc-left">
          {game.order.filter(id => (game.hands?.[id] || []).length).map(id => (
            <div key={id} className="lc-left-row">
              <span className="q-person-h"><Avatar p={person(id)} size={20} /> {name(id)} had</span>
              <div className="lc-mini">{sortHand(game.hands![id]).map((c, i) => <PlayCard key={i} code={c} sm />)}</div>
            </div>
          ))}
        </div>
      )}

      {playing && !myTurn && inGame && game.turnPerson && (
        <button className="btn wide" disabled={busy || hours6(game.nudgedAt)} onClick={() => void act(() => api.gameNudge(game.id), () => toast(`Nudged ${first(person(game.turnPerson!))}`))}>
          {hours6(game.nudgedAt) ? `Nudged ${ago(game.nudgedAt!)}` : `Nudge ${first(person(game.turnPerson))}`}
        </button>
      )}
      {!playing && inGame && game.order.length >= 2 && <button className="btn g-go wide" disabled={busy} onClick={() => void rematch()}>Deal again</button>}

      {log.length > 1 && (
        <ol className="lc-log" aria-label="What happened">
          {log.slice(1, 6).map((ev, i) => <li key={i}>{describe(ev, name)} <time>{ago(ev.at)}</time></li>)}
        </ol>
      )}
      <p className="g-foot">{playing
        ? 'Down to one card? Call Last card before you play, or you draw two. Anyone who waits 2 days draws one and gets passed. A week with no turns ends it.'
        : `Finished ${game.endedAt ? ago(game.endedAt) : ''}.`}</p>
      {playing && inGame && (
        <button className="link-btn g-endgame" disabled={busy} onClick={() => { if (!sure) { setSure(true); setTimeout(() => setSure(false), 4000); return; } void act(() => api.cardLeave(game.id)); }}>
          {sure ? 'Tap again to leave. Your cards go back in the pile.' : 'Leave this game'}
        </button>
      )}

      <Sheet open={!!wild} onClose={() => setWild(null)} title={wild ? `${cardName(wild)}: pick a color` : ''}>
        <div className="lc-colors">
          {(['r', 'y', 'g', 'b'] as const).map(c => (
            <button key={c} className={`lc-color c-${c}`} disabled={busy} onClick={() => { const w = wild!; setWild(null); move({ play: w, color: c, last: call || undefined }); }}>
              {COLOR_NAME[c]}<em>{hand.filter(h => h[0] === c).length} in your hand</em>
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
