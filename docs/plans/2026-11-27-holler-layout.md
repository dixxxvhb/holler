# Holler layout: three places, and a chat you can read (2026-11-27)

Designer and lead: Fable. Repo `~/Code/holler`, branch `layout/three-places`. Two builders work in this one checkout at the same time, on different files: **Builder A (room)** and **Builder B (shell)**. Read sections 1 to 3, then your own section, then 6 and 7.

Mockup (the visual reference, eight numbered phones): `mockup/holler-layout.html`. Render it with `node scripts/mock-shots.mjs mockup/holler-layout.html <outDir>` and look at the PNGs. "Matches" means: same structure, same order of things, same hierarchy, built with Holler's real tokens and classes (`src/styles.css`, look spec `docs/plans/2026-11-26-holler-look.md`). The mockup's fake faces and gradients are stand-ins. Where the mockup and this brief disagree, the brief wins.

## 1. Decision

Holler was drawn as a camera with a sideways strip of videos under it. It now has 12 games, notes, cards and reactions, all packed into that one camera screen, and games can only be seen one chat at a time. The new layout:

1. **Three places with a bottom bar: Chats, Play, You.** Play is new: every game waiting on you across all chats, who you are waiting on, and a catalog to start any game.
2. **Chats splits into People (two-person chats) and Groups.** Stable order inside each.
3. **A chat opens as a thread you read top to bottom**, newest at the bottom, theirs left and yours right, notes readable in place. The camera becomes a live tile in the middle of the deck; tapping it opens the full camera, which is today's camera screen unchanged.
4. **The Play sheet becomes a grid of tiles** instead of thirteen long rows.

Rejected, do not drift back: keeping the camera full screen as the room's default; a horizontal strip; putting games in the thread as items (later round); a fourth tab for Saved (it moves into You); new server tables or any change to how recording, sending, the outbox or the studio work.

## 2. Hard rules (both builders)

