import { useLayoutEffect, useMemo, useRef, type ReactElement } from 'react';
import { publicUrl, type ChatFull, type Person, type Polo } from '../lib/api';
import { discard, retry, type Outgoing } from '../lib/outbox';
import { Avatar, ago, clock, dayLabel, tone } from './bits';
import { Icon } from './icons';
import { Leaving } from './Leaving';

/** One thing in the thread: a holler (video or voice), a note, or a stack of answers to one card. */
type Item = { key: string; author: string; at: string; kind: 'tile' | 'note' | 'stack'; p: Polo; i: number; stack: Polo[]; unseen: boolean };
type Block =
  | { t: 'day'; key: string; label: string }
  | { t: 'new'; key: string }
  | { t: 'run'; key: string; author: string; items: Item[] };

/**
 * The room's thread: everything said in this chat, top to bottom, newest at the bottom.
 * Theirs on the left, yours on the right; notes read in place. Pure: ChatScreen feeds it.
 */
export function Thread({ chat, me, polos, pend, others, recordingNow, watchingNow, unreadCount, onOpen, onWatchNew, openLeaving }: {
  chat: ChatFull | null; me: Person; polos: Polo[]; pend: Outgoing[]; others: Person[];
  recordingNow: Person[]; watchingNow: Person | null; unreadCount: number;
  onOpen: (list: Polo[], i: number) => void; onWatchNew: () => void; openLeaving?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const members = chat?.members || [];
  const who = (id: string) => members.find(m => m.id === id);
  const group = members.length > 2;

  const { blocks, items } = useMemo(() => {
    const items: Item[] = [];
    const stacked = new Set<string>();
    polos.forEach((p, i) => {
      const cid = typeof p.effects?.cardId === 'string' ? (p.effects.cardId as string) : null;
      const stack = cid ? polos.filter(x => x.effects?.cardId === cid) : [];
      if (cid && stack.length > 1) {
        if (stacked.has(cid)) return;
        stacked.add(cid);
        const unseen = stack.some(x => x.author !== me.id && !x.views.some(v => v.who === me.id));
        items.push({ key: p.id, author: p.author, at: p.at, kind: 'stack', p, i, stack, unseen });
        return;
      }
      const unseen = p.author !== me.id && !p.views.some(v => v.who === me.id);
      items.push({ key: p.id, author: p.author, at: p.at, kind: p.kind === 'text' ? 'note' : 'tile', p, i, stack: [], unseen });
    });
    const days = new Set(items.map(it => new Date(it.at).toDateString()));
    const manyDays = days.size > 1;
    const firstNew = items.find(it => it.unseen);
    const blocks: Block[] = [];
    let lastDay = '';
    let run: Extract<Block, { t: 'run' }> | null = null;
    for (const it of items) {
      const d = new Date(it.at).toDateString();
      if (d !== lastDay) { lastDay = d; run = null; if (manyDays) blocks.push({ t: 'day', key: `d-${it.key}`, label: dayLabel(it.at) }); }
      if (it === firstNew) { run = null; blocks.push({ t: 'new', key: 'new' }); }
      if (!run || run.author !== it.author) { run = { t: 'run', key: `r-${it.key}`, author: it.author, items: [] }; blocks.push(run); }
      run.items.push(it);
    }
    return { blocks, items };
  }, [polos, me.id]);

  const shownPend = pend.filter(o => !o.polo.effects?.game || o.error);

  // where the thread sits: on the new line when there is something new, else at the bottom; after that it follows
  // new things only when you were already near the bottom, or when they are yours
  const placed = useRef(false);
  const near = useRef(true);
  const count = useRef(0);
  const total = items.length + shownPend.length;
  const lastMine = shownPend.length > 0 || items[items.length - 1]?.author === me.id;
  useLayoutEffect(() => {
    const el = ref.current; if (!el || !chat) return;
    if (!placed.current) {
      placed.current = true; count.current = total;
      const line = el.querySelector<HTMLElement>('.thread-new');
      el.scrollTop = line ? Math.max(0, line.offsetTop - el.clientHeight / 3) : el.scrollHeight;
      near.current = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
      return;
    }
    if (total > count.current && (near.current || lastMine)) el.scrollTop = el.scrollHeight;
    count.current = total;
  }, [chat, total, lastMine]);
  const onScroll = () => { const el = ref.current; if (el) near.current = el.scrollHeight - el.scrollTop - el.clientHeight < 150; };

  const tile = (it: Item) => {
    const p = it.p;
    if (it.kind === 'stack') {
      return (
        <button key={it.key} className={`tile g-stack ${it.unseen ? 'new' : ''} ${p.author === me.id ? 'mine' : ''}`} onClick={() => onOpen(it.stack, 0)}>
          <b>{String(p.effects?.card || 'Card')}</b>
          <span className="g-stack-faces">{it.stack.slice(0, 4).map(x => <Avatar key={x.id} p={who(x.author)} size={15} />)}</span>
        </button>
      );
    }
    const author = who(p.author);
    const mine = p.author === me.id;
    const seen = !it.unseen;
    const label = `${mine ? 'Your' : `${author?.name.split(' ')[0] || 'Someone'}'s`} ${p.kind === 'text' ? 'note' : p.kind === 'audio' ? 'voice holler' : 'holler'}, ${ago(p.at)}${seen ? '' : ', new'}`;
    if (it.kind === 'note') {
      return (
        <button key={it.key} className={`note-bub ${seen ? '' : 'new'} ${mine ? 'mine' : ''}`} style={{ ['--c' as string]: tone(author?.color) }} onClick={() => onOpen(polos, it.i)} aria-label={label}>
          {p.body}
        </button>
      );
    }
    const orig = p.reactTo ? polos.find(x => x.id === p.reactTo) : undefined;
    return (
      <button key={it.key} className={`tile ${seen ? '' : 'new'} ${mine ? 'mine' : ''}`} style={{ ['--c' as string]: tone(author?.color) }} onClick={() => onOpen(polos, it.i)} aria-label={label}>
        {orig?.thumb && <span className="g-tile-pip"><img src={publicUrl(orig.thumb)} alt="" loading="lazy" /></span>}
        {p.kind === 'video' && p.thumb ? <img src={publicUrl(p.thumb)} alt="" loading="lazy" />
          : <span className="tile-audio"><Avatar p={author} size={34} /><Icon name="wave" size={16} /></span>}
        <span className="tile-av"><Avatar p={author} size={20} /></span>
        {p.duration ? <span className="tile-dur">{clock(p.duration)}</span> : null}
        {p.savedBy.includes(me.id) && <span className="tile-star"><Icon name="bookmark" size={12} fill="currentColor" /></span>}
        {p.leavesAt && <span className="tile-leave" title="Leaving soon"><Icon name="timer" size={12} stroke={2.6} /></span>}
        {mine && others.length > 0 && (() => {
          const seenBy = others.filter(o => p.views.some(v => v.who === o.id));
          return seenBy.length
            ? <span className={`tile-seen ${seenBy.length === others.length ? 'all' : ''}`} title={`Seen by ${seenBy.map(o => o.name.split(' ')[0]).join(', ')}`}>{seenBy.slice(0, 3).map(o => <Avatar key={o.id} p={o} size={16} />)}</span>
            : <span className="tile-seen none" title="Not watched yet"><Icon name="check" size={12} stroke={3} /></span>;
        })()}
      </button>
    );
  };

  // inside a run, hollers and stacks flow in a row and wrap; a note always takes its own line
  const lines = (its: Item[]) => {
    const out: ReactElement[] = []; let row: Item[] = [];
    const flush = () => { if (row.length) { out.push(<div key={`l-${row[0].key}`} className="run-row">{row.map(tile)}</div>); row = []; } };
    for (const it of its) { if (it.kind === 'note') { flush(); out.push(tile(it)); } else row.push(it); }
    flush();
    return out;
  };

  return (
    <div className="thread" ref={ref} onScroll={onScroll}>
      {chat && <Leaving chat={chat} me={me} openNow={openLeaving} onWatch={p => { const i = polos.findIndex(x => x.id === p.id); if (i >= 0) onOpen(polos, i); else onOpen([p], 0); }} />}
      {!chat && shownPend.length === 0 && <div className="run-row">{[0, 1, 2, 3].map(i => <span key={i} className="tile-sk" aria-hidden="true" />)}</div>}
      {chat && items.length === 0 && shownPend.length === 0 && <div className="thread-empty">{others.length ? 'No hollers yet. Say hi.' : 'Invite your people, then say hi.'}</div>}
      {blocks.map(b => {
        if (b.t === 'day') return <div key={b.key} className="thread-day">{b.label}</div>;
        if (b.t === 'new') return (
          <div key={b.key} className="thread-new">
            <button className="new-pill" onClick={onWatchNew}><Icon name="play" size={16} fill="currentColor" /> Watch {unreadCount} new</button>
          </div>
        );
        const mine = b.author === me.id;
        const named = group && !mine;
        const author = who(b.author);
        return (
          <div key={b.key} className={`run ${mine ? 'mine' : 'theirs'} ${named ? 'named' : ''}`}>
            {named && <div className="run-name">{author?.name.split(' ')[0] || 'Someone'}</div>}
            <div className="run-body">
              {named && <span className="run-av"><Avatar p={author} size={28} /></span>}
              <div className="run-lines">{lines(b.items)}</div>
            </div>
          </div>
        );
      })}
      {shownPend.length > 0 && (
        <div className="run mine"><div className="run-body"><div className="run-lines"><div className="run-row">
          {shownPend.map(o => (
            <div key={o.key} className={`tile mine pending ${o.error ? 'failed' : ''}`} style={{ ['--c' as string]: tone(me.color) }}>
              {o.polo.pending?.thumbUrl ? <img src={o.polo.pending.thumbUrl} alt="" /> : <span className="tile-audio"><Icon name="wave" /></span>}
              {o.error ? (
                <span className="tile-fail">
                  <button onClick={() => retry(o.key)}>Retry</button>
                  <button onClick={() => discard(o.key)}>Delete</button>
                </span>
              ) : <span className="tile-prog"><i style={{ width: `${Math.round(o.progress * 100)}%` }} /></span>}
            </div>
          ))}
        </div></div></div></div>
      )}
      {(recordingNow.length > 0 || watchingNow) && (
        <div className="thread-now">
          {recordingNow.length > 0
            ? recordingNow.map(o => <div key={o.id} className="rec-banner"><Avatar p={o} size={26} /> <b>{o.name.split(' ')[0]}</b> is recording<span className="dots"><i /><i /><i /></span></div>)
            : watchingNow && <div className="rec-banner watch"><Avatar p={watchingNow} size={26} /> <b>{watchingNow.name.split(' ')[0]}</b> is watching</div>}
        </div>
      )}
    </div>
  );
}
