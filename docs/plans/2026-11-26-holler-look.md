# Holler look: the design system (2026-11-26)

Designer: Fable. For the builder. Companion mockup: `mockup/holler-look.html` (17 numbered phone screens, built with the real class names). Brief and research: `2026-11-26-holler-look-brief.md`, `2026-11-26-holler-look-research.md`.

**Source:** Krehel (craft, color as ramps, press 0.96) for the whole app, Emil's rules for the controls touched a hundred times a day (rail, record: nothing decorative moves), Zantos as the motion referee. World: color-block patchwork (flat pieced blocks, straight seams, one two-tone pattern per room). That world is not one of the catalog's recipes; it is derived from what Holler's people already live with (paint chips, quilts, notes on the fridge), and it is the opposite of both things Holler looked like before (near-black plus one accent, glass over video). No pack is installed in the repo; the digests in `~/.claude/design-sources.md` were enough. Read: a daily-use consumer app for 2 to 5 close people, mostly an iPhone Home Screen app, used one-handed, often at night.

---

## 1. The one idea: blocks

**Every chat is a solid block of its own color and pattern, and Holler is built from those blocks touching edge to edge.** Video is the only thing on screen that is not a block.

What that rules in and out, everywhere:

- A room's color is a **surface**, wall to wall, with dark ink on it. It is never a thin border, a glow, or an accent on a dark card.
- Blocks **touch**. The gap between two blocks is a 3px seam of the ground color. No cards floating in margins, no card inside a card.
- **No blurred glass, no drop shadows, no decorative gradients.** Chrome over video is a solid dark shape ("puck") or sits on a color block beside the video. The only gradients are the two scrims in the player and the patterns below. The only shadow is under a toast.
- **Three shapes, three meanings.** Rooms are square blocks. People are circles. Anything somebody sent (a holler tile, a typed note, a thumbnail) is a rounded rectangle with **one sharp corner, the tail**: bottom-left for theirs, bottom-right for yours. In the strip you can read the back-and-forth at a glance.
- **Dark ink on color, chalk on dark.** Text on any color block is `--on-color` (#15121c). White text never sits on a room color.

The screenshot test: home is a stack of colored bands with huge type; a room is color band, picture, color deck. Nothing else in this category looks like that.

---

## 2. Tokens

Paste-ready. This is the exact block the mockup runs on. Old names are kept as aliases at the bottom so `src/games/games.css` and any untouched rule keep working.

```css
:root {
  /* ground and neutrals: cool ink. Never warm brown, never cream. */
  --ground: #0f0d15;
  --ground-2: #181520;
  --surface: #211d2c;
  --surface-2: #2d2839;
  --chalk: #f7f6fb;
  --chalk-2: rgba(247, 246, 251, .72);
  --chalk-3: rgba(247, 246, 251, .54);
  --seam: rgba(247, 246, 251, .10);
  --seam-2: rgba(247, 246, 251, .22);
  /* ink that sits ON a color block, and the solid dark used over video */
  --on-color: #15121c;
  --on-color-2: rgba(21, 18, 28, .80);
  --on-color-fill: rgba(21, 18, 28, .13);
  --puck: rgba(21, 18, 28, .80);

  /* status */
  --danger: #ff5c6c;
  --live: #3ddc84;
  --rec: #ff3b4a;
  --watch: #59c9ff;

  /* the place you are in. --room is repainted by [data-room] and [data-you] */
  --room: #ff6a3d;
  --room-deep: color-mix(in oklab, var(--room) 84%, #15121c);
  --room-dim: color-mix(in oklab, var(--room) 16%, #0f0d15);
  --pat: repeating-linear-gradient(135deg, var(--room-deep) 0 12px, transparent 12px 24px);
  --accent: var(--room);

  /* shape: rooms are square, people are round, hollers have a tail corner */
  --r-block: 0px;
  --r-tile: 16px;
  --r-tail: 4px;
  --r-field: 14px;
  --r-ctl: 16px;
  --r-pill: 999px;
  --r: 16px;
  --seam-w: 3px;

  /* spacing */
  --s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-5: 24px; --s-6: 32px; --s-7: 48px;

  /* the only shadow: for the few things that float (toasts) */
  --shadow-float: 0 10px 28px rgba(8, 7, 12, .5);

  /* motion */
  --t-press: 120ms; --t-fast: 160ms; --t-base: 220ms; --t-slow: 320ms; --t-room: 380ms;
  --ease-out: cubic-bezier(.23, 1, .32, 1);
  --ease-in-out: cubic-bezier(.77, 0, .175, 1);
  --ease-drawer: cubic-bezier(.32, .72, 0, 1);

  /* layers */
  --z-video: 0; --z-light: 2; --z-deck: 4; --z-chrome: 5; --z-banner: 6; --z-count: 7; --z-door: 9;
  --z-player: 40; --z-review: 45; --z-sheet: 60; --z-toast: 100;

  /* type */
  --display: 'Tilt Warp', 'Arial Black', system-ui, sans-serif;
  --body: 'Figtree', system-ui, -apple-system, sans-serif;
  --mono: 'Chivo Mono', ui-monospace, Menlo, monospace;
  --fs-hero: clamp(72px, 24vw, 112px);
  --fs-num: 96px; --fs-1: 34px; --fs-2: 26px; --fs-3: 21px;
  --fs-body: 16px; --fs-sm: 14px; --fs-xs: 12.5px; --fs-micro: 10.5px;

  /* room chrome sizes */
  --band-h: 52px;

  /* old names, kept as aliases (games.css and older rules use them) */
  --bg: var(--ground);
  --bg2: var(--ground-2);
  --panel: var(--surface);
  --panel2: var(--surface-2);
  --line: var(--seam);
  --ink: var(--chalk);
  --ink2: var(--chalk-2);
  --ink3: var(--chalk-3);

  --safe-t: env(safe-area-inset-top, 0px);
  --safe-b: env(safe-area-inset-bottom, 0px);
  color-scheme: dark;
}
```

Rooms and patterns (goes right after `:root`):

```css
/* ---- rooms: one id, one color, one pattern ---- */
[data-room], [data-you], .home, .page {
  --room-deep: color-mix(in oklab, var(--room) 84%, #15121c);
  --room-dim: color-mix(in oklab, var(--room) 16%, #0f0d15);
  --accent: var(--room);
}
.home, .page { --room: var(--chalk); }
[data-room="ember"]  { --room: #ff6a3d; }
[data-room="rose"]   { --room: #ff7aa2; }
[data-room="sea"]    { --room: #4fd1a5; }
[data-room="sky"]    { --room: #4cb3ff; }
[data-room="violet"] { --room: #a58bff; }
[data-room="lime"]   { --room: #c6f432; }
[data-room="sun"]    { --room: #ffb02e; }
/* patterns are two-tone: the room color and a slightly deeper shade of it */
[data-room="ember"], [data-you], .home, .page {
  --pat: repeating-linear-gradient(135deg, var(--room-deep) 0 12px, transparent 12px 24px);
}
[data-room="rose"] {
  --pat: radial-gradient(circle, var(--room-deep) 0 5px, transparent 5.6px) 0 0 / 24px 24px,
         radial-gradient(circle, var(--room-deep) 0 5px, transparent 5.6px) 12px 12px / 24px 24px;
}
[data-room="sea"] {
  --pat: radial-gradient(circle at 50% 100%, transparent 0 8px, var(--room-deep) 8.5px 12px, transparent 12.5px) 0 0 / 28px 16px;
}
[data-room="sky"] {
  --pat: repeating-radial-gradient(circle at 100% 0, transparent 0 14px, var(--room-deep) 14px 19px);
}
[data-room="violet"] {
  --pat: conic-gradient(var(--room-deep) 25%, transparent 0 50%, var(--room-deep) 0 75%, transparent 0) 0 0 / 32px 32px;
}
[data-room="lime"] {
  --pat: linear-gradient(135deg, var(--room-deep) 25%, transparent 25%) -14px 0 / 28px 28px,
         linear-gradient(225deg, var(--room-deep) 25%, transparent 25%) -14px 0 / 28px 28px,
         linear-gradient(315deg, var(--room-deep) 25%, transparent 25%) 0 0 / 28px 28px,
         linear-gradient(45deg, var(--room-deep) 25%, transparent 25%) 0 0 / 28px 28px;
}
[data-room="sun"] {
  --pat: repeating-conic-gradient(from 0deg at 100% 100%, var(--room-deep) 0 5deg, transparent 5deg 10deg);
}
/* a full patterned wall, and a wall that is flat on the left with the pattern on the right */
.pat { background: var(--pat), var(--room); }
.pat-right { background: linear-gradient(90deg, var(--room) 0 58%, transparent 58%), var(--pat), var(--room); }
```

Notes on the token layer:

- `--accent` always means "the color of the place you are in". It is redeclared wherever `--room` changes (that is what the first rule in the rooms block is for; a custom property that points at another one is resolved where it is declared, so it has to be redeclared on the element that changes `--room`). Inside a room and its sheets it is the room color. On You, Saved, onboarding and the empty home it is the person's own color. On Home it is chalk white, so the dock's New chat is a white button and never fights a room.
- `--on-color` is the text and icon color on any color block. The old code hard-codes `#160c08` for this; replace every one with `var(--on-color)`.
- `--puck` is the one translucent value: a solid dark shape at 80%, no blur.
- For games.css: use `--room` / `--accent` for fills, `--on-color` for text on them, `--surface` / `--surface-2` for panels, `--r-tile` + `--r-tail` for anything shaped like a holler, `--mono` for scores and timers. A Play tile is a `.tile`; give it the room color as its background and it will sit in the strip correctly.

Contrast, measured (WCAG ratio, dark ink on each color; second figure is `--on-color-2`, the 80% ink used for secondary text):

| ember | rose | sea | sky | violet | lime | sun | cherry | teal | cloud |
|---|---|---|---|---|---|---|---|---|---|
| 6.5 / 4.9 | 7.5 / 5.4 | 9.7 / 6.5 | 8.1 / 5.7 | 6.8 / 5.0 | 14.4 / 8.6 | 10.1 / 6.7 | 5.9 / 4.5 | 7.6 / 5.4 | 15.6 / 8.9 |

Chalk on ground: 17:1. `--chalk-2` on ground 9.5:1, `--chalk-3` 5.7:1 (5.4 on a sheet). Danger red on a sheet 5.5:1. Record red on ink 5.3:1.

---

## 3. Rooms

### The set

Seven rooms. **The ids do not change**, so no row in `chats.theme` is touched and no chat changes color. Only violet is retuned (a little lighter, so dark ink reads on it). Each id gains a pattern.

| `chats.theme` | Label | Color | Pattern | Was |
|---|---|---|---|---|
| `ember` | Ember | `#ff6a3d` | diagonal stripes | same hex |
| `rose` | Rose | `#ff7aa2` | dots | same hex |
| `sea` | Seafoam | `#4fd1a5` | scallops | same hex |
| `sky` | Sky | `#4cb3ff` | rings from a corner | same hex |
| `violet` | Violet | `#a58bff` | checks | `#9b7bff` |
| `lime` | Lime | `#c6f432` | zigzag | same hex |
| `sun` | Sunny | `#ffb02e` | rays from a corner | same hex |

A pattern is two-tone: the room color and `--room-deep` (the same color mixed 16% toward ink). It reads as texture, never as a second color, and it gives a color-blind family member a second way to tell rooms apart.

A room is applied with one attribute: `data-room={chat.theme}`. Drop the inline `--accent` styles in `HomeScreen.tsx` and `ChatScreen.tsx`; `THEMES` in `bits.tsx` stays (labels, and violet's hex updated) but CSS owns the look.

### Where the room shows up

| Surface | What the room does | What it never does |
|---|---|---|
| Home block (`.chat-card`) | Whole block is the color. Right 40% (`.cc-thumb`) carries the pattern with the last holler in a tail-cornered window on it. | No border, no dark card. |
| Room band (`.chat-top`) | A solid band of the color under the status bar strip: back, name, faces, info. One shape, not three. | Does not run under the clock (the status strip is ink, because iOS draws the clock white). |
| Room deck (`.bottom`) | A solid block of the color holding the strip, panels and the record row. | No scrim, no blur. |
| Strip tiles | Sit on the deck with a dark frame; unwatched ones get a white frame. | Tiles are never tinted. |
| Record button | Dark ring and dark core on the color, red dot in the middle. | The room color is not the record color. |
| Rail | A dark puck column; the open tool is filled with the room color, a tool that has something set shows its icon in the room color. | |
| Recording | Color drains: band and deck go ink, a 3px line of the room color stays on both edges. | |
| Player | Progress bars, scrub and Reply are the room color. | The picture is untouched. |
| Info sheet | Header band and the invite pass are the room color and pattern. | |
| Camera off, voice only, voice playback | The whole picture area is the room's patterned wall. | |
| Wide screens (700px and up) | The area around the phone column is `--room-dim` with the pattern. | |

**The video is never tinted, never patterned, and nothing translucent in the room color ever sits on it.**

### People's colors

Ten swatches, stored as hex in `people.color`. Stored values stay as they are; three are shown differently through a tiny lookup so no row is edited:

```ts
// bits.tsx
const TONE: Record<string, string> = { '#9b7bff': '#a58bff', '#e5484d': '#f2616b', '#f5f0e8': '#eceaf6' };
export const tone = (hex?: string | null) => (hex && TONE[hex.toLowerCase()]) || hex || '#555';
export const COLORS = ['#ff6a3d', '#ff7aa2', '#ffb02e', '#4fd1a5', '#4cb3ff', '#a58bff', '#f2616b', '#c6f432', '#eceaf6', '#2fb8ac'];
```

Why those three: violet matches the room violet; the red is lifted so dark ink passes on it and it sits a step away from the record red; the cream becomes a cool cloud white (no cream anywhere, and a whole You page in beige is exactly the look to avoid). Use `tone()` wherever a person's color is painted: `Avatar` background, `--c` on tiles and in the player, the `--room` of You, Saved, onboarding and the empty home.

A person's color shows up as: their avatar; their typed notes (tile and full screen); the whole top of their own You page; onboarding as they pick; the empty home; the typed-note composer. Person swatches are **round**, room swatches are **square and patterned**, so the two pickers never look alike.

---

## 4. Backgrounds and texture

CSS only, no image files. Two utilities carry all of it: `.pat` (a full patterned wall) and `.pat-right` (flat on the left 58%, pattern on the right).

| Surface | Background |
|---|---|
| Home | Ground `#0f0d15` only shows as the 3px seams, the header strip and the dock. The blocks are the background. |
| Sheets | `--surface`, square top corners, with a band of the place's color and pattern across the top (`.sheet-head`). |
| You, Saved | Ink status strip, a header band in your color with the pattern on the right, then plain ground. |
| Onboarding | Top of the screen is your picked color: pattern on the upper third, flat below with the wordmark. Form on ground. |
| Empty home | One block in your color from the header to the bottom edge: pattern on the upper 38%, flat below with the words. |
| Camera off / denied | The room's patterned wall in the picture area, dark ink text, one dark button. |
| Voice only | The same wall. Your avatar with a dark ring; the `.lvl` ring grows with your voice. The live camera is hidden (`visibility: hidden`), not blurred. |
| Typed-note composer | The whole sheet is your color; you type on the block the others will see. |
| Voice playback | The room's patterned wall, the speaker's avatar with a dark ring, one ring pulsing out. |
| Typed-note playback | A full flat block of the author's color, dark display type, left aligned. |
| Loading | Ground, with a 60px holler-shaped block (three round corners, one sharp) pulsing in ember. |

---

## 5. Type

Google Fonts, three families, each with one job.

| Family | Weights | Job |
|---|---|---|
| **Tilt Warp** (variable: XROT, YROT -45..45) | 400 (it only has one, and it is heavy) | Wordmark, room names, page and sheet titles, section heads, big counts, names on avatars. |
| **Figtree** | 500, 700 | Everything you read or press. |
| **Chivo Mono** | 700 | Numbers that are codes or clocks: invite and link codes, the record timer, durations on tiles, playback time, speed. |

```html
<link href="https://fonts.googleapis.com/css2?family=Tilt+Warp:XROT,YROT@-45..45,-45..45&family=Figtree:wght@500;700&family=Chivo+Mono:wght@700&display=swap" rel="stylesheet" />
```

Replaces the Bricolage + DM Sans link in `index.html`. Also set `<meta name="theme-color">` and the manifest's `background_color` / `theme_color` to `#0f0d15`.

Why Tilt Warp: it is a fat, warm, sign-painter face that nobody else in this category uses, and its two axes bend the letters so they lean and swell. That bend is how a word in Holler looks when someone is using their voice (section 7). At rest all interface text is upright (`XROT 0, YROT 0`); only the wordmark sits at a small permanent lean (`18, 8`).

Sizes (tokens above): hero `clamp(72px, 24vw, 112px)`, count 96, title 34, name 26, section 21, body 16, small 14, fine 13, micro 10.5 (rail labels and tile text only). Two sizes and two weights per component. Body never goes below weight 500 on dark. Labels above fields are sentence case, 14/700; the old uppercase tracked `.lbl` and `.sec` are gone.

Numbers: the unread count on home is 96px display. The record timer is 21px mono. Codes are 26px mono in six cells.

---

## 6. Components and screens

All CSS for everything below is in the mockup's `<style id="holler-system">` block, written against the app's real class names. It is a complete replacement for `src/styles.css`. To lift it: delete the `:where(.app) ` and `.app ` prefixes (the mockup scopes the resets to its phone frames; the app wants them bare: `*`, `button`, `input, textarea, select`, `h1, h2, h3`, `::selection`, `:focus-visible`), replace the `.app { ... }` rule with `html, body, #root { margin: 0; height: 100%; background: var(--ground); color: var(--chalk); font: 500 var(--fs-body)/1.4 var(--body); }` and `body { overscroll-behavior: none; -webkit-font-smoothing: antialiased; }`, and add `img { display: block; }` back. The mockup's second `<style>` is page scaffolding only.

One primary per view is listed for each screen.

### Home (mock 2 and 3)
- **Header**: wordmark 36px chalk, Saved icon, your avatar. 56px tall on ground.
- **The stack** (`.chats`): a flex column, 3px gaps, no side padding. Each `li` is `flex: 1 1 112px`. Live: `1.4 1 150px`. Unread: `2.2 1 232px`. No maximum heights, so the blocks always share the whole screen: one chat fills it (mock 2: name 44px, count 150px), four or five fit without scrolling, and past that they sit at 112px and the list scrolls. There is never a void.
- The last holler's window scales with its block (`height: min(78%, 150px)`, 178px when unread) and keeps the tile shape.
- **A block** (`.chat-card`): grid, name and line on the left, pattern panel with the last holler on the right, faces bottom-left. Name 26px display (34 when unread). Second line 14/700 at 80% ink.
- **Unread**: the block is the tallest, `.badge` becomes the 96px count at bottom-left (pure CSS: the badge is positioned against the card instead of the thumbnail), the thumbnail gets the white frame, faces move to the bottom-right of the text side.
- **Someone recording** (`.chat-card.live`, new class): the name runs the `holler` keyframes (it leans and swells), and the line is a dark pill with a blinking red dot: "Sam is recording". Nothing else on home moves.
- **Here now**: the green dot with a dark ring. **Muted**: the bell-off icon at the top right of the text side. **Seen**: unchanged words, dark ink.
- **No last holler**: a 52px dark disc with the camera or wave icon on the pattern panel. **Last was a typed note**: a small note block in the author's color.
- **Dock** (`.fab-row`): fixed to the bottom on ground. `New chat` is the white primary and takes the width; `Join with code` is quiet text to its left. Button text stays exactly as it is.
- **Install hint / push nudge** (`.hint`): a flat `--surface` block at the top of the stack, same seam.
- **Primary**: New chat. (The unread block is the focal point, by size; it is a place, not a button.)

### Empty home (mock 15)
One block in your color from the header to the bottom edge, headline 44px display, the existing sentence, `Start a chat` as the dark primary, `I have a code` as the tinted secondary. `.empty-art` is hidden. No dock.

### New chat sheet (mock 12)
Band in the picked color with "New chat". Name field (`#cn`, now `.field.big`). **New: a Color row** of seven square patterned swatches; the sheet and the button repaint as you tap. It starts on the first color none of your chats use. `Make it` is the primary in that color. After `api.createChat(name)`, call `api.chatUpdate(id, { theme })` when the pick is not `ember`.

### Join with code (mock 13)
Chalk band, "Join a chat". The code is six cells drawn behind the one real input (`#jc.field.code`): mono, `letter-spacing: calc(cell + gap - 1ch)`, a repeating gradient for the cells, a 3px underline that takes the accent on focus. No extra elements, the caret works, QA can still `fill('#jc')`. `Join` is the primary, disabled until six. The same field style is used by `#lc` in onboarding.

### The room (mock 4)
Top to bottom: ink status strip (`--safe-t`), color band (52px), picture, color deck.

- **Band** (`.chat-top`): back (44px), name 22px display, faces (28px, dark rings, overlapping, with their status dots), info (44px). `.icon-btn.glass` and `.chat-title.glass` lose their own backgrounds; the band is the one shape.
- **Picture**: `.preview` and the canvas stay `inset: 0` and full screen underneath, exactly as now. The band and deck simply cover the top and bottom of it. Nothing about capture changes.
- **Rail**: one dark puck column at the right, just under the band. Buttons 50x50 with a label; open tool filled with the room color; set tool's icon in the room color. Labels hide while a panel is open (as now) and while recording. Its max-height still comes from `--bottom-h`.
- **Deck** (`.bottom`): solid room color, 14px top padding, safe-area bottom padding. `--bottom-h` is still measured by the existing ResizeObserver.
- **Watch new pill**: white, dark text, 3px dark ring, 46px tall, pulled up 39px so it rides the top edge of the deck. It is the primary when there is something to watch. No more bobbing; it rises in once.
- **Strip**: on the deck, 12px gaps, 104px min height. Empty line in dark ink.
- **Tiles** (66x92, tail corner):

  | State | Look |
  |---|---|
  | Video, watched | Thumbnail, 2px dark frame, author avatar in the tail corner, duration (mono, dark chip) in the other bottom corner. |
  | Yours | Tail bottom-right (`.tile.mine`, new class); avatar and duration swap sides. |
  | Unwatched (`.new`) | 3px white frame with a dark line outside it. The old dot is gone; the frame is the signal. |
  | Typed note | A block of the author's color, dark 10.5/700 text. |
  | Voice | Dark tile, author avatar, wave icon. |
  | Seen by (`.tile-seen`) | Small dark capsule of faces top-right; green ring when everyone has seen it; a grey check when nobody has. |
  | Saved | Star top-left. |
  | Sending (`.pending`) | Thumbnail at 50%, white progress bar. |
  | Failed | Red frame, dark overlay, `Retry` (white) over `Delete`. The two buttons are 40px tall, the one place a target is under 44 (the tile is only 92). |

- **Record row**: text-note button (52px dark disc) left, record center (88px), spacer right.
- **Record button states**: idle = dark ring, dark core, red dot. Voice-only mode (`.audio`) = white core, red dot. Counting down (`.counting`) = core shrinks and fades. Recording (`.on`) = core becomes the red rounded square and scales with your voice as now; ring shows red progress. Paused = white core, white progress. Pressed = 0.92.
- **Primary**: Watch new when there is one; otherwise the record button, by size.

### A panel open (mock 5 and 6)
The panel replaces the strip on the deck. Rules for every panel:
- **Chosen = solid dark** (`.chip.on`: dark fill, text in the room color). **Not chosen** = a 13% dark tint. **Done = outline** (`.chip.on.done`: it keeps `.on` because `qa.mjs` clicks `.chip.on:has-text("Done")`). So there is never a second filled button.
- Looks: category tabs are text with a 3px underline on the current one; chips scroll sideways; the strength slider and the note sit under them.
- Voice: one row of chips and the note.
- Draw: ink dots (one row), three brush sizes, Undo, Clear, Done.
- Text: the field (dark, full width), then one row of style chips with Done at the right, then one row of ink dots with Remove. Three rows, no wrapping.
- More: five dark tiles in a row; a set one gets a room-color outline and icon.
- Ink dots are 32px with a 44px touch area.

### Recording (mock 7)
`.chat.is-rec` (new class; `.chat:has(.rec.on)` does the same job as a fallback). Band and deck go ink with chalk text, each with a 3px line of the room color; the strip is removed, so the deck drops from 285 to 176 points and the picture grows by about 110; the rail drops its labels; discard is a tinted disc on the left; the timer (21px mono) is on the right; "Tap to send" under the button. The "is recording" and "is watching" banners sit 10px under the band: solid red and solid puck, no glow, no blur.

### Voice only, camera off (mock 8)
See section 4. The deck and band are unchanged.

### Player (mock 10)
The one screen where the picture owns everything.
- **Top**: bars (4px, room color on a 34% white track) over a top scrim; author avatar 38px with a chalk ring, name 20px display, time; close is a solid puck.
- **Captions**: chalk text on a puck label, left aligned, kept clear of the tools.
- **Tools** (`.p-tools`): one dark puck column at the right, the same place tools live in the room: speed (mono text), captions, save, download, delete (yours only). Icon only, 50x48 each, labels kept in the DOM inside `<span class="lb">` and as `aria-label`. On = icon in the room color.
- **Bottom**, over a scrim, no band: time (mono) and scrub; then the six reactions in a row, chalk, 48px each (color only appears in the burst); then **Reply**, full width, 54px, room color.
- **Your own holler**: receipts row of puck chips above the scrub.
- **Typed note**: full block of the author's color, display type, left aligned. **Voice**: the room's wall.
- **Primary**: Reply.

### Chat info (mock 11)
- **The pass**: the band (room name, close) and `.invite` are one continuous block of the room color. Inside: "Invite code", the code in six dark cells (`.code-big`, same technique as the input, text content unchanged), the QR on a white square (generate it with dark `#15121c`, light `#ffffff`), `Send invite` as the dark primary, the fine print. `.invite-side` is `display: contents` so this needs no markup change.
- **People**: 52px rows with hairlines. **Chat name**: a normal field. **Color**: seven square patterned swatches in one row (a 7-column grid, about 43px each).
- **Mute** is a normal secondary button. **Leave chat** is plain red text pushed to the far right.
- **Primary**: Send invite.

### You (mock 14)
- Header band in your color (back, "You" 34px display, pattern on the right) and, joined to it, the profile block: avatar 96px with a dark ring and camera badge, your name as a 28px display field with a dark underline, and the ten colors as **one sliding row**. Tapping a color repaints the top.
- Below: no boxes. Section names 21px display. Rows are 60px with hairlines. Toggle: 54x32, off = `--surface-2` with a grey knob, on = your color with a dark knob. Speed is a segmented control (mono, 44px, chosen = your color). Selects are `.field.sel`. The storage meter is a square 12px bar in your color.
- Sign out is red text at the bottom, not a filled button in a card.
- **Primary**: none, unless notifications are off, in which case `Turn on notifications` is it.

### Saved
Same header band in your color. Three columns of tail-cornered tiles, a puck caption strip along the bottom of each (name and when). Empty: a block in your color with the existing words.

### Onboarding (mock 16)
Top: your picked color with the 112px wordmark in dark ink and the two-line tag. Bottom, on ground: the question, the big name field (`#nm`), the colors in one sliding row, `Let's go`, the link. Picking a color repaints the top and the button. The code mode uses the six-cell field. `.ob-rings` is hidden.

### Typed note (mock 9)
The `Send a note` sheet is a block of your own color from band to button (`.sheet.typed`): the textarea is transparent with 28px display type in dark ink, `Send` is the dark primary. What you type is what lands in the strip.

### Shared pieces
- **Buttons**: pills, 48px min, 15/700. Primary = accent fill, dark text. Secondary = `--surface-2`. Ghost = text. Danger = red text, no fill. On a color block the roles flip: primary is dark with chalk text, secondary is a 13% dark tint. Press = `scale(.96)`.
- **Fields**: 52px, 14px radius, `--ground-2`, 2px hairline that takes the accent on focus. Labels above, never a placeholder as the label.
- **Sheets**: square top, band on top, body on `--surface`, 20px sides, safe-area bottom. The grab handle is hidden (the band's close button and a tap outside both close it).
- **Toasts**: white, dark text, 16px radius, the one shadow. They sit **above the deck or dock** (`bottom: var(--bottom-h, 96px) + 40px`), by the thumb, and never on a header. The action (`Undo`) is a 44px dark button inside.
- **Toggles, segmented controls, swatches**: as under You.
- **Avatars**: circles in the person's color, initials in display type, ring from `--ring` (set by whatever they sit on) instead of an inline shadow.
- **Focus**: 3px chalk outline, 2px offset, on `:focus-visible`.

---

## 7. Motion

Five things move. Everything else holds still.

1. **Walking in.** When a room mounts, two blocks of its color cover the screen, part at 42% of the height and slide off to the top and bottom over 380ms (`--ease-drawer`, 80ms delay). They land where the band and the deck already are, so it reads as the color opening to show the picture, and it hides the camera's start-up flicker. `.chat::before` / `::after`, transform only.
2. **The room goes quiet.** Starting a recording: band and deck fade color to ink in 220ms, the strip leaves, the record core turns from circle to rounded square. Stopping reverses it.
3. **A name that hollers.** Tilt Warp's two axes animate (`@keyframes holler`, 1.8s loop). Used in exactly two places: the name of a room on home while someone is recording in it, and the countdown number as it lands (`count-pop`). One element at a time. It is text, so it is cheap, but keep it to short strings.
4. **Sheets and toasts.** Sheet up in 320ms on the drawer curve; toast and the Watch pill rise 10px in 220ms.
5. **Press.** `scale(.96)` in 120ms on buttons, `.985` on home blocks, `.92` on the record core.

Kept from today: the level-driven scale of the record core and the voice ring, reaction bursts floating up, the blinking record dot, the progress ring.

Removed: the bobbing Watch pill, the pulsing rings on onboarding and the empty home, the red glow under banners, every `backdrop-filter`.

Easing: `--ease-out` for anything entering or responding, `--ease-in-out` for the loop, `--ease-drawer` for sheets and the walk-in. Nothing in the interface is slower than 380ms. `prefers-reduced-motion`: animations and transitions collapse and the walk-in blocks are not drawn.

---

## 8. iPhone rules

- **Blur budget: zero.** There is no `backdrop-filter` anywhere, and the `filter: blur(24px)` on the live camera in voice-only mode is gone. After the build, `grep -n "backdrop-filter\|blur(" src/styles.css` should return nothing.
- **Nothing translucent on live video except pucks.** Band and deck are opaque. Rail, tool column, close, banners, captions and the countdown disc are `--puck` (ink at 80%), which gives chalk text at least 9:1 on any frame. No text relies on a text-shadow.
- **Scrims**: only in the player (top 120px, bottom about 250px), plain two-stop gradients.
- **Face stays clear**: in the room the picture is visible from under the band to the top of the deck; its middle is at about 39% of the screen, which is where a face lands when you hold the phone naturally. The rail is the only thing on it, at the right edge. The countdown and look-flash are centered in that visible area, not the full screen. The ring light hugs the visible area too.
- **What you see and what records**: the canvas still records the full frame; the band and deck hide its top and bottom, the same way the old header and scrim covered them. A viewer sees slightly more than you framed, never less.
- **44px targets**: every control is at least 44 in both directions. Checked in the mockup with a script. Exceptions: Retry and Delete inside a failed tile (40px tall), and the seven room swatches at 375px wide (41px).
- **Safe areas**: the band starts at `--safe-t` and the strip above it is ink, so if a given iOS version reports the top inset a few points off in a Home Screen app, nothing readable is lost under the clock. Deck, dock, sheets and the player bottom pad by `--safe-b`. `scripts/layout.mjs` already fakes both; run it at all four sizes.
- **Inputs are 16px or larger** (no zoom on focus). The code field is 26px.
- **Short screens** (under 740px tall): rail buttons drop to 44px with 9.5px labels, and the rail scrolls inside its max-height as it does today.
- **Floor**: `color-mix()` (already used today) needs iOS 16.2; `:has()` needs 15.4 and every `:has()` rule has a plain-class twin (`li.is-unread`, `li.is-live`, `.swatches.rooms`, `.chat.is-rec`). Add those classes in the JSX so nothing depends on `:has()`.

---

## 9. Markup changes the CSS needs

Small and additive. Nothing here removes a class or an id.

**`index.html`, `public/manifest.webmanifest`**: font link, theme and background color `#0f0d15`.

**`src/ui/bits.tsx`**
- `tone()` and the new `COLORS` (section 3). `THEMES.violet.accent = '#a58bff'`.
- `Avatar`: background `tone(p?.color)`; remove the inline `boxShadow`; when `ring` is passed set `style={{ '--ring': ring }}`.
- `AvatarStack`: stop passing `ring`.
- `Sheet`: accept `className`, `room` and `you` and put them on `.sheet` (`data-room={room}`, or `data-you` with `style={{ '--room': you }}`).

**`src/ui/HomeScreen.tsx`**
- `<li className={c.unread ? 'is-unread' : recording ? 'is-live' : ''}>`.
- `.chat-card`: add `data-room={c.theme}`, add `live` when someone is recording, remove the inline `--accent`.
- `.cc-text` background through `tone()`.
- `.empty`: add `data-you` and `style={{ '--room': tone(me.color) }}`.
- New chat sheet: theme state (default: first id in `THEMES` not used by `home.chats`), `room={theme}` on the Sheet, the swatch row (`<div className="swatches rooms">` of `<button className="sw" data-room={k}>`), `#cn` gets class `big`, and the `chatUpdate` call after create.

**`src/ui/ChatScreen.tsx`**
- Root: `data-room={chat?.theme || 'ember'}`, class `is-rec` while recording, remove the inline `--accent`.
- The ResizeObserver also writes `--bottom-h` on `document.documentElement` (and removes it on unmount), so toasts can sit above the deck.
- Tiles: add `mine` when the author is you (all pending tiles are yours); `--c` through `tone()`.
- Draw and Text panels: Done becomes `className="chip on done"`. In Text, split the one wrapping row in two: style chips plus Done, then `<div className="inks">` with the dots and Remove.
- `.live-cap`: wrap the caption text in a `<span>`.
- Typed-note sheet: `className="typed"` and `you={tone(me.color)}`.

**`src/ui/Player.tsx`**
- Root: `data-room={chat?.theme}`.
- Move `.pill-btn.reply` out of `.p-tools` to sit after `.reacts` (same class, same handler).
- In `.p-tools`: wrap each text label in `<span className="lb">`, add `aria-label`s (Speed, Captions, Save), and render the speed button as text only (`{speed}x`).
- Reactions: remove the inline `color` on the six buttons (the burst keeps its color).
- `.p-cap`: wrap the caption in a `<span>`. `--c` through `tone()`.

**`src/ui/ChatInfo.tsx`**
- QR colors `#15121c` on `#ffffff`.
- Swatches: `className="swatches rooms"`, each `.sw` gets `data-room={k}` and loses its inline background.
- `share()`: if `navigator.share` rejects with `AbortError`, return; do not fall through to copy and "Link copied". (From the research: a dismissed share sheet is not a copy.)

**`src/ui/Settings.tsx`, `Saved.tsx`, `Onboard.tsx`**
- `.page` (both) and `.onboard`: add `data-you` and `style={{ '--room': tone(color) }}` (onboarding uses the color being picked).
- Saved: `--c` through `tone()`.

---

## 10. Build order

Each step leaves the app working and can be checked on its own.

1. **Tokens and fonts.** New `:root` with aliases, the rooms block, the font link, theme color. The app looks half-changed but nothing breaks; confirm `games.css` (if it has landed) still resolves every variable.
2. **Plumbing in `bits.tsx`**: `tone`, Avatar ring, Sheet props; add `data-room` / `data-you` and the twin classes in the screens. No visual change yet beyond color.
3. **The room**: band, rail, deck, tiles, record button, panels, recording state, voice only, camera off, banners, toasts. Run `scripts/_layout-i15.mjs` and `scripts/layout.mjs` (all four sizes), then `qa.mjs`, `qa-features.mjs`, `qa-looks.mjs`, `qa-flip.mjs`, `qa-seen.mjs`, `qa-simple.mjs`. Then `node scripts/clean-qa.mjs`.
4. **Player.**
5. **Home**: stack, block states, dock, empty, hint.
6. **Sheets**: shared sheet, new chat with color, join cells, typed note.
7. **Chat info**: the pass, people, swatches, mute and leave, the share fix.
8. **You, Saved, onboarding.**
9. **Motion and polish**: walk-in, `holler` keyframes, reduced motion, focus rings, aria-labels, the grep for blur.
10. **A real iPhone**, the oldest one in the family if possible: record 30 seconds with a look on and watch for dropped frames; check the band under the clock in the Home Screen app; check the strip scrolls and the pill does not cover the rail.

---

## 11. Hooks that must survive

From the brief and from reading every script in `scripts/`. Classes and ids: `.rec`, `.rec.on`, `.rec-row .side-btn`, `.side-btn[aria-label]`, `.rail-btn` (matched by its text and by `aria-label` / `aria-expanded`), `.ktab`, `.looks-panel .chips .chip`, `.chip.on`, `.tools .field`, `.chat-card`, `.cc-sub`, `.me-btn`, `.strip`, `.tile`, `.tile:not(.pending)`, `.tile img`, `.tile-dur`, `.tile-seen`, `.tile-seen.none`, `.new-pill`, `.chat-top`, `.chat-top .icon-btn`, `.chat-title`, `.rec-banner`, `.rec-banner.watch`, `.paused-tag`, `.cut-tag`, `.look-flash`, `.countdown`, `.ring-light`, `.preview`, `canvas.cam`, `video.raw-video`, `.review`, `.review-bar .btn.primary`, `.player`, `.p-top .icon-btn`, `.p-audio`, `.pill-btn` (matched by the text "Save" and "1x"), `.pill-btn.reply`, `.reacts button[aria-label]`, `.rcpt`, `.sheet`, `.sheet-head .icon-btn`, `.sheet textarea`, `.sheet .btn.primary`, `.code-big`, `label.toggle`, `#nm`, `#cn`, `#jc`, `#lc`, `#chn`.

Button and label text the scripts click, which therefore stays word for word: `Start a chat`, `Make it`, `Let's go`, `Join the chat`, `That's me`, `I already have Holler`, `Use on another device`, `Simple camera`, `Done`, `Save`, `1x`, and every rail label (`Flip`, `Looks`, `Voice`, `Draw`, `Text`, `More`, `Pause`, `Light`, `Timer`, `HD`, `Voice only`, `Upload`). Labels that the design hides visually (rail labels while a panel is open or recording, tool labels in the player) stay in the DOM; do not remove the text nodes.

---

## 12. Words that change (Dixon's yes before they ship)

Everything else keeps today's copy.

1. Home, unread line: "3 new hollers" becomes the big **3** with "new from Mom · 12m" beside it. If he would rather keep the old words, the big number still works with "new hollers".
2. Join sheet, new fine line under the cells: "It's on the invite they sent you."
3. New chat sheet: a new "Color" label.

---

## 13. The three calls most likely to bite

1. **The picture is shorter.** On an iPhone 15 the deck measures 285 points with the Watch pill (266 without), so about 460 of 844 points of camera show in a room, and about 570 while recording, where today the camera fills the screen behind a scrim. On an SE it is about 345 points, and with the Text panel open about 275. It buys perfect legibility, zero blur and rooms that are unmistakably different places. If Dixon misses the full-bleed camera, the fallback is one rule: make `.bottom`'s background the old bottom scrim and color only the band, the tiles' frames and the record ring. Decide on a phone, not on the mockup.
2. **Tilt Warp is one loud voice.** It has a single weight and strong shapes. It must stay on names, titles and counts only; if it creeps into body text or buttons the app turns cartoonish. Its animated axes re-shape glyphs every frame, so `holler` stays on one short string at a time.
3. **Hidden labels and the QA scripts.** The rail (while recording) and the player tools now hide their labels with CSS, and Done keeps `.on` only for the scripts. Playwright's text matching reads the DOM, so this should hold, but run the six QA scripts after step 3 and step 4 before going further.

Smaller ones: the six-cell code relies on a monospace face being loaded (the fallback stack is all monospace, so cells still line up); `visibility: hidden` on the canvas in voice-only mode must not stop audio capture (it should not, the canvas is not the audio source; check one voice note on a phone); person red and cream are shown as cherry and cloud through `tone()`, which changes how two existing choices look without touching any row.

---

## 14. An idea nobody asked for: Catch up (mock 17)

When more than one room has something new, a white block appears above the stack: the total as a 72px count, "new across 2 chats", and `Watch all`. One tap plays every unwatched holler across every room, oldest first, in the existing player; the bars and Reply take each holler's room color as it plays, and Reply opens that room. It makes the home's primary action "catch up" on the days there is something to catch up on.

It needs one new read on the server (unwatched hollers across my chats, in order), so it is **not** in the build order above. The block and its states are in the mockup.

---

After it ships: add one line to `~/.claude/design-history-log.md` ("Holler look: color-block patchwork, Tilt Warp / Figtree / Chivo Mono, seven patterned rooms, band-picture-deck. Source: Krehel + Emil").
