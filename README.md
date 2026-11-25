# Holler

Private video messages for a few people (Marco Polo style), with the extras other apps charge for:
HD, playback speed, voice filters, video looks, draw and text on video, live captions + transcripts,
reactions at the moment, Saved forever, download, upload from camera roll, voice-only and text notes,
chat colors, "recording now" and "here now" presence, push notifications, multi-device.

Free stack: GitHub Pages (static app) + figgg's free Supabase project, walled into the `holler` schema.

- `supabase/holler.sql`: schema + `public.holler_*` RPCs (token-gated) + storage bucket `holler` and its policies.
- `supabase/push.sql` + `supabase/functions/holler-push`: web push on new polos.
- `scripts/sb.mjs`: Management API helper (`MSYS_NO_PATHCONV=1 node scripts/sb.mjs sql file.sql`). Never prints the token.
- `src/lib/studio.ts`: camera -> WebGL looks + overlay -> MediaRecorder. `src/lib/voice.ts`: voice filters.
- Dev: `npm run dev` (port 5188). Build: `npm run build`. QA: `node scripts/qa.mjs` (two fake users, fake camera).

Limits on the free plan: 1 GB of video total, 5 GB of downloads a month shared with figgg. Watched
hollers are cached on each device so replays cost nothing. Max file 50 MB (about 5 min SD, 2.5 min HD).
Never add holler tables to figgg's `public` schema.
