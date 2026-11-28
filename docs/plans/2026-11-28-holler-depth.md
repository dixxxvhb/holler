# Holler depth pass: the iOS polish (2026-11-28)

Designer and lead: Fable. Builder: builder-opus. Worktree `/Users/dixonb/Code/holler-polish`, branch `polish/ios-depth` (cut from main f971f86). Another session is working in `/Users/dixonb/Code/holler` on the camera, filters and storage; never touch that folder.

## 1. Decision

Dixon on the layout that shipped 11-27 (his words): "i like the layout and vibe but it's flat and boring and the important info and aesthetics aren't prioritized and still a bit hard to read." He asked for "an iOS polish upgrade."

So: **the layout, the colors, the patterns, the fonts and every behavior stay. The surface changes.** Three jobs, in this order of importance:
1. **Read it at a glance.** Bigger secondary text, stronger contrast, one clear first thing on every screen and every card.
2. **What needs you comes first and looks different** from what does not.
3. **Depth.** Rounded cards that sit above the ground, soft light on color, real materials (blur) for things that float, springy touch.

This replaces three rules of the 11-26 look spec, on purpose: "blocks touch edge to edge with a 3px seam", "no blur, no shadows", and "square rooms". Everything else in that spec holds (dark ink on color, chalk on dark, tail corner on things somebody sent, Tilt Warp / Figtree, no emojis, no theatre words, no cream).

Rejected, do not drift there: a grey iOS Settings clone; glass over everything; neon glows; turning read chats grey (every chat keeps its color); new fonts; any change to routes, data, recording, sending, the outbox, `src/lib/*`, `supabase/*`, or the QA class names listed in section 6.

Source: iOS 26 materials and large-title rhythm for structure; Emil Kowalski's rules for touch and motion (press 0.97, springs under 320 ms, nothing decorative moves on its own).

## 2. The system (add to `:root` in `src/styles.css`, use everywhere below)

```css
/* shape */
--r-card: 26px;      /* room cards, Your-go cards */
--r-inner: 18px;     /* tiles, thumbnails, list groups, game tiles */
--r-chip: 14px;
--gap-card: 10px;    /* space between cards (was the 3px seam) */
--inset: 12px;       /* cards sit this far in from the screen edge */
/* light on a color surface: a soft sheen from the top, and a hairline of light on the top edge */
--sheen: linear-gradient(180deg, rgba(255,255,255,.16) 0%, rgba(255,255,255,0) 46%, rgba(21,18,28,.10) 100%);
--edge-light: inset 0 1px 0 rgba(255,255,255,.38);
/* lift: a shadow in the surface's own color, so cards glow a little on the dark ground instead of sitting in grey smog */
--lift: 0 14px 28px -14px color-mix(in oklab, var(--room) 70%, transparent), 0 2px 6px rgba(8,7,12,.35);
--lift-quiet: 0 6px 16px -10px rgba(8,7,12,.6);
/* materials: for things that float over content */
--glass: rgba(24,21,32,.72);
--glass-blur: blur(22px) saturate(1.6);
--glass-edge: inset 0 0 0 1px rgba(247,246,251,.10), inset 0 1px 0 rgba(247,246,251,.14);
/* reading sizes (nothing informative below 13px; secondary text is 15) */
--fs-title: 34px;    /* large titles: holler, Play, You */
--fs-card: 24px;     /* a card's name */
--fs-sec: 20px;      /* section headers */
--fs-body: 16px; --fs-sub: 15px; --fs-meta: 13px;
/* touch */
--spring: cubic-bezier(.2, .9, .25, 1.15);
```
Rules:
- A color surface is always `background: var(--sheen), <its existing fill>` with `box-shadow: var(--edge-light), var(--lift)`. The pattern stays on the right but fades in from the left (mask or gradient), so text never sits on pattern.
- Glass needs both `backdrop-filter` and `-webkit-backdrop-filter`, plus a solid fallback for `@supports not (backdrop-filter: blur(1px))`.
- Informative text on dark is `--chalk` or `--chalk-2`. `--chalk-3` is only for things you could delete without losing meaning. On color, secondary text is `--on-color-2` at 15px/700.
- Times and counts are Figtree with `font-variant-numeric: tabular-nums`. Chivo Mono stays only on recording timers, video lengths and invite codes.
- Section headers are sentence case, Tilt Warp 20px, `--chalk`, left aligned with the cards (iOS grouped-list rhythm). No more tiny grey uppercase labels.
- Press: `transform: scale(.97)` 120 ms down, back with `--spring` 260 ms. `prefers-reduced-motion`: no transforms, no slides.
- One orchestrated moment only: on first paint of Chats and Play the cards rise 8px and fade in, 30 ms apart, once. Nothing else animates on its own.

