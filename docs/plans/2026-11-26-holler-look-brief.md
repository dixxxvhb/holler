# Holler look: design brief for Fable (2026-11-26)

## Goal
Dixon wants Holler to have a look and UI system of its own: the rooms (each chat's camera screen), settings,
colors, starting a new chat, joining with a code, backgrounds, the whole feel. Not a Marco Polo or Snapchat
copy, and not figgg's look. Holler is personal (Dixon plus his family and friends), not DWD: no DWD brand,
no Tamara Mark, no gold.

## What Holler is
A free private async video-message PWA for 2 to 5 close people, used mostly as an iPhone Home Screen app.
You record a short video (or voice note, or text note) in a chat; the others watch when they can.
Repo: ~/Code/holler-look (branch ui/holler-look, a git worktree of ~/Code/holler). React 19 + Vite, one
stylesheet `src/styles.css` (377 lines), screens in `src/ui/`.

## Today's screens (screenshots at iPhone 15 size, 2x, in `shots/layout/`)
- `i15-1home.png` home: wordmark, chat cards, Join with code and New chat floating buttons.
- `i15-2chat.png` a chat ("room"): full-screen camera, glass header with chat name and faces, right-side
  tool rail (Flip, Looks, Voice, Draw, Text, More), "Watch 4 new" pill, strip of holler tiles, record button.
  (The camera in these shots is Chrome's fake green test feed; on a phone it's a face.)
- `i15-2bmore.png` More tray, `i15-3looks.png` Looks panel, `i15-4rec-looks.png` / `i15-5rec.png` recording,
  `i15-6draw.png` draw tools, `i15-7text.png` text tools.
- `i15-8player-own.png`, `i15-9player-other.png` player: story bars, reactions, speed/save/download, Reply.
- `i15-10info.png` chat info sheet: QR + invite code, people, chat name, chat color, Mute, Leave.
- `i15-11settings.png`, `i15-12settings-bottom.png` settings ("You").
- `i15-safari-1home.png` home in Safari (install hint card).
- Not screenshotted: onboarding (`src/ui/Onboard.tsx`), new chat and join sheets (`src/ui/HomeScreen.tsx`),
  saved (`src/ui/Saved.tsx`), empty home, camera-off, voice-only mode, text-note composer.

Current system: warm near-black ground (#120d0b), one orange accent (#ff6a3d), per-chat accent from 7
themes (ember, rose, sea, sky, violet, lime, sun; stored as `chats.theme`), per-person color from 10 swatches
(`people.color`), Bricolage Grotesque display + DM Sans body, pill buttons, 18px radius, glass blur on
camera chrome. It works but it's generic: nothing about it says Holler.

## Hard constraints
- Camera screen: video legibility first. Chrome over live video needs a scrim or solid backing, 44px+ tap
  targets, iPhone safe areas (`--safe-t`, `--safe-b`), and must not cover the face (upper middle of frame).
  The rail already measures the bottom area (`--bottom-h`) so it never overlaps; keep that working.
- Keep every existing feature and class hook that logic or QA scripts use (`.rec`, `.rail-btn`, `.chat-card`,
  `.tile`, `.strip`, `.chat-title`, `.sheet`, `.code-big`, `#nm`, `#cn`, `#jc`, `.side-btn`, `.p-top .icon-btn`
  and so on). A redesign can add classes and wrappers, not remove these.
- Another session is building Holler Play (games) at the same time: a Play tile in the strip, game tiles,
  a card panel, a "Film my reaction" switch in the player. Its styles go in `src/games/games.css` and will
  use our CSS variables. So the token layer must be clean, named, and keep the old names (`--accent`,
  `--panel`, `--panel2`, `--bg`, `--bg2`, `--ink`, `--ink2`, `--ink3`, `--line`, `--r`) as aliases.
- Fonts: Google Fonts only (free). No emojis anywhere. No theatre or stage language.
- $0: no paid services or assets.
- Performance: backdrop-filter over live video is costly on older iPhones; budget it.

## Dixon's taste (read `~/.claude/design-taste.md` and `~/.claude/design-sources.md` yourself)
Bold and alive beats a tidy reorganization when he gives free reign. A new surface gets its own look.
Hierarchy by size, weight and space; one focal point per screen; one primary button per view; no boxes in
boxes; no cream-by-default; motion on the focal point or a state change, not ambience everywhere.
Mockups for him are one scrolling page of numbered full-width screens, today's screen first, a short note
above each.

## Research
See `docs/plans/2026-11-26-holler-look-research.md` (filled in by a research pass).

## Lead's audit of today's screens (what's weak)
- The chat's color barely exists. It tints the record button and a thin border on the home card, and that's
  it. "Rooms" don't feel like different places.
- Home: one generic list row per chat, then a big empty void; the wordmark is plain orange type; "Join with
  code" and "New chat" float at equal weight, so neither leads. No sense of who's waiting on you.
- Chat header: a big glass pill holding a name and one 22px face, mostly empty; three separate glass shapes
  across the top.
- Text and draw panels: the active style chip and "Done" are both filled orange, so there are two primaries;
  ink dots wrap into a second row next to chips; it reads as a pile.
- Player: an opaque dark band with reactions cuts the full-bleed video; three grey pills plus an orange Reply.
- Chat info: monospace join code in orange clashes with the rest of the type; "Leave chat" is a filled pink
  button next to Mute, so a destructive action has the most color on the sheet.
- Settings: stock cards and toggles; a 6 plus 4 wrapping swatch grid; nothing personal about "You".
- Toasts drop right onto the header area.
- Fonts (Bricolage + DM Sans) are fine but default-feeling; numbers (timer, durations, codes) get no love.
