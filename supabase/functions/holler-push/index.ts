// Holler push sender. Called by the database trigger (supabase/push.sql) with a shared secret.
// Body: { title, body, chat, url, subs: [{ endpoint, sub }] }
import webpush from 'npm:web-push@3.6.7';
import postgres from 'npm:postgres@3.4.4';

const SECRET = Deno.env.get('HOLLER_PUSH_SECRET') ?? '';
webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:holler@example.com',
  Deno.env.get('VAPID_PUBLIC') ?? '',
  Deno.env.get('VAPID_PRIVATE') ?? '',
);

function same(a: string, b: string) {
  if (!b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method', { status: 405 });
  if (!same(req.headers.get('x-holler-secret') ?? '', SECRET)) return new Response('no', { status: 401 });
  let j: any;
  try { j = await req.json(); } catch { return new Response('bad json', { status: 400 }); }
  const subs: { endpoint: string; sub: any }[] = Array.isArray(j.subs) ? j.subs : [];
  const payload = JSON.stringify({ title: j.title ?? 'Holler', body: j.body ?? '', chat: j.chat ?? '', url: j.url ?? '' });

  const dead: string[] = [];
  let sent = 0, failed = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(s.sub, payload, { TTL: 60 * 60 * 24, urgency: 'high' });
      sent++;
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(s.endpoint);
      else { failed++; console.log('push failed', e?.statusCode, String(e?.body ?? e?.message ?? e).slice(0, 200)); }
    }
  }));

  if (dead.length) {
    const url = Deno.env.get('SUPABASE_DB_URL');
    if (url) {
      const sql = postgres(url, { max: 1, prepare: false });
      try { await sql`delete from holler.push_subs where endpoint = any(${dead})`; }
      catch (e) { console.log('cleanup failed', String(e)); }
      finally { await sql.end({ timeout: 2 }); }
    }
  }
  console.log(JSON.stringify({ sent, failed, removed: dead.length }));
  return Response.json({ sent, failed, removed: dead.length });
});