## 3. Screen by screen

### Tab bar (`Tabs.tsx`, `shell.css`)
A floating capsule, not a full-width strip: inset 12px from the sides, 8px above the bottom safe area, height 60, radius 30, glass material with `--glass-edge` and a soft shadow. Three items, each an icon above a label (icons from `src/ui/icons.tsx`: add `chats` (speech bubble), `play` reuses `cards`, `you` (person) if missing; label Figtree 700 11.5px). The active item sits on a chalk pill (radius 22, dark ink) that **slides** between positions with `--spring` (one absolutely positioned pill moved by transform). Count badges: 18px circle at the icon's top right, red with white numerals for Chats and Play, tabular. Content scrolls under the bar; pages keep enough bottom padding to clear it.

### Chats (`HomeScreen.tsx`, `styles.css` home rules, `shell.css`)
- **Header**: large title wordmark (34px) left. Under it one summary line, 15px `--chalk-2`: what is waiting, in plain words built from the data already in `home`: "2 new hollers · 1 game waiting" / "1 new holler" / "1 game waiting" / when nothing is waiting, "All caught up". Right: the plus button as a 44px glass circle. When the list is scrolled, the header gets the glass material (sticky).
- **Order inside each section**: chats that need you first (unread, then a game waiting), then by most recent activity. This replaces the stable-order rule.
- **Cards** (`.chat-card`): `--r-card`, `--inset` side margins, `--gap-card` between, sheen + edge light + lift. Fixed comfortable heights instead of stretching to fill the screen: 92px normally, 132px when unread. Layout of every card, left to right: avatar (People: the person, 56px circle with a 3px dark ring; Groups: none), then the text block, then the thumbnail.
  - Text block: name in Tilt Warp 24px (one line, ellipsis). Under it ONE status line, 15px/700, that says the most important thing: unread → "2 new · Maya · 2m" (count first); someone recording → "Dee is recording" with the red dot; game waiting and nothing unread → "Checkers: your go" is not available here (home only knows a count), so "A game is waiting on you"; otherwise "You · 2h · Seen by Sam" as today. If there is unread AND a game waiting, the game shows as a small dark pill under the status line. Groups show the avatar stack (26px) at the bottom left of the text block.
  - The giant numeral is gone. Unread shows as a dark pill on the thumbnail's top-left corner: play glyph + count ("▸ 2" drawn with the Icon, not a text arrow), 13px/700, chalk on `--on-color`.
  - Thumbnail: 64 by 84 (unread: 84 by 108), `--r-inner` with the sharp tail corner kept, 3px dark frame, `--lift-quiet`. Unread adds the white outer frame it has today. Tap targets and the tap-the-picture-to-watch behavior stay.
  - Muted chats: the bell-off icon sits at the right end of the status line, not floating.
- Section headers "People" and "Groups" per section 2. The empty home keeps its content, restyled as one rounded card.
- New chat and Join sheets: see Sheets.

