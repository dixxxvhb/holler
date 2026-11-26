// Tic-Tac-Toe and Checkers: two people, take turns whenever you like. The server checks every move (supabase/games3.sql).
import { useEffect, useMemo, useState } from 'react';
import { api, type ChatFull, type Game, type Person } from '../lib/api';
import { send as liveSend } from '../lib/live';
import { Avatar, Sheet, ago, toast } from '../ui/bits';
import { Icon } from '../ui/icons';
import { applyPath, count, legalMoves, tttLine, type Side } from './boardLogic';
import { GAME_NAME, first, personIn } from './roundLogic';
import './games.css';

type DuelKind = 'ttt' | 'checkers';
const hours6 = (iso: string | null | undefined) => !!iso && Date.now() - new Date(iso).getTime() < 6 * 3600e3;

/** Each player's pieces wear their own color; if both picked the same one, the second plays in white. */
function inks(game: Game, person: (id: string) => Person | undefined): [string, string] {
  const a = person(game.order[0])?.color || '#ff6a3d';
  const b = person(game.order[1])?.color || '#59c9ff';
  return [a, a.toLowerCase() === b.toLowerCase() ? '#f7f6fb' : b];
}

// ---------------------------------------------------------------- start
export function DuelStart({ open, kind, onClose, chat, me, onStarted }: {
  open: boolean; kind: DuelKind; onClose: () => void; chat: ChatFull; me: Person; onStarted: (g: Game) => void;
}) {
  const others = useMemo(() => chat.members.filter(m => m.id !== me.id), [chat.members, me.id]);
  const [who, setWho] = useState<string | null>(null);
  const [meFirst, setMeFirst] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setWho(others.length === 1 ? others[0].id : null); }, [open, others]);
  const them = others.find(o => o.id === who);
  const start = async () => {
    if (!who) return;
    setBusy(true);
    try {
      const g = await api.gameStart2(chat.id, kind, meFirst ? [me.id, who] : [who, me.id], {});
      liveSend(chat.id, 'chat', { game: g.id });
      onStarted(g);
    } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  return (
    <Sheet open={open} onClose={onClose} title={GAME_NAME[kind]}>
      <p className="g-sub">{kind === 'ttt'
        ? 'Three in a row wins. Take your turn whenever you open the chat.'
        : 'Classic checkers. Jumps are a must, keep jumping while you can, and reach the far side to be crowned.'}</p>
      <span className="lbl">Play with</span>
      <div className="g-order-tools">
        {others.map(o => <button key={o.id} className={`chip ${who === o.id ? 'on' : ''}`} onClick={() => setWho(o.id)}><Avatar p={o} size={18} /> {first(o)}</button>)}
      </div>
      <span className="lbl">First move</span>
      <div className="seg g-seg">
        <button className={meFirst ? 'on' : ''} onClick={() => setMeFirst(true)}>Me</button>
        <button className={!meFirst ? 'on' : ''} onClick={() => setMeFirst(false)}>{them ? first(them) : 'Them'}</button>
      </div>
      <button className="btn g-go wide" disabled={busy || !who} onClick={() => void start()}>{meFirst ? 'Start and make my move' : 'Start'}</button>
    </Sheet>
  );
}