- Never commit, push, deploy, or run SQL. Never rename or move existing files. No new dependencies. No emojis.
- **Do not touch** `src/lib/studio.ts`, `src/lib/outbox.ts`, `src/lib/live.ts`, `src/lib/push.ts`, `src/lib/api.ts` (except Builder B's one addition), `supabase/*`, `public/sw.js`. The recording and sending code has a long list of iPhone fixes in it; this job is layout.
- The camera's lifetime does not change: it starts when a room mounts and stops when it unmounts, exactly as now. The `<canvas className="cam">` and `.preview` stay mounted and are never `display: none` (hidden with `visibility` only where the current code already does that).
- Games bundle rule (look spec section 16): nothing in the first download imports `src/games/all.ts`, a game screen, or `src/games/content/*` except `cardDecks.ts`. After a build, `grep -c pearlfish dist/assets/index-*.js` must print 0.
- Words on screen: use exactly the copy in this brief. If you need a line that is not here, write the plainest possible one and list it in your report under NEW WORDS. No theatre words (stage, booth, cue, curtain).
- Look rules that still hold: rooms are square color blocks touching with a 3px seam; people are circles; anything somebody sent has one sharp corner (bottom-left theirs, bottom-right yours); dark ink (`--on-color`) on color, chalk on dark; no blur, no shadows except toasts; Tilt Warp for names and titles, Figtree for reading, Chivo Mono for numbers and times; press scale .96 to .985; honor `prefers-reduced-motion`.
- Tap targets 44px or more. Check 375x667 (SE) and 390x844.
- The tree is dirty from the other builder. Type errors in files you do not own are not yours: note them, keep going, re-run later. Do not edit or revert the other builder's files.
- Dev server: one only, `npm run dev` on :5188 (check `lsof -i :5188` first and reuse it if it is up). The Neo freezes under load: never run more than one Playwright script at a time, and close what you start.
- QA scripts sign up fake people in the real database. After any QA run: `node scripts/clean-qa-remote.mjs` (it goes through the PC; if it hangs more than 3 minutes the PC is busy, say so in your report and move on).

## 3. Shared contract (so the two halves meet)

Routes (hash): `/` Chats, `/play` Play, `/settings` You, `/saved` Saved (reached from You), `/c/<id>` room, and inside a room:
- `/c/<id>/watch` and `/c/<id>/invite` (exist today)
- `/c/<id>/g/<gameId>` opens that game once the chat has loaded (Builder A reads it, Builder B links to it)
- `/c/<id>/start/<kind>` opens that game's start sheet; `<kind>` is a `GameKind` or `card` (Builder A reads it, Builder B links to it)

Class names QA and the two builders rely on. Keep these exact:
- Chats: `.chat-card`, `.cc-thumb`, `.cc-title`, `.badge`, `.turn-tag`; header plus button `button.new-chat-btn` (aria-label "New chat"); tab bar `nav.tabs` with `button.tab[data-tab="chats"|"play"|"you"]`, active one has class `on`.
- Play sheet tiles keep class `g-opt` (add `g-tile`), and each shows the game's full name from `GAME_NAME` in a `<b>` ("Charades Relay", not "Charades"), so `.g-opt:has-text("Checkers")` still finds it. "Give me a card" keeps its text.
- Room: thread container `.thread`; holler tiles keep `.tile` (+ `.new`, `.mine`, `.pending`, `.failed`, `.g-stack`) and their aria-labels; note bubbles `.note-bub`; `.new-pill` keeps its text "Watch N new"; dock keeps `.g-dock` / `.g-chip`; record row keeps `.rec-row`, `.side-btn`, `.g-play-tile`, `.rec`; root keeps `.chat`, `.chat-top`, `.preview`, `.rail`, `.bottom`.

`src/games/catalog.ts` (Builder B writes it, both may import it; it must stay light: no decks, no screens):
```ts
export type CatalogGroup = 'camera' | 'quick' | 'board';
export type CatalogItem = { kind: GameKind; group: CatalogGroup; icon: string; min: number; max: number; line: string };
export const CATALOG: CatalogItem[];           // order below
export const GROUP_LABEL: Record<CatalogGroup, string>; // 'On camera' | 'Quick' | 'Board and cards'
```
Order and groups: camera: passiton (3 to 5), poker (3 to 5), charades (2 to 5), spot (2 to 5), laugh (2 to 5), zoom (2 to 6). quick: words (2 to 5), trivia (2 to 5), said (3 to 6). board: lastcard (2 to 6), checkers (2), ttt (2). `icon` is the name already used for that game in `GAME_ICON` at the bottom of `ChatScreen.tsx`. `line` is the description sentence the Play sheet shows for that game today (copy them word for word from `src/games/Play.tsx`).

## 4. Builder A: the room (builder-opus)

### Files you own
- `src/ui/ChatScreen.tsx` (render and a little state; leave the recording logic alone)
- `src/ui/Thread.tsx` (new: the thread, a pure component fed by ChatScreen)
- `src/ui/thread.css` (new: thread, live tile, the two room states; import it from ChatScreen)
- `src/styles.css` (room rules only: `.chat`, `.preview`, `.bottom`, `.strip`, `.rec-row`, `.new-pill`, `.rec-banner`, tiles; delete strip rules that end up unused)
- `src/games/games.css` (only the `.g-dock` rules, if the dock's new seat needs it)
- `scripts/qa*.mjs`, `scripts/layout.mjs` (bring them in line with the new flow; you run them last)

### The room has two states, one flag
`camOpen` (boolean state in ChatScreen). The root gets class `in-thread` when it is false and `cam-open` when true.

`camOpen` is true whenever any of these holds, and you set it true when they begin: the person tapped the live tile; a game turn is on (`turn` is set); a recording or countdown is running; a tool panel is open; the review screen is up; the route was `/c/<id>/cam`. It goes back to false: when a holler is handed to the outbox (plain send, review Send, and every game-turn send), when a turn is left with the X, and when the person taps the band's back control while the camera is open. Discarding a take keeps the camera open.

### State one: the thread (default, mockup phone 4)
Top to bottom: the room band (as today: back to home, name, faces, info), the thread, the games dock (only when there are games), the deck.

**Thread** (`Thread.tsx`, class `.thread`, ground-colored, scrolls vertically, fills the space between band and dock/deck):
- Items in time order from `chat.polos`, then the outbox's pending ones (`outgoing(chatId)`, same filter as the strip uses today), newest at the bottom.
- A **day marker** (`.thread-day`, mono, small caps look as in the mockup) before the first item of each day, using `dayLabel`. Show markers whenever the items span more than one day (same rule as `manyDays` today).
- Consecutive items by the same person on the same day form a **run**. Theirs sit left, yours right. Inside a run, video tiles, voice tiles and card stacks flow in a row and wrap; a note always takes its own line.
- **Video, voice and card-stack tiles**: the same markup, classes, aria-labels and little marks the strip tiles have today (avatar, length, saved mark, seen faces on yours, reaction pip, the white frame on unwatched). Size about 84 by 110 (a touch smaller on a 375 screen so four fit across). Tap opens the player exactly as `openPlayer(polos, i)` does today (stacks open their stack).
- **Notes** are bubbles (`.note-bub`): the author's color (`tone(author.color)`), dark ink, the full text (wrap, no clamp), at most about 78% of the width, the tail corner on the author's side. Tap opens the player at that note, as tiles do. An unwatched note gets the same white frame as an unwatched tile.
- In a chat with more than two members, each of their runs carries the person's first name above it (small, `--chalk-3`) and their avatar (28px) at the left of the run's last line. In a two-person chat, no names and no avatars.
- **What is new**: directly before the first unwatched item, a divider line with the `.new-pill` button in its middle ("Watch N new", play icon, chalk fill, dark ink). It replaces the floating pill over the camera.
- **Who is here**: when someone is recording or watching, the line that floats over the camera today (`.rec-banner`) sits pinned at the bottom-left of the thread instead (a pill on `--surface`), same words.
- Opening: if there are unwatched items, scroll so the new divider is in view near the top third; otherwise scroll to the bottom. When a new item arrives or you send one: scroll to the bottom if the person was already within about 150px of it, or if it is their own.
- Empty: "No hollers yet. Say hi." or, with nobody else in the chat, "Invite your people, then say hi." (today's two lines), set left, `--chalk-2`. Loading: four skeleton tiles (reuse `.tile-sk`).
- Pending sends: right-aligned at the very end, same progress bar and Retry / Delete as today.

**Games dock**: today's `.g-dock` with its `.g-chip`s, unchanged in behavior, seated as its own row between the thread and the deck on a strip of the room's deeper shade (`--room-deep`). Nothing when there are no games.

**Deck** (`.bottom` > `.rec-row`, the room's color): three things on one row.
- Left: the Note button (`.side-btn`, as today).
- Middle: **the live tile**. A holler-shaped tile (about 86 by 112, sharp corner bottom-right, 3px dark frame) showing the live camera picture, with a red dot in a ring at its bottom middle and the label "Holler" under it, in the same label style as Note and Play. It is the `.rec` button in this state (`aria-label="Open camera"`).
  - How the picture gets in there: `.preview` is the same element in both states. In `in-thread` it is sized and placed over the tile (work the rect out in CSS if you can, or measure a placeholder with the ResizeObserver that is already there); in `cam-open` it is full screen as today. Animate the change with `--t-slow` and `--ease-drawer`; with reduced motion, no animation. In `in-thread` the preview takes no pointer events, the button over it does.
  - Tap: open the camera (`camOpen` true). Nothing records yet.
  - Press and hold (about 350 ms): open the camera and start recording at once; letting go sends, by the same hold rules the round button has today. Build this on the existing `onRecDown` / `onRecUp` / `begin` / `finish` functions without changing what they do for the round button. If it cannot be done without touching how those behave in the camera state, leave hold out and say so in your report.
  - Voice-only phones (`cam === 'voice'`): the tile shows the person's avatar on the room's patterned wall with a small mic, no picture. Same tap behavior.
  - Camera not allowed yet or denied (`camState` is `denied` or `off` while `cam !== 'off'`): the tile shows a camera icon on the patterned wall; tapping opens the camera state, which shows today's wall with its buttons (Try again, Use my voice instead, Just notes and games).
  - Notes-only phones (`cam === 'off'`): no live tile. The middle is the big Note button that is there today (`.rec.note-only`), the left is empty, Play stays on the right. The thread is fully usable. The full-screen "Notes and games on this phone" wall is gone from this state; its Change button lives on in You and in the camera sheet.
- Right: the Play button (`.side-btn.g-play-tile`, as today).

The rail, the tool panels, the look flash, the ring light, the live captions and the countdown do not show in this state.

### State two: the camera (mockup phone 5)
Today's screen, with these differences only:
- The strip, the floating "Watch N new" pill and the who-is-here banners are not here (they live in the thread). The games dock shows only while recording, as the "move while you talk" row it already is (`.g-dock.during-rec`).
- The band's left control: when not in a turn it is a down chevron, `aria-label="Back to the chat"`, and closes the camera (if a take is running it first asks the same "Still recording" question `leave()` asks, and discards on yes). In a turn it stays the X it is today.
- The record row: the round `.rec` button in the middle, exactly as today. Left: Discard while recording (today), otherwise a `.side-btn` "Chat" with the down chevron that closes the camera. Right: the timer while recording (today), otherwise empty. Note and Play are not in this state.
- Under the record button when idle, the hint line: "Tap to record. Hold to record and let go to send." (`.rec-hint`; the existing turn hints win when a turn is on.)
- Everything else (tools, panels, More tray, flip, double tap, swipe looks, drawing, text, cards, game banners, review, the turn flow, float-a-game-while-recording, the after-send nudge toast, Film my reaction) behaves as it does now.

### Deep links (section 3)
- `/c/<id>/g/<gameId>`: when the chat has loaded and the games bundle is ready (call `loadG()`), open that game the way `openDock` does. Unknown id: do nothing.
- `/c/<id>/start/<kind>`: run the same code path the Play sheet's choice for that kind runs today (including the `camBlocked` check). `card` opens the camera with a card dealt.
- `/c/<id>/cam`: open the camera.
- Like `invite` and `watch`, strip the tail from the address once handled.

### QA scripts
Every script that records, opens Play, taps the strip or uses the home buttons needs the new flow: the first `.rec` tap in a room opens the camera, the next starts recording; after a send the room is back on the thread; `.strip` is `.thread`; home's New chat is behind `button.new-chat-btn` and the join sheet is a link inside that sheet (see Builder B). Keep each script's checks; change only how it gets there. `scripts/layout.mjs`: add shots for the thread (with notes and several days), the camera state, a notes-only phone, the Play page and the Play sheet grid.

Run, one at a time, on a production build (`npm run build && npm run preview`, port 5189), with `PW_CHANNEL=chrome`: `qa.mjs`, `qa-simple.mjs`, `qa-play.mjs`, `qa-rounds.mjs`, `qa-boards.mjs`, `qa-cards.mjs`, `qa-faces.mjs` (pass the base URL), `qa-zoom-said.mjs`, `qa-after-act.mjs`, `qa-spot-stuck.mjs`, `qa-polish.mjs`, `qa-features.mjs`, `qa-flip.mjs`, `qa-seen.mjs`, `qa-looks.mjs`. `qa-long-send.mjs` needs the dev server. Then `layout.mjs`, then clean up (section 2).

### Checks (all true when you report)
```json
{
  "build_passes": false,
  "pearlfish_count_is_0": false,
  "thread_shows_notes_in_full": false,
  "live_tile_shows_camera_and_opens_camera": false,
  "send_returns_to_thread": false,
  "notes_only_phone_has_no_wall": false,
  "deep_links_g_and_start_work": false,
  "every_qa_suite_passes_on_prod_build": false,
  "se_375x667_nothing_overlaps": false,
  "qa_people_cleaned": false
}
```
Screenshots in `shots/layout/` from `layout.mjs`; name in your report the six that show: thread with new divider, thread many days, camera open, recording, notes-only, SE-size thread.

## 5. Builder B: Chats, Play, You, the Play sheet (builder-sonnet)

### Files you own
- `src/App.tsx` (routes, tab bar mount)
- `src/ui/Tabs.tsx` (new), `src/ui/PlayScreen.tsx` (new), `src/ui/shell.css` (new: tab bar, Chats sections, Play page, catalog grid; import it from App)
- `src/ui/HomeScreen.tsx`, `src/ui/Settings.tsx`, `src/ui/Saved.tsx`
- `src/games/catalog.ts` (new, section 3), `src/games/Play.tsx` (only `PlaySheet`), `src/games/roundLogic.ts` (additions only), `src/games/games.css` (only `.g-opt` / Play sheet rules)
- `src/lib/api.ts`: add exactly `games: () => rpc<{ games: Game[] }>('holler_games'),` beside the other game calls. The server function is live already.
- `src/styles.css` (home rules only: `.home`, `.home-top`, `.chats`, `.chat-card`, `.fab-row`, `.page` padding for the tab bar)

### Tab bar (mockup phones 1, 2, 8)
`nav.tabs` fixed to the bottom on Chats, Play and You (not in a room, not on Saved, not while signed out): three equal blocks touching with a 3px seam, about 56px tall plus the bottom safe area. Labels in Tilt Warp: "Chats", "Play", "You". Active: chalk fill, dark ink. Others: `--ground-2`, `--chalk-2`. Counts in a small mono pill beside the label: Chats = unread hollers in chats that are not muted; Play = the sum of `yourTurn` over `home.chats`. No pill at zero. Pages get bottom padding so nothing hides behind it. Toasts, the update card and the no-connection line must sit above the bar (check where `--bottom-h` and `.net-off` place them).

### Chats (`HomeScreen.tsx`, mockup phone 1)
- Header: wordmark left; right, one round button `button.new-chat-btn` (plus icon, aria-label "New chat"). The Saved and You buttons leave the header. The bottom `.fab-row` is deleted.
- The plus opens today's "New chat" sheet. Under its Make it button add a text link: "Have a code? Join a chat" which swaps to today's "Join a chat" sheet. The empty home keeps its two big buttons.
- Two sections, each with a small label (`.sec-lbl`): **People** = chats with exactly two members; **Groups** = every other chat (a chat with only you in it counts as a group). A section with nothing in it is not shown, label included. If there is only one kind, show it without any label.
- Inside a section, order by most recent activity (`lastPoloAt`) and do not jump a chat to the top just because it has something new.
- A People block leads with the other person's avatar as a large circle (about 60px) at the left, then the name and line. No avatar stack on it. A Groups block is today's block (name, line, avatar stack).
- Unread and recording treatments stay as they are (taller block, big count, play button on the picture, tap the picture to watch).
- The game tag (`.turn-tag`) keeps today's words and rule.
- `InstallHint` and `PushNudge` stay, above the sections.

### Play (`PlayScreen.tsx`, route `/play`, mockup phones 2 and 3)
Data: `api.games()` on mount, when the page becomes visible again, and on any live `polo` or `chat` event (`onLive`); keep the last answer in memory so coming back paints at once. Join each game to its chat in `home.chats` by `game.chat` (skip games whose chat is not there). Add `export const myGo = (g: Game, me: string) => ...` to `roundLogic.ts` with the rule ChatScreen uses today (Pass It On: playing and `turnPerson === me`; the rest: `owes(g, me)`), and loosen `tileLine`'s third argument to anything with `members` so a `ChatSummary` works.

Sections, top to bottom, each with a `.sec-lbl`:
1. **Your go**: playing games where it is your go, most recently changed first. Each is a block in its chat's color (`data-room`), touching its neighbors: the game's icon in a dark square, the game's name (Tilt Warp), under it "<chat title> · <tileLine>", and a dark "Play" pill at the right. The whole block goes to `/c/<chat>/g/<game>`. None: one quiet line, "Nothing is waiting on you."
2. **Waiting on them**: playing games where it is not your go. Compact rows on `--ground-2`: icon, name, "<chat title> · <tileLine>". The row opens the game. For Pass It On only, a "Nudge" pill using `api.gameNudge` with the 6-hour rule the game page already applies (show "Nudged" when it was used). Section hidden when empty.
3. **Start a game**: the catalog as three labelled groups of tiles, three across (`.g-tile`, mockup phone 2): icon, full name, "2 to 5" style count in mono (min equal to max shows just the number). Tapping a tile opens a sheet titled with the game's name: its `line`, then the label "Play with", then your chats as short blocks in their colors (title left, faces right). A chat with too few people for the game is dimmed, not tappable, and says "Needs N people". Choosing one goes to `/c/<chat>/start/<kind>`. With no chats at all: "Start a chat first, then come back and play." and a button to Chats.
4. **Just finished**: games that ended in the last 7 days and are not hidden, newest first, at most six: compact rows "<Game name>" / "<chat title> · <tileLine>", opening the game. Hidden when empty.

Loading: paint the section labels and catalog at once (they need no data); the two game lists show two skeleton rows until the first answer. Error: "Could not load your games." with Try again; the catalog still works.

### The Play sheet inside a room (`PlaySheet` in `Play.tsx`, mockup phone 6)
Same props, same callbacks. New body: first the wide "Give me a card" tile (keeps its two lines of words), then the catalog as one grid of tiles, three across, grouped under the three small labels, each tile calling the same callback its row calls today. A game the chat is too small for is dimmed and says "Needs N" in place of the count. Drop the opening paragraph and the "Coming next" line. Each game's long sentence is gone from this sheet (the start sheets already explain each game).

### You (`Settings.tsx`) and Saved
- You is a top-level place now: remove its back button; the tab bar shows under it.
- Add a first row, "Saved hollers", that goes to `/saved`. If the count is cheap to show, show it; otherwise no number.
- Saved keeps its back button, now going to `/settings`. No tab bar on Saved.

### Checks (all true when you report)
```json
{
  "build_passes": false,
  "pearlfish_count_is_0": false,
  "tab_bar_on_three_places_only": false,
  "people_and_groups_sections_correct": false,
  "play_page_lists_games_from_two_chats": false,
  "start_from_play_lands_on_start_route": false,
  "play_sheet_is_a_grid_and_callbacks_fire": false,
  "saved_reached_from_you": false,
  "se_375x667_nothing_overlaps": false,
  "qa_people_cleaned": false
}
```
Verify with your own short Playwright script in the scratchpad (sign up two or three fake people named `ZZTest…`, one two-person chat and one three-person chat, start a board game in each through the UI or RPC, then shoot Chats, Play, the pick-who sheet, the Play sheet grid, You, at 390x844 and 375x667). Builder A owns the `scripts/qa*.mjs` files and will fix them for your markup; do not edit them. Screenshots to `shots/shell/`: `01-chats.png`, `02-play.png`, `03-play-pick.png`, `04-play-sheet.png`, `05-you.png`, `06-chats-se.png`.

## 6. Report format (both)
```
STATUS: done | partial | blocked
FILES TOUCHED: <paths>
WHAT CHANGED: <three to six plain lines>
CHECKS: <your JSON, filled in>
SCREENSHOTS: <paths>
NEW WORDS: <any on-screen copy that was not in the brief>
VERIFIED vs BELIEVED: <what you ran and saw, versus what you assume>
OPEN / BLOCKED: <anything not done, and why>
```

## 7. Later rounds (not now)
Finished games as items in the thread with Rematch; "Holler at one person" (start a two-person chat from a face, needs a server change and Dixon's yes); Catch up (play everything new across chats).

## 8. Round two: the camera and mic sleep unless they are in use (Builder A, added 2026-11-27 night)

Dixon's ask, his words: "find a way to not have to allow camera and mic access every time and also that camera and mic don't need to be on the whole time the app is open especially if we're just gaming."

What is true on an iPhone (checked against WebKit's bug tracker and recent reports, not from memory): a Home Screen web app cannot keep a camera or mic grant between launches, and inside one launch iOS asks again whenever a page that is capturing nothing asks for the camera or mic. Holding a live track is the only thing that stops the second ask. Today Holler therefore grabs both when the first room opens and holds the mic for the life of the page, which is why the mic dot never goes out. Muting and unmuting the mic track plays a loud system sound on iPhone, so that is still never done. Stopping a track makes no sound.

### Decision
1. **Nothing is asked for or switched on until the camera is actually needed.** Opening a room, reading the thread, watching, notes, board, card, quiz and word games never touch the camera or mic. A launch where you only play or watch never shows a permission ask and never lights a dot.
2. **The camera wakes** when the room's camera opens (`camOpen` true by any route: tile tap or hold, a turn, `/cam`, Reply, a card, a tool) and for the three features that film you outside it: Film my reaction in the player, Don't Laugh's watch, and reaction filming in the Pass It On reveal.
3. **The camera sleeps** the moment none of those is on: `studio.close()` as today (picture off, camera light off). The mic is still held at that point.
4. **Everything is let go after a short quiet spell.** 90 seconds after the camera last slept, with nothing recording and nothing sending from the recorder, stop both tracks (`releaseMedia()`), so the mic dot goes out. Any wake before then cancels the timer, so back-to-back hollers, a reply, or hopping to another chat to answer do not get a second ask. The timer must outlive a room: keep it at module level. Also start the same timer when the app goes to the background.
5. Rejected: letting go the instant the camera closes (an iPhone would ask before every single holler); holding the mic for the whole launch (today, the thing he is complaining about); muting the mic track (the system sound).

### What you may touch (this round only)
- `src/lib/studio.ts`: only the shared-media block at the bottom. Add `releaseSoon(ms)` and `cancelRelease()` (module-level timer; `acquire` and `acquireMic` cancel it; `releaseSoon` must never fire while any recorder is running, so check a module-level "a take is on" flag or re-arm). Do not change `open`, `close`, `start`, `stop`, `flip`, the recorder, or the WebGL path.
- `src/ui/ChatScreen.tsx`, `src/ui/thread.css`, `src/ui/Player.tsx`, `src/games/Laugh.tsx`, `src/games/Reveal.tsx`, `src/games/reaction.tsx`, and the QA scripts.

### Behavior
- Room mount no longer calls `startCam()`. `camState` starts `'off'`. One effect owns the camera: wanted = `camOpen` or a feature has asked for it; wanted and not on: `startCam()`; not wanted: `studio.current?.close()`, `setCamState('off')`, `releaseSoon(90_000)`. The existing hide/show handler stays, but coming back to the front restarts the camera only if it is wanted.
- The features that film you get the camera through one small request from ChatScreen (for example a prop `onCamWanted(on: boolean)` plus the `studio` prop they already take, which stays null until the camera is on). Film my reaction: the switch asks for the camera when turned on and waits for it; if the camera cannot start, say so with the existing toast style and turn the switch back off. Don't Laugh: watching asks for the camera before the clip plays; the "I laughed" fallback must still work with no camera. The reveal's reaction filming: same pattern as the player. Each feature gives the camera back when it closes.
- The live tile no longer shows a picture while asleep: it shows the person's own avatar on the room's patterned wall with the red record dot, label "Holler" (class `live-tile asleep`). Voice-only keeps the mic glyph. When the camera is on but the room is in the thread (the 90 seconds, or a feature is using it), the tile may show the live picture as it does now, or stay as the avatar; pick whichever is simpler and steadier.
- Opening the camera from asleep: the full camera view shows at once with a quiet "Starting the camera" line until `camState` is `'on'`; the record button waits. Hold on the tile from asleep: open the camera; if the finger is still down when the camera comes on, start recording, otherwise leave it open and idle.
- Denied or failed: today's wall with its three buttons, inside the camera state. Nothing about a denied camera shows in the thread except the tile's camera icon after a failed try.
- Notes-only phones: unchanged, nothing is ever asked. Voice-only: the mic is asked for only when the recorder opens, and sleeps and lets go the same way.
- The once-per-device effects self-test (`holler.camtest2`) still runs the first time the camera comes on.
- Leaving a room no longer needs the camera light logic it has now, but must still `dispose()` the studio (WebGL context) and leave the 90-second timer running.

### Checks (all true when you report)
```json
{
  "build_passes": false,
  "pearlfish_count_is_0": false,
  "room_open_requests_no_media": false,
  "board_game_from_play_page_requests_no_media": false,
  "camera_open_then_close_pauses_video_and_keeps_mic": false,
  "ninety_seconds_later_both_tracks_are_stopped": false,
  "second_open_inside_90s_makes_no_new_getUserMedia_for_mic": false,
  "film_my_reaction_wakes_camera_and_still_sends": false,
  "dont_laugh_watch_wakes_camera": false,
  "qa_suites_pass_on_prod_build": false,
  "qa_people_cleaned": false
}
```
Prove the media checks with a new script `scripts/qa-sleep.mjs` that wraps `navigator.mediaDevices.getUserMedia` in an init script to count calls and record each track's `readyState`/`enabled` (use a short release time through a test hook such as `localStorage['holler.releaseMs']` so the script does not wait 90 seconds). Then re-run on a production build, one at a time: qa, qa-simple, qa-play, qa-rounds, qa-faces, qa-after-act, qa-spot-stuck, qa-polish, qa-features, qa-flip, qa-looks, and qa-long-send on dev. Clean up after.