### Play (`PlayScreen.tsx`, `shell.css`)
- Large title "Play" with a summary line: "3 games waiting on you" / "Nothing is waiting on you".
- **Your go**: cards like Chats cards (room color, `--r-card`, sheen, lift), 84px: game icon in a 48px dark rounded square with the icon in the room color, name Tilt Warp 22px, under it "<chat> · <line>" 15px/700, and a dark "Play" pill at the right. When empty, no card and no label (the summary line already says it).
- **Waiting on them**: one grouped list (iOS inset group): a single `--surface` container, `--r-inner` radius, rows 64px separated by hairlines inset from the icon, each row: 40px icon chip, name 16px/700 `--chalk`, line 14px `--chalk-2`, Nudge as a small tinted pill where it applies.
- **Start a game**: the three groups keep their headers (now "On camera", "Quick", "Board and cards" as section headers; drop the "Start a game ·" prefix and put one header "Start a game" above the three with the group names as 15px `--chalk-2` sub-labels). Tiles: 3 across, 8px gaps, `--surface`, `--r-inner`, 104px tall; the icon chip (44px, radius 14) is **filled with the group's color and dark ink**: On camera `--room` ember `#ff6a3d`, Quick lime `#c6f432`, Board and cards sky `#4cb3ff`. Name Tilt Warp 15px `--chalk`, count "2 to 5" Figtree 12.5px `--chalk-2`. This is where the page gets its color back.
- **Just finished**: the same grouped list as Waiting on them.
- The pick-who sheet: chat rows as rounded cards (`--r-inner`, 8px gaps), dimmed ones at 45% with "Needs 3 people".

### You and Saved (`Settings.tsx`, `Saved.tsx`, their rules in `styles.css`)
Large title header band in the person's color becomes one rounded card (avatar 64px, name Tilt Warp 28px, sheen, lift). Rows become iOS inset groups (`--surface`, `--r-inner`, hairlines), labels 16px, values 15px `--chalk-2`, chevrons on rows that go somewhere. No copy changes.

### Inside a chat (`thread.css`, `Thread.tsx`, room rules in `styles.css`)
- **Band**: stays the room color, full width, with the sheen and a soft shadow under it so the thread slides beneath. Name Tilt Warp 22px. Add a subtitle under the name, 13px/700 `--on-color-2`: who is here or when the chat last moved, from data already on hand: someone recording → "Dee is recording"; someone here → "Sam is here"; else the members' first names ("Sam, Dee, Maya", ellipsis); two-person chat with nobody here → "Last holler 2h ago" or nothing if there are none.
- **Thread**: tiles and bubbles get `--lift-quiet`; tiles 88 by 116 with `--r-inner` (tail corner kept); note bubbles 16px/1.35, padding 11px 14px, max 78%, a 1px inner top light. Names above runs 13px `--chalk-2`. Day markers: a centered small glass pill (13px/700, `--chalk-2`), sticky at the top of the thread while that day is on screen. The new divider: the "Watch N new" pill becomes the room's color with dark ink, 48px tall, `--lift`, the only filled color thing in the thread; the lines beside it stay hairlines. The who-is-here pill: glass.
- **Dock**: game chips 52px tall, `--r-chip`, the your-go chip in chalk with a small red dot; the row scrolls with a soft fade at its right edge.
- **Deck**: the room color with the sheen, top corners rounded 26px so it reads as a sheet lifting over the thread, shadow upward. Note and Play buttons: 56px dark circles with `--edge-light`-style inner top light and labels 13px/700. The live tile: 92 by 120, 3px dark frame, `--lift`, the record dot 30px with a white ring; when asleep the avatar sits on the patterned wall as now.
- **Camera open**: the rail and every dark puck over video become glass (blur) instead of flat 80% dark. The record button keeps its shape; give its ring a soft outer shadow. Tool panels: top corners 26px. Nothing else changes here.
- **Player**: its buttons and the Film my reaction pill become glass. Nothing else.

### Sheets, toasts, questions (`bits.tsx` only if needed, CSS mostly)
Sheets: top corners 28px, the grabber stays, the color band keeps its pattern with the sheen, backdrop dim gets a light blur (8px). Buttons: primary 54px tall, radius 18, sheen + lift; secondary on `--surface-2`. Fields: 52px, radius 16, 16px text. Toasts and the update card: glass, radius 20, and they sit above the floating tab bar. Question sheets (`ask()`): same sheet treatment.

### Game pages (`games.css`)
Do not redesign game boards or cards. Only: page headers get the sheen and bottom shadow; primary buttons and list rows pick up the new radius, sizes and text sizes from the shared rules; any tiny grey meta text under 13px goes to 13px `--chalk-2`.