// ---------------------------------------------------------------- the game page
export function DuelPage({ game, chat, me, onClose, onChanged, onRematch }: {
  game: Game; chat: ChatFull; me: Person; onClose: () => void; onChanged: (g: Game) => void; onRematch: (g: Game) => void;
}) {
  const person = personIn(chat, me);
  const kind = game.kind as DuelKind;
  const playing = game.status === 'playing';
  const myTurn = playing && game.turnPerson === me.id;
  const inGame = game.order.includes(me.id);
  const other = game.order.find(id => id !== me.id) || game.order[1];
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const [shown, setShown] = useState<string | null>(null); // the board right after my move, until the server answers
  useEffect(() => { setShown(null); }, [game.version]);
  useEffect(() => { void api.game(game.id).then(onChanged).catch(() => {}); }, [game.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [ink0, ink1] = inks(game, person);

  const act = async (f: () => Promise<Game>, done?: string) => {
    setBusy(true);
    try { const g = await f(); onChanged(g); liveSend(chat.id, 'chat', { game: g.id }); if (done) toast(done); }
    catch (e) { setShown(null); toast((e as Error).message); void api.game(game.id).then(onChanged).catch(() => {}); }
    setBusy(false);
  };
  const move = (m: { cell: number } | { path: number[] }, preview: string) => { setShown(preview); void act(() => api.gameMove(game.id, game.version, m)); };
  const rematch = async () => {
    setBusy(true);
    try {
      const g = await api.gameStart2(chat.id, kind, [game.order[1], game.order[0]], {});
      liveSend(chat.id, 'chat', { game: g.id }); onRematch(g);
    } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };

  const board = shown || game.board || '';
  const status = !playing
    ? game.result === 'draw' ? 'A draw' : game.result === 'idle' ? 'Ended. Nobody moved for a week.'
      : game.winner === me.id ? (game.result === 'resign' ? `${first(person(other))} gave up. You win.` : 'You win')
      : game.winner ? (game.result === 'resign' ? (game.winner === other && inGame ? 'You gave up' : `${first(person(game.winner))} wins`) : `${first(person(game.winner))} wins`)
      : 'Game over'
    : myTurn ? 'Your move' : `${first(person(game.turnPerson || ''))}'s move`;

  return (
    <div className="g-page">
      <header className="g-head">
        <button className="icon-btn g-back" onClick={onClose} aria-label="Back"><Icon name="back" /></button>
        <h2>{GAME_NAME[kind]}</h2>
      </header>
      <div className="d-players">
        {game.order.map((id, k) => (
          <div key={id} className={`d-player ${playing && game.turnPerson === id ? 'up' : ''} ${game.winner === id ? 'won' : ''}`}>
            <Avatar p={person(id)} size={34} />
            <span><b>{id === me.id ? 'You' : first(person(id))}</b>
              <em>{kind === 'ttt' ? <i className="d-mark" style={{ color: k ? ink1 : ink0 }}>{k ? 'O' : 'X'}</i>
                : <><i className="d-dot" style={{ background: k ? ink1 : ink0 }} /> {count(board, k ? 'l' : 'd')} left</>}</em></span>
          </div>
        ))}
      </div>
      <p className={`d-status ${myTurn ? 'mine' : ''}`}>{status}</p>

      {kind === 'ttt'
        ? <TttBoard board={board} game={game} ink0={ink0} ink1={ink1} canMove={myTurn && !busy && !shown}
            onMove={cell => { const mark = game.order[0] === me.id ? 'x' : 'o'; move({ cell }, board.slice(0, cell) + mark + board.slice(cell + 1)); }} />
        : <CheckersBoard board={board} game={game} side={game.order[0] === me.id ? 'd' : 'l'} flip={game.order[1] === me.id} ink0={ink0} ink1={ink1}
            canMove={myTurn && !busy && !shown} onMove={path => move({ path }, applyPath(board, path))} />}

      {playing && !myTurn && inGame && game.turnPerson && (
        <button className="btn wide" disabled={busy || hours6(game.nudgedAt)} onClick={() => void act(() => api.gameNudge(game.id), `Nudged ${first(person(game.turnPerson!))}`)}>
          {hours6(game.nudgedAt) ? `Nudged ${ago(game.nudgedAt!)}` : `Nudge ${first(person(game.turnPerson))}`}
        </button>
      )}
      {!playing && inGame && <button className="btn g-go wide" disabled={busy} onClick={() => void rematch()}>Rematch ({first(person(game.order[1]))} goes first)</button>}
      <p className="g-foot">{playing
        ? `${game.moves || 0} ${game.moves === 1 ? 'move' : 'moves'} so far.${kind === 'checkers' ? ' Tap a piece, then where it goes. For a double jump, tap each landing square.' : ''} A game nobody moves in for a week ends.`
        : `Finished ${game.endedAt ? ago(game.endedAt) : ''}.`}</p>
      {playing && inGame && (
        <button className="link-btn g-endgame" disabled={busy} onClick={() => { if (!sure) { setSure(true); setTimeout(() => setSure(false), 4000); return; } void act(() => api.gameResign(game.id)); }}>
          {sure ? `Tap again to give up. ${first(person(other))} wins.` : 'Give up'}
        </button>
      )}
    </div>
  );
}

function TttBoard({ board, game, ink0, ink1, canMove, onMove }: { board: string; game: Game; ink0: string; ink1: string; canMove: boolean; onMove: (cell: number) => void }) {
  const line = tttLine(board);
  return (
    <div className="d-ttt" role="grid" aria-label="Tic-Tac-Toe board">
      {[...board].map((ch, i) => (
        <button key={i} data-cell={i} className={`d-cell ${line?.includes(i) ? 'win' : ''} ${game.last?.cell === i ? 'last' : ''}`} disabled={!canMove || ch !== '.'}
          onClick={() => onMove(i)} aria-label={ch === '.' ? `Square ${i + 1}, empty` : `Square ${i + 1}, ${ch.toUpperCase()}`}>
          {ch !== '.' && <span style={{ color: ch === 'x' ? ink0 : ink1 }}>{ch === 'x' ? 'X' : 'O'}</span>}
        </button>
      ))}
    </div>
  );
}

function CheckersBoard({ board, game, side, flip, ink0, ink1, canMove, onMove }: {
  board: string; game: Game; side: Side; flip: boolean; ink0: string; ink1: string; canMove: boolean; onMove: (path: number[]) => void;
}) {
  const moves = useMemo(() => (canMove ? legalMoves(board, side) : []), [board, side, canMove]);
  const [path, setPath] = useState<number[]>([]);
  useEffect(() => { setPath([]); }, [board, canMove]);
  const fitting = moves.filter(m => path.every((sq, k) => m[k] === sq));
  const starts = new Set(moves.map(m => m[0]));
  const next = new Set(path.length ? fitting.filter(m => m.length > path.length).map(m => m[path.length]) : []);
  const mustJump = moves.length > 0 && Math.abs(Math.floor(moves[0][1] / 8) - Math.floor(moves[0][0] / 8)) === 2;
  const last = new Set(game.last?.path || []);
  const tap = (i: number) => {
    if (!canMove) return;
    if (next.has(i)) {
      const p = [...path, i];
      const done = fitting.find(m => m.length === p.length && m.every((sq, k) => sq === p[k]));
      if (done && !fitting.some(m => m.length > p.length && p.every((sq, k) => m[k] === sq))) { setPath([]); onMove(done); return; }
      setPath(p); return;
    }
    if (starts.has(i)) { setPath(path[0] === i && path.length === 1 ? [] : [i]); return; }
    if (path.length) setPath([]);
    if (board[i].toLowerCase() === side) toast(mustJump ? 'You have a jump, and jumps are a must.' : 'That piece has no move.');
  };
  // after the first tap of a multi-jump, show the piece where it is now
  const shown = path.length > 1 ? applyPath(board, path) : board;
  const squares = Array.from({ length: 64 }, (_, k) => (flip ? 63 - k : k));
  return (<>
    <div className="d-checkers" role="grid" aria-label="Checkers board">
      {squares.map(i => {
        const dark = (Math.floor(i / 8) + (i % 8)) % 2 === 1;
        const ch = shown[i];
        const sel = path.length > 0 && path[path.length - 1] === i;
        return (
          <button key={i} data-sq={i} className={`d-sq ${dark ? 'dark' : ''} ${sel ? 'sel' : ''} ${next.has(i) ? 'to' : ''} ${last.has(i) ? 'last' : ''} ${!path.length && starts.has(i) ? 'can' : ''}`}
            disabled={!dark} onClick={() => tap(i)} aria-label={dark ? `Square ${i}${ch !== '.' ? `, ${ch === ch.toUpperCase() ? 'king' : 'piece'}` : ''}` : undefined}>
            {ch && ch !== '.' && <span className={`d-pc ${ch === ch.toUpperCase() ? 'king' : ''}`} style={{ background: ch.toLowerCase() === 'd' ? ink0 : ink1 }} />}
          </button>
        );
      })}
    </div>
    {canMove && mustJump && <p className="g-meta d-hint">You have a jump. Jumps are a must.</p>}
  </>);
}
