import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { publicUrl, type ChatFull, type Person, type Polo } from '../lib/api';
import { isIPhone, keptIds, saveToPhone } from '../lib/keep';
import { Avatar, Sheet, clock, toast } from './bits';
import { Icon } from './icons';
import './leaving.css';

/** "today", "tomorrow", or the day's name: when a holler is taken out of its chat. */
function leaveDay(iso: string) {
  const d = new Date(iso), now = new Date();
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return days < 7 ? `on ${d.toLocaleDateString(undefined, { weekday: 'long' })}` : `on ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

/**
 * What is on its way out of this chat. A slim bar pinned to the top of the thread says how many and when; it opens a
 * sheet that lists each one with a single button: Save to camera roll. There is no way to keep one inside Holler.
 * Shows nothing unless the chat has something leaving (which is never, while the limit is switched off).
 */
export function Leaving({ chat, me, onWatch, openNow }: { chat: ChatFull; me: Person; onWatch: (p: Polo) => void; openNow?: boolean }) {
  const list = chat.leaving || [];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Record<string, number | 'again'>>({});   // id -> 0..1 while the file comes, or 'again'
  const [kept, setKept] = useState(() => keptIds());
  // the ping's link (/c/<id>/leaving) opens the list once, as soon as the chat has loaded
  const opened = useRef(false);
  useEffect(() => { if (openNow && list.length && !opened.current) { opened.current = true; setOpen(true); } }, [openNow, list.length]);
  if (!list.length) return null;
  const who = (id: string) => chat.members.find(m => m.id === id);
  const first = list[0].leavesAt as string;
  const sameDay = list.every(p => leaveDay(p.leavesAt as string) === leaveDay(first));
  const n = list.length;
  const line = n === 1 ? `1 holler leaves ${leaveDay(first)}` : sameDay ? `${n} hollers leave ${leaveDay(first)}` : `${n} hollers leaving, the first ${leaveDay(first)}`;
  const mins = Math.round((chat.keepSeconds || 720) / 60);

  const save = async (p: Polo) => {
    if (typeof busy[p.id] === 'number') return;
    setBusy(b => ({ ...b, [p.id]: 0 }));
    try {
      const r = await saveToPhone(p, who(p.author), f => setBusy(b => (typeof b[p.id] === 'number' ? { ...b, [p.id]: f } : b)));
      setBusy(b => { const x = { ...b }; if (r === 'again') x[p.id] = 'again'; else delete x[p.id]; return x; });
      if (r === 'saved') { setKept(keptIds()); toast(p.kind === 'audio' ? 'Saved to this phone' : isIPhone() ? 'Done. If you picked Save Video, it is in your camera roll.' : 'Saved to this device'); }
    } catch (e) {
      setBusy(b => { const x = { ...b }; delete x[p.id]; return x; });
      toast((e as Error).message || 'Could not save that one. Try again on wifi.');
    }
  };

  return (
    <>
      <button className="leaving-bar" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Icon name="timer" size={18} /><b>{line}</b><span>Save them</span>
      </button>
      {/* the list opens over the whole room, like every other sheet, not inside the thread's own box */}
      {createPortal(<Sheet open={open} onClose={() => setOpen(false)} title="Leaving soon" room={chat.theme || 'ember'} className="leaving-sheet">
        <p className="leaving-why">This chat keeps its newest {mins} minutes of video and voice. These are past that. Save any you want to your camera roll before they go.</p>
        <ul className="leaving-list">
          {list.map(p => {
            const a = who(p.author); const st = busy[p.id]; const mine = p.author === me.id;
            const label = p.kind === 'audio' ? 'Save to this phone' : 'Save to camera roll';
            return (
              <li key={p.id}>
                <button className="leaving-pic" onClick={() => { setOpen(false); onWatch(p); }} aria-label={`Watch ${mine ? 'your' : `${a?.name.split(' ')[0] || 'their'}`} holler`}>
                  {p.kind === 'video' && p.thumb ? <img src={publicUrl(p.thumb)} alt="" loading="lazy" /> : <span className="leaving-voice"><Avatar p={a} size={30} /><Icon name="wave" size={14} /></span>}
                </button>
                <div className="leaving-main">
                  <b>{mine ? 'You' : a?.name.split(' ')[0] || 'Someone'}{p.game ? ' · game clip' : p.kind === 'audio' ? ' · voice' : ''}{p.duration ? ` · ${clock(p.duration)}` : ''}</b>
                  <em>Leaves {leaveDay(p.leavesAt as string)}{kept.has(p.id) ? ' · saved from this phone' : ''}</em>
                  <button className="btn leaving-save" onClick={() => void save(p)} disabled={typeof st === 'number'}>
                    <Icon name="download" size={18} />
                    {typeof st === 'number' ? `Getting it ready${st > 0 && st < 1 ? ` ${Math.round(st * 100)}%` : ''}` : st === 'again' ? 'Ready. Tap to save' : label}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="fine">{isIPhone() ? 'On iPhone, tap the button, then Save Video. ' : ''}Notes stay. A saved copy lives on your phone, not in Holler.</p>
      </Sheet>, document.querySelector('.chat') || document.body)}
    </>
  );
}