## 4. Files you own
`src/styles.css`, `src/ui/shell.css`, `src/ui/thread.css`, `src/games/games.css`, `src/ui/update.css`, `src/ui/Tabs.tsx`, `src/ui/HomeScreen.tsx`, `src/ui/PlayScreen.tsx`, `src/ui/Thread.tsx`, `src/ui/Settings.tsx`, `src/ui/Saved.tsx`, `src/ui/icons.tsx` (additions), `src/ui/bits.tsx` (styling hooks only), `src/ui/ChatScreen.tsx` (**markup and class names only**: the band subtitle, nothing in the recording, camera or game logic), `scripts/layout.mjs` and any QA script whose check breaks because of a sanctioned change here.

## 5. Hard rules
- Never commit, push, deploy or run SQL. No new dependencies, no image files (CSS and inline SVG only). No emojis.
- Do not touch `src/lib/*`, `supabase/*`, `public/sw.js`, game logic, or the other checkout.
- Words on screen: only the ones this brief gives. Anything else you need, write plainly and list under NEW WORDS.
- Keep every class name QA relies on (section 6). Keep 44px tap targets. Check 375x667 and 390x844 and 430x932.
- Performance: blur only on the tab bar, sticky header, day pills, the who-is-here pill, the rail/pucks, toasts and sheet backdrops. Never on cards or list rows. No animated shadows or filters.
- Ports: dev server on 5190 (`npx vite --port 5190 --host`), production preview on 5191 (`npx vite preview --port 5191`). The other session uses 5188 and 5189.
- This Mac freezes under load and another session may be running Playwright: before any Playwright run, `pgrep -f "scripts/qa|scripts/layout"`; if something is running, wait for it. One run at a time.
- QA scripts create fake people in the real database: finish with `node scripts/clean-qa-remote.mjs`.

## 6. Class names that must survive
`.chat-card`, `.cc-thumb`, `.cc-title`, `.badge` (keep the class on the new unread pill), `.turn-tag`, `button.new-chat-btn`, `nav.tabs`, `button.tab[data-tab]` with `.on`, `.g-opt`, `.g-tile`, `.thread`, `.tile` (+ `.new`, `.mine`, `.pending`, `.failed`, `.g-stack`), `.note-bub`, `.new-pill`, `.g-dock`, `.g-chip`, `.rec-row`, `.side-btn`, `.g-play-tile`, `.rec`, `.live-tile`, `.chat`, `.chat-top`, `.preview`, `.rail`, `.bottom`, `.in-thread`, `.cam-open`, `.cam-live`, `.is-rec`, `.sheet`, `.sheet-head`, `.toast`.

## 7. Verification
- `npm run build` passes; `grep -c pearlfish dist/assets/index-*.js` prints 0.
- `PW_CHANNEL=chrome node scripts/layout.mjs http://localhost:5190/` for screenshots (it writes `shots/layout/`). Look at them. Iterate at least three rounds against this brief: squint test (is the first thing obvious?), then the smallest text, then spacing.
- Then on a production build (5191), one at a time: `qa.mjs`, `qa-simple.mjs`, `qa-play.mjs`, `qa-boards.mjs`, `qa-polish.mjs`, `qa-sleep.mjs`. Clean up.
- Checks JSON:
```json
{ "build_passes": false, "pearlfish_count_is_0": false, "no_informative_text_under_13px": false, "needs_you_sorts_first_in_each_section": false, "tab_bar_floats_and_pill_slides": false, "se_375x667_nothing_overlaps_or_clips": false, "reduced_motion_respected": false, "six_qa_suites_pass_on_prod_build": false, "qa_people_cleaned": false }
```
- Screenshots to name in your report (from `shots/layout/`, i15 size): Chats with unread, Play, the thread, camera open, a sheet, You; plus Chats and the thread at SE size.

## 8. Report format
```
STATUS: done | partial | blocked
FILES TOUCHED:
WHAT CHANGED: <three to six plain lines>
CHECKS: <JSON>
SCREENSHOTS:
NEW WORDS:
VERIFIED vs BELIEVED:
OPEN / BLOCKED:
```
