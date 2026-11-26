# Holler look: build brief for builder-opus
Date: 2026-11-26 · Repo: ~/Code/holler-look (git worktree of ~/Code/holler) · Branch: ui/holler-look · Author: lead session (Opus), design by Fable

## 1. Decision
Implement Fable's design system, "blocks", across the whole app exactly as specified in
`docs/plans/2026-11-26-holler-look.md` (the spec) with `mockup/holler-look.html` as the visual reference
(its CSS is written against the real class names, so lift it). Every chat is a solid block of its color and
pattern; a room is color band, picture, color deck; no glass, no blur. The rejected alternative is keeping
the full-bleed camera under a scrim; that's only the fallback in spec section 13, and you don't build it.
The three copy changes in spec section 12 are approved: build them. "Catch up" (spec section 14) is NOT in
scope.

## 2. Files you own
- `src/styles.css`: rewrite to the spec.
- `src/ui/*.tsx` (bits, HomeScreen, ChatScreen, Player, ChatInfo, Settings, Saved, Onboard, icons): only the
  markup changes in spec section 9, plus anything else the spec's screens strictly need. No logic changes
  beyond those listed (the AbortError share fix, the theme pick plus `chatUpdate` on new chat, the
  ResizeObserver writing `--bottom-h` on the root).
- `index.html`, `public/manifest.webmanifest`: fonts, theme and background color.
- `scripts/_layout-i15.mjs` (scratch, uncommitted) and `scripts/layout.mjs`: you may add screenshot states
  (empty home, new chat sheet, join sheet, onboarding, voice only, saved). Keep `layout.mjs`'s setup the same.
Touch nothing else. `src/lib/*`, `src/games/*`, `supabase/*` are off limits (another session builds games on
`main` and owns `src/games/`, `api.ts`, `studio.ts`). If you need another file, stop and report it.

## 3. Hard rules
- Don't commit or push; the lead does. Don't rename or move files.
- Keep every hook in spec section 11, and keep the button and label text the scripts click word for word.
- Keep the old CSS variable names as aliases (spec section 2); the games session's `src/games/games.css` will
  use `--accent`, `--panel`, `--ink`, `--surface`, `--radius` and the rest.
- No emojis, no theatre language, no gold, Google Fonts only, no new npm dependencies.
- Do your own recon first: read the spec end to end, the mockup, and each file before you edit it. Write
  your edit plan to your scratchpad, then build in the spec's order (section 10, steps 1 to 9).

## 4. Intent
The spec is the intent; follow it rather than re-deciding it. Where it's silent, match the mockup. Where the
mockup and the real app disagree (real data, long names, 1 vs 5 members, a 375x667 iPhone SE, desktop width
over 700px), make the real app look like the mockup's idea, and list each such call in your report.
Designed states that must exist: empty home, one chat, many chats, unread, someone recording, empty strip,
pending and failed tiles, camera denied, camera off, voice only, recording, paused, countdown, every panel,
player for video, voice and text, toasts, long chat names, and desktop width.

## 5. Verification
- `npm run build` must pass (tsc + vite).
- Dev server: `npx vite --port 5190 --host 127.0.0.1` from the worktree (the lead may already have it running;
  check `curl -s localhost:5190` first). Playwright's Chromium is installed.
- Screenshots: `node scripts/_layout-i15.mjs http://127.0.0.1:5190/` reuses one QA chat via `shots/.qa.json`
  (it makes one the first time). Then `node scripts/layout.mjs http://127.0.0.1:5190/` once at the end for
  all four sizes (it makes one extra QA pair; that's fine). Look at every screenshot yourself, compare with
  the mockup, and iterate at least three times on the room, home and player before you call it done.
- QA scripts after the room and after the player: `node scripts/qa.mjs http://127.0.0.1:5190/`, then
  `qa-features.mjs`, `qa-looks.mjs`, `qa-seen.mjs`, `qa-simple.mjs`, `qa-flip.mjs`. They create QA people in
  the real database; DON'T run `clean-qa.mjs` (it only works on the PC; the lead cleans up).
- `grep -n 'backdrop-filter\|blur(' src/styles.css`: no blur over live video.
- Checks JSON, every value true when you report:
```json
{
  "build_passes": false,
  "all_qa_scripts_pass": false,
  "every_hook_in_spec_11_present": false,
  "no_blur_over_video": false,
  "old_css_variable_names_still_defined": false,
  "screens_match_mockup_at_390": false,
  "se_375x667_room_usable": false,
  "desktop_over_700_looks_intentional": false
}
```

## 6. Report format
```
STATUS: done | partial | blocked
FILES TOUCHED: <paths, one per line>
WHAT CHANGED: <three to six lines, plain words>
CHECKS: <the JSON above, filled in>
SCREENSHOTS: shots/layout/... paths worth looking at
CALLS I MADE: <each place the spec was silent or the real app differed, and what you did>
VERIFIED vs BELIEVED: <what you ran and saw, versus what you assume>
OPEN / BLOCKED: <anything you couldn't do>
```
