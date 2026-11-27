# Holler speed pass + "new version" pop-up: brief for builder-opus
Date: 2026-11-27 · Repo: C:\Users\bowle\Code\holler · Branch: holler/polish-11-27 (already checked out) · Author: lead session

## 1. Decision (what and why)
Holler (private Marco Polo style video chat for Dixon and friends, React 19 + Vite, Supabase RPCs, GitHub Pages) feels slow in the places people wait: opening the app (blank pulse until `holler_home` answers), reopening a chat (skeleton until `holler_chat` answers), sending (thumb uploads before the video starts), and first watch of a holler (the whole file downloads into Cache Storage before it plays, on purpose, so replays cost no data on a tight free egress budget). We are keeping the download-then-play rule (do NOT switch first watch to streaming from the network URL: that doubles egress). Instead we make waits shorter or invisible: paint from what we already know, prefetch what people are about to watch, upload in parallel. Second job: people keep running an old build on their iPhone Home Screen, so the app should notice a new deploy and say so with a small pop-up.

## 2. Files you own
- `src/App.tsx` : instant paint from cached home, update pop-up mount, relax home polling
- `src/lib/api.ts` : chat cache (`peekChat`), `prefetch()` helper, any fetch tuning. NOTE: the lead already added `Profile`, `ProfileStats`, `Person.joined/profile` and `api.profile` at the top; leave those as they are.
- `src/lib/outbox.ts` : thumb and video upload in parallel, anything else that shortens a send without risking it
- `src/lib/live.ts` : only if needed (for example exporting "is this chat's channel connected" so pollers can back off)
- `src/ui/Player.tsx` : prefetch the next holler while one plays, better waiting state on first watch
- `src/ui/Saved.tsx` : same waiting-state polish if it shares the player
- `public/sw.js` : only if the update flow needs it
- `vite.config.ts`, `src/main.tsx` : build stamp, version.json, vendor chunk
- NEW `src/ui/Update.tsx` + NEW `src/ui/update.css` : the pop-up
Touch nothing else. The lead is editing `src/ui/ChatScreen.tsx`, `src/lib/studio.ts`, `src/games/*`, `src/ui/HomeScreen.tsx`, `src/ui/Settings.tsx`, `src/ui/ChatInfo.tsx`, `src/ui/bits.tsx`, `src/styles.css` at the same time. If you need a change there, put it under OPEN in your report.

## 3. Hard rules
- Never commit, push, deploy, or run SQL. Never run the `scripts/qa*.mjs` suites or `clean-qa*` (they write to the real database; the lead runs them at the end).
- No new npm dependencies. No emojis anywhere. No em or en dashes in any words people see.
- Keep the egress rule: a holler's media is downloaded once (Cache Storage `holler-media-v1` via `mediaUrl()`), never streamed and downloaded twice.
- iPhone Home Screen app quirks are real (read `src/lib/device.ts` and the comments in `src/lib/studio.ts` bottom section): never change `location.hash` on iPhone standalone, never reload the page except when the person taps Restart.
- The tree is dirty from the lead's parallel work: build on what is there, never revert files you don't own.
- Do your recon first (read the owned files and their callers), write a short plan to the scratchpad, then build.

## 4. Intent
1. **Instant open.** Save the last `Home` JSON to localStorage (key `holler.home.v1`, store `{ token-hash-or-first-8-chars, home }` so a different signed-in person never sees someone else's cache). On start, if signed in and a cache exists, render HomeScreen from it at once and refresh in the background. Sign-out and the `#/link/<token>` switch must clear it. Keep the existing error/try-again path for a first ever launch.
2. **Instant chat reopen.** In `api.ts`, keep every `api.chat()` result in an in-memory Map and export `peekChat(id): ChatFull | null`. The lead will use it in ChatScreen as the starting state. Cap it (say 8 chats) so memory stays small.
3. **Prefetch.** Export `prefetch(paths: string[], budgetBytes = 30 MB)` from api.ts: warms `mediaUrl()` one file at a time (not in parallel, so it never fights a send or a play), skips anything already cached, stops at the byte budget, and pauses while `document.hidden`. Player: while a holler plays, prefetch the next one in the list. The lead will call `prefetch` for a chat's unread hollers.
4. **First watch wait.** In Player, while the file downloads, show the thumbnail full screen with a clear progress ring or bar (download percent if you can get it from the fetch stream; `mediaUrl` may need an onProgress variant). Must still work when the cache is unavailable (falls back to the public URL as today).
5. **Faster sends.** In outbox `run()`, start the thumb and the video uploads together (Promise.all), progress still adds up to 1. Keep every existing safety: tus resume for big files, undo window, persist, abort, cleanup.
6. **Polling.** App polls home every 20 s when not in a chat. If live.ts can tell a channel is connected, back off to 60 s while connected; otherwise leave it.
7. **New version pop-up.** At build time stamp a version (build timestamp is fine) into the bundle (`define: { __HOLLER_BUILD__: ... }`) and write `version.json` into dist with the same value (a tiny Vite plugin `generateBundle` / `writeBundle`). The app fetches `./version.json?t=<now>` with `cache: 'no-store'` when it comes back on screen and every 10 minutes while visible (not in dev). When the version differs from the running one, show a small card at the top of the screen (not a full-screen block): title "A new Holler is ready", line "Restart to get it. If it still looks the same, close Holler all the way and open it again.", buttons "Restart" and "Later". Restart = `location.reload()`, but if `busy()` from outbox is true, the button says "Restart after it sends" and does that when the outbox goes quiet. Never show it while recording: a recording chat screen has the class `chat is-rec` on its root, so checking `document.querySelector('.chat.is-rec')` is acceptable; wait and show it after. "Later" hides it until the next version or the next launch. Look: use the existing tokens in `src/styles.css` (`--surface`, `--ink`, `--display`, radius `--r-tile`), solid block, no blur/glass; match how `.net-off` and toasts look (read `src/styles.css` for them).
8. **Vendor chunk.** Split react, react-dom and @supabase/* into their own chunk(s) so a deploy only changes the app chunk and phones re-download less. Check `dist/assets` sizes before and after. Rule from the last session: nothing in the first download may import `src/games/all.ts`; after a build `grep -c pearlfish dist/assets/index-*.js` must print 0.

## 5. Verification
- Run: `npm run build` (tsc + vite). Then `npx vite preview --port 5189` and load http://localhost:5189/ in a Playwright script of your own that only READS (no sign-up): confirm the page loads, `version.json` is served, and with a fake `holler.home.v1` in localStorage plus a fake token the home renders from cache before the network answers (the RPC will fail with "not signed in"; it is fine to stub `holler_home` with `page.route`).
- Show the update card by serving a different version.json via `page.route`; screenshot it at 390x844.
- Screenshots to `<your scratchpad>/shots/`: `01-update-card.png`, `02-home-from-cache.png`.
- Checks JSON (all true when you report):
```json
{ "build_passes": true, "no_games_in_first_download": true, "version_json_emitted": true, "update_card_shows_on_new_version": true, "home_paints_from_cache": true, "thumb_and_video_upload_in_parallel": true, "peekChat_and_prefetch_exported": true }
```

## 6. Report format (fixed)
```
STATUS: done | partial | blocked
FILES TOUCHED: <paths>
WHAT CHANGED: <three to six lines, plain words>
CHECKS: <the JSON above, filled in>
SCREENSHOTS: <paths>
VERIFIED vs BELIEVED: <one line each>
OPEN / BLOCKED: <anything you could not do, and why>
```
