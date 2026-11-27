// A person's profile: their color and photo, the few words they picked, how they record (their look and voice),
// and what they've done in the chats you share. Opens from the people list in chat info, and from You.
import { useEffect, useState } from 'react';
import { useApp } from '../App';
import { api, type Person, type ProfileStats } from '../lib/api';
import { lookOf } from '../lib/looks';
import { VOICES } from '../lib/voice';
import { Avatar, Sheet, ago, tone } from './bits';
import { Icon } from './icons';

const since = (iso?: string | null) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); } catch { return ''; }
};

export function ProfileSheet({ person, onClose, status }: { person: Person | null; onClose: () => void; status?: string }) {
  const { home, go } = useApp();
  const [full, setFull] = useState<(Person & { stats: ProfileStats }) | null>(null);
  const [failed, setFailed] = useState(false);
  const id = person?.id;
  useEffect(() => {
    setFull(null); setFailed(false);
    if (id) api.profile(id).then(setFull).catch(() => setFailed(true));
  }, [id]);
  const p = full || person;
  if (!p) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const isMe = p.id === home?.me.id;
  const pr = isMe ? { ...p.profile, ...pick(home!.me.prefs) } : p.profile || {};
  const look = pr.look && pr.look !== 'none' ? lookOf(pr.look) : null;
  const voice = pr.voice && pr.voice !== 'none' ? VOICES.find(v => v.id === pr.voice) : null;
  const st = full?.stats;
  const first = p.name.split(' ')[0];
  const words = !!(pr.about || pr.into || pr.song);

  return (
    <Sheet open={!!person} onClose={onClose} title={isMe ? `${p.name} (you)` : p.name} className="prof" you={tone(p.color)}>
      <div className="prof-hero">
        <Avatar p={p} size={112} />
        <div className="prof-when">
          {status ? <b className="prof-now">{status}</b> : !isMe && p.lastSeen ? <b>Active {ago(p.lastSeen)}</b> : null}
          {(p.joined || full?.joined) && <span>On Holler since {since(p.joined || full?.joined)}</span>}
        </div>
      </div>

      {pr.about ? <p className="prof-about">{pr.about}</p>
        : <p className="prof-about empty">{isMe ? 'Add a few words so your people know what you are up to.' : `${first} hasn't written anything yet.`}</p>}
      {(pr.into || pr.song) && (
        <dl className="prof-rows">
          {pr.into && <div><dt>Into lately</dt><dd>{pr.into}</dd></div>}
          {pr.song && <div><dt>On repeat</dt><dd>{pr.song}</dd></div>}
        </dl>
      )}

      {(look || voice) && (
        <div className="prof-style">
          <span className="lbl">How {isMe ? 'you' : first} hollers</span>
          <div className="row gap wrap">
            {look && <span className="chip on"><Icon name="wand" size={14} /> {look.label}</span>}
            {voice && <span className="chip on"><Icon name="mic" size={14} /> {voice.label}</span>}
          </div>
        </div>
      )}

      <span className="lbl">{isMe ? 'You, in your chats' : `${first}, in chats with you`}</span>
      <div className="prof-stats" aria-busy={!st && !failed}>
        <Stat n={st?.hollers} label={st?.hollers === 1 ? 'holler' : 'hollers'} />
        {st && (st.seconds ?? 0) < 120
          ? <Stat n={Math.round(st.seconds ?? 0)} label={Math.round(st.seconds ?? 0) === 1 ? 'second recorded' : 'seconds recorded'} />
          : <Stat n={st ? Math.round((st.seconds ?? st.minutes * 60) / 60) : undefined} label="minutes recorded" />}
        <Stat n={st?.notes} label={st?.notes === 1 ? 'note' : 'notes'} />
        <Stat n={st?.wins} label={st ? `${st.wins === 1 ? 'win' : 'wins'} in ${st.games} ${st.games === 1 ? 'game' : 'games'}` : 'wins'} />
      </div>
      {failed && <p className="fine">Couldn't load the numbers right now.</p>}

      {isMe && <button className="btn primary wide" onClick={() => { onClose(); go('/settings'); }}>{words ? 'Edit your profile' : 'Fill in your profile'}</button>}
    </Sheet>
  );
}

const pick = (pf?: Person['prefs']) => {
  const o: Record<string, string> = {};
  for (const k of ['about', 'into', 'song', 'look', 'voice'] as const) { const v = pf?.[k]; if (typeof v === 'string' && v) o[k] = v; }
  return o;
};

function Stat({ n, label }: { n?: number; label: string }) {
  return <div className="prof-stat"><b>{n === undefined ? <i className="sk-num" /> : n}</b><span>{label}</span></div>;
}
