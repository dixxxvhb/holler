import { useEffect, useState } from 'react';
import { useApp } from '../App';
import { api, publicUrl, type ChatFull, type Polo } from '../lib/api';
import { ago, tone } from './bits';
import { Icon } from './icons';
import { Player } from './Player';

export function Saved() {
  const { home, go } = useApp();
  const [list, setList] = useState<Polo[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const load = () => api.saved().then(setList).catch(() => setList([]));
  useEffect(() => { void load(); }, []);
  const me = home!.me;
  const people = new Map(home!.chats.flatMap(c => c.members).map(m => [m.id, m]));
  const fakeChat = { members: [...people.values()] } as unknown as ChatFull;

  return (
    <div className="page" data-you="" style={{ ['--room' as string]: tone(me.color) }}>
      <header className="page-top">
        <button className="icon-btn" onClick={() => go('/')} aria-label="Back"><Icon name="back" /></button>
        <h1>Saved</h1><span />
      </header>
      {list === null ? <div className="spinner static" /> : list.length === 0 ? (
        <div className="empty"><h2>Nothing saved yet</h2><p className="muted">Tap Save while watching a holler to keep it here, even years from now.</p></div>
      ) : (
        <div className="grid">
          {list.map((p, i) => {
            const a = people.get(p.author);
            return (
              <button key={p.id} className="g-tile" onClick={() => setOpen(i)} style={{ ['--c' as string]: tone(a?.color) }}>
                {p.thumb ? <img src={publicUrl(p.thumb)} alt="" loading="lazy" /> : p.kind === 'text' ? <span className="tile-text">{p.body}</span> : <Icon name="wave" size={30} />}
                <span className="g-cap">{a?.name.split(' ')[0]} · {ago(p.at)}</span>
              </button>
            );
          })}
        </div>
      )}
      {open !== null && list && <Player chat={fakeChat} list={list} start={open} me={me} standalone onClose={() => { setOpen(null); void load(); }} />}
    </div>
  );
}
