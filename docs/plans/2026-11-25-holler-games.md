# Holler Play: first slice build plan (2026-11-25)

Game Night retires into Holler. In Holler a turn is a holler: you play by recording, and the others
watch your face when they watch your move. This plan is the first slice, ready for one builder session
on the PC. Research and the full idea list: `~/.claude/next-sessions/2026-11-25-holler-games-START-HERE.md`.
Mockup Dixon reviewed (numbered screens, notes come back by number): https://claude.ai/artifact/1PosDS4VchS4ZPuTSLzQnM

## Dixon's calls (11-25)
1. **Name:** a plain **Play** tile; each game keeps its own name.
2. **Who plays:** any Holler chat, Kyle's included. (The Belt, when it comes, counts only in chats that turn it on.)
3. **Game clips:** hidden 7 days after the game ends unless someone saves the reel. Hidden clips are deleted
   only by a cleanup run Dixon says yes to.
4. **Later:** live calls (Hang) try STUN-only first, no Cloudflare account unless too many calls fail.
   Game Night comes down once Pass It On is live (separate session, see the end).

House rules that still hold: $0, no Netlify, no emojis, no gold, no Tamara Mark, never Malik anywhere
(names, seeds, copy, history), never figgg's `public` tables, never anonymous auth.

## What's in the slice
Mockup screen numbers in brackets.
- **A. Play tile** [1, 2]: first tile in the chat strip opens a sheet with two things: *Give me a card* and
  *Pass It On*. Live games sit right after the Play tile in Pass It On's ink, showing whose turn it is.
  "Coming next" is one line of text, no locked tiles.
- **B. Film my reaction** [5, 6, 7]: a switch at the top of the player, off by default, remembered per chat
  on the device. While on, your face records in a corner while their holler plays. At the end:
  *Send my reaction* or *Toss it*; nothing sends on its own. The reaction is a normal polo that stores only
  your face plus a sync timeline; the player plays it big with the original small and in sync, tap to swap.
- **C. Cards** [3, 4]: a card on the picture while you record, burned into the video like Text. Three decks:
  **Say** (Quip prompts), **Guess** (the verified survey percents; the real answer shows in the player after
  the clip), **Act** (Telephone lines). Shuffle; cards this chat has already used go to the back.
  **Everyone answers**: a holler with a card shows *Answer this card*; answers to the same card stack into
  one tile in the strip.
- **D. Pass It On** [8 to 12]: 3 to 5 players. The starter gets a secret phrase and acts it out with no words
  (5, 10 or 15 seconds). Each next person gets **one look** at only the clip before theirs, then copies it.
  The last person guesses the phrase out loud. The reveal plays the whole chain, then the phrase next to the
  guess. *Film my reaction* starts on for reveals and those faces become the end of the reel. Save the reel,
  or the clips hide 7 days after the game ends. One nudge button; a player who hasn't gone in 48 hours is
  skipped so a game never stalls.

**Not in this slice:** Poker Face, Charades Relay, On The Spot, face games (no MediaPipe FaceLandmarker yet),
The Long Game, The Belt, bots, Hang. Each gets its own session after this one.

## Data: `supabase/games.sql` (additive)
Apply on the PC with `MSYS_NO_PATHCONV=1 node scripts/sb.mjs sql supabase/games.sql`. Everything is new
tables, new nullable columns or `create or replace` of Holler's own functions in the `holler` schema: no
rows rewritten, nothing dropped. Read it through once before running; no game rows exist yet, so the
`holler_chat` filter changes nothing for today's hollers.

```sql
create table if not exists holler.games (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references holler.chats(id) on delete cascade,
  kind text not null check (kind in ('passiton')),            -- widen per game
  status text not null default 'playing' check (status in ('playing','done','ended')),
  state jsonb not null default '{}',     -- what every player may see
  secret jsonb not null default '{}',    -- never returned whole; see holler.game_json
  version int not null default 0,        -- bumps on every change; compare-and-swap for later games
  turn_person uuid references holler.people(id) on delete set null,
  turn_since timestamptz,
  nudged_at timestamptz,
  created_by uuid references holler.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  saved_by uuid references holler.people(id) on delete set null,
  saved_at timestamptz                    -- non-null = reel saved, clips never hide
);
create index if not exists games_chat_idx on holler.games (chat_id, status);

alter table holler.polos add column if not exists game_id uuid references holler.games(id) on delete set null;
alter table holler.polos add column if not exists game_turn int;
alter table holler.polos add column if not exists react_to uuid references holler.polos(id) on delete set null;
create index if not exists polos_game_idx on holler.polos (game_id) where game_id is not null;
revoke all on holler.games from anon, authenticated;
```

Pass It On `state`:
`{ order: [personId...], turnSec: 10, idx: 0, turns: [{ who, polo, at, skipped }], looked: { personId: ts }, guess: null | text }`
and `secret`: `{ phrase, deckId }`. Card and reaction details ride in `polos.effects` (below), no new columns.

### Why Pass It On's rules live in SQL, not a client `reduce`
The brief suggested the acting phone runs Game Night's `reduce` and writes state with a version check.
For Pass It On the rules are tiny (append a turn, move the pointer, skip, end) and the phrase and the middle
clips must stay hidden from the other phones, which a client-side reduce can't do because every phone would
hold the whole state. So Pass It On is plain plpgsql RPCs, and the server knows whose turn it is (no race,
no CAS needed). `version` is there for the heavy games later (Phase 10, Aggravation, Poker Face), which port
Game Night's pure `GameDef` logic and write `state` through a generic `holler_game_put(token, game, expected_version, state)`
compare-and-swap. Don't build that RPC in this slice.

### RPCs (all `public.holler_*`, security definer, token-gated like the rest)
- `holler_game_start(p_token, p_chat, p_kind, p_order uuid[], p_turn_sec int, p_phrase text, p_deck_id text)`:
  caller is in the chat and is `p_order[1]`; 3 to 5 distinct members; turn_sec in (5, 10, 15); phrase 1 to 120 chars.
  Sets `turn_person` = caller, `turn_since` = now(). Returns `game_json`.
- `holler_game(p_token, p_game)`: the detail view [11, 12]. Runs the lazy skip first (below).
- `holler_chat` (replace): its `polos` list adds `and po.game_id is null` (turn clips never show as normal
  tiles), and it gains a `games` key: games in this chat that are playing, or ended within 7 days, or saved.
- `holler_game_look(p_token, p_game)`: for the person whose turn it is (idx >= 1), returns the previous turn's
  `path`/`thumb`, unless `state.looked[me]` is set. Doesn't mark anything.
- `holler_game_looked(p_token, p_game)`: the client calls it when that clip plays to the end. After this,
  `holler_game_look` refuses. A look cut off by a call or a crash can be retried; a finished one can't.
  Trust-based like Game Night (a friend digging in the network tab could cheat; that's fine).
- `holler_start_turn(p_token, p_game, p_ext, p_mime)`: same as `holler_start_polo` for kind 'video', but checks
  it's my turn (and that I have looked, if idx >= 1), sets `game_id` and `game_turn = idx`. Upload and
  `holler_finish_polo` then run exactly as today (outbox, retry, empty-file guard all work).
- `holler_finish_polo` (replace): after marking ready, `if po.game_id is not null then perform holler.game_advance(po)`.
  `game_advance` appends the turn, takes `effects.game.guess` (the guesser's typed or caption guess) on the
  last turn, moves `idx`/`turn_person`/`turn_since`, sets status 'done' and `ended_at` after the guess, bumps
  `version`, and sends the targeted push (below).
- `holler_game_nudge(p_token, p_game)`: any player, at most once per 6 hours per game; pushes the person up.
- `holler_game_save(p_token, p_game, p_on)`: any player saves or unsaves the reel.
- `holler_game_end(p_token, p_game)`: the starter ends a game early (status 'ended', `ended_at` = now()).
- **Lazy skip:** `holler.game_tick(g)` runs inside every read and write of a game: if `turn_since < now() - 48h`
  it marks that turn skipped and moves on (a skipped copier means the next person copies the last real clip;
  a skipped guesser means the reveal shows no guess; if the starter never records the first clip, the game
  ends with nothing to show). A person who left the chat is skipped at once.
  No cron in this slice. An automatic 24-hour nudge needs pg_cron in figgg's project: later, and only after
  checking whether figgg already runs it.
- `holler.game_json(g, me)` decides what each person sees: the phrase only for `order[1]` (or everyone once done);
  turn clip paths only for everyone once done, and only while `saved_at is not null or ended_at > now() - 7 days`;
  otherwise who has gone, when, and whose turn it is. The 7-day hide is computed at read time, so nothing gets
  rewritten when a game ages out.

### Push
`holler-push` already takes any `{ title, body, chat, url, subs }`. Factor the subs lookup in `push.sql`
into `holler.push_to(p_chat, p_people uuid[], p_body text)` and call it from `game_advance` and the nudge:
- next turn: only the person up gets "Your turn in Pass It On";
- reveal ready: every player gets "Pass It On is ready to watch".
`notify_polo` returns early for `new.game_id is not null` so turn clips never send the normal "X hollered".
Reaction polos keep the normal push, worded "Dixon reacted to your holler" for the original's author.
Pushes reach Home Screen app users only; Safari-tab users see "Your turn" on the game tile.

### Clip expiry and cleanup
- Hidden = the game ended over 7 days ago and nobody saved the reel. Hidden clips are not returned anywhere.
- `scripts/game-sweep.mjs` (new, PC): lists hidden game clips with sizes and the total. With `--delete` it sets
  those polos to 'deleted' and removes the files, the same path `holler_delete_ok` already allows.
  **Run `--delete` only with Dixon's yes in that session** (friends' clips count as his content).
- Size budget: SD turn clips at the 15-second cap are about 2 to 3 MB, so a 4-person game is about 10 MB.
  Reaction clips record at 360x480 and about 600 kbps (about 2 MB for 30 seconds).

## Client
- `src/games/content/`: ported pools (see the port list). `src/games/content/cards.ts` builds the three decks
  with stable ids (`say:c01`, `guess:<n>`, `act:<n>`).
- `src/games/passiton/`: `logic.ts` (pure helpers for the UI: who's up, chain dots, reveal order; the rules
  are in SQL), `Start.tsx` [8], `Turn.tsx` [9, 10], `Track.tsx` [11], `Reveal.tsx` [12], `logic.test.ts`.
- `src/ui/PlaySheet.tsx` [2], game tile + Play tile in `ChatScreen.tsx`'s strip. On 11-25 night another
  session was moving the rail's HD, Timer, Voice only and Upload into a **More** panel (uncommitted on the PC
  when this was written). Build on whatever landed; the mockup's rail predates it. The Card button goes in the
  rail only while a card is on.
- **Cards:** `effects.card = { deck, id, text }`. The studio's overlay canvas draws the card (new
  `drawCard` beside the text layer) so it's in the file. Used-card memory per chat comes from the chat's own
  polos' `effects.card.id` (no table). Strip stacking groups by `effects.card.id`; the stack plays in order.
  A Guess card's player view shows the real number and source after the clip ends.
- **Reactions:** `polos.react_to` = the original. `effects.sync = [{ r, o, rate, playing }]`, one entry each
  time the original plays, pauses, seeks or changes speed, so playback lines up even if you paused. The player
  for a reaction plays the face big and the original small (tap to swap), and the original's reaction bursts
  at their seconds. If the original is gone, the reaction plays alone with a small "original is gone" line.
  Tile = reaction thumb with the original's thumb in the corner.
- **Turn recording:** the chat screen's studio with a fixed turn length (ring fills, sends itself),
  `holler_start_turn` instead of `holler_start_polo`, phrase shown as a DOM overlay (not on the canvas, so it
  isn't recorded). Looks and voices allowed. The guesser's turn ends with a text field prefilled from live
  captions ("What did you guess?"), sent as `effects.game.guess`.
- **Routing:** every game screen is app state on top of the chat screen. Never change the address
  (the Home Screen app routes in memory; WebKit bug 215884 drops camera permission on a hash change).
- **Realtime:** after any game RPC, broadcast the existing `ev` on `holler:<chatId>`; clients refetch
  `holler_chat`. Presence stays a one-time `track()`.

## iPhone constraints (test on the Home Screen app, not just Safari)
1. **Spike first, before building reactions:** on Dixon's iPhone, play a holler with sound while the studio
   records the front camera and mic. Check (a) whether playback drops to the earpiece or gets quiet once the
   mic is live, (b) how much of their audio leaks into your clip with `echoCancellation: true`. If either is
   bad: record the reaction with the mic muted while their clip plays and live after it ends (a toggle), and
   say so in the switch's note. Decide this before writing the player code.
2. **Camera once per launch:** the reaction recorder must reuse the studio's existing stream (tracks are
   paused, never stopped). Never call `getUserMedia` from the player.
3. **Backgrounding mid-turn** stops MediaRecorder. Throw the partial take away and let them redo the turn;
   a turn only counts once `holler_finish_polo` succeeds. Same for the one look (it counts at the end of playback).
4. **Simple camera users** (no WebGL) play everything: turns and reactions record the raw camera, no looks.
5. **Speech captions** are flaky on iPhone, so the guess is always an editable text field.
6. **Sound** needs a tap: the reveal opens on the player's existing "Tap to play".
7. **No MediaPipe in this slice.** Face games later run FaceLandmarker one model at a time (background cutout off).

## Port list from Game Night (`dixxxvhb/fam-game-night`, `~/Code/fam-game-night` on the PC)
Grep every file for Malik before it lands. As of 11-25 the content files are clean and the only hits are
`src/games/quip/logic.test.ts` and `src/games/trivia/show.test.ts`: don't port those tests as they are.
Never port `scripts/historical-data.json` or any of its history.

**Now (this slice)**
| From | To | Why |
| --- | --- | --- |
| `src/games/telephone/prompts.ts` (`PROMPTS`) | `src/games/content/act.ts` | Pass It On phrases + the Act deck |
| `src/games/quip/prompts.ts` | `src/games/content/say.ts` | Say deck (keep the House answers for Quip later; `{player}` lines swap in a chat member's name or skip) |
| `src/games/percent/questions.ts` | `src/games/content/guess.ts` | Guess deck, with sources |
| `src/lib/shuffle.ts` (`shuffle`, `pick`, `freshFirst`) | `src/games/content/shuffle.ts` | unseen cards first |
| vitest setup + `freshFirst` tests | Holler `package.json` | Holler has no test runner yet |

**Next sessions**
- Poker Face: `src/games/_lie/` + `bluff/facts.ts` + `fakeword/words.ts` (and Bluff v2's About Us round for Hot Seat).
- Charades Relay: `forehead/decks.ts` + `forehead/logic.ts`.
- On The Spot: `_quiz/questions.ts`, `_quiz/bank.ts`, `trivia`, `survive`, and `_quiz/music.ts` (synth sound).
- The Long Game: `phases` (Phase 10) and `aggro` (Aggravation) logic + tests, through `holler_game_put` (CAS).
- Engine: `src/engine/types.ts` `GameDef` trimmed for async (no TV `Stage`/`Controller` split), `points.ts`
  for The Belt, the bots for practice.
- Leave in the archive: Party Park, Turnpike, Kaboom, Gator Lanes, kart, arena, board. Revisit only if Hang takes off.

## Build order (one builder session on the PC, builder-opus: SQL plus studio plus player is wide)
0. `git pull`. Read this file, `README.md`, `src/lib/studio.ts`, `src/ui/ChatScreen.tsx`, `src/ui/Player.tsx`, `supabase/*.sql`.
1. iPhone spike (constraint 1). Write the result into this file.
2. `supabase/games.sql`, applied with `sb.mjs`. Then `scripts/qa-games.mjs`: four fake people play a full game
   (start, one-look refusal on a second look, a 48-hour skip by backdating `turn_since`, the guess, the reveal),
   check that turn clips never appear in `holler_chat` polos and that a game ended 8 days ago returns no paths.
3. Film my reaction (player, sync timeline, reaction playback, tile). Extend `qa-features.mjs`.
4. Cards + Everyone answers.
5. Play tile, sheet, and the Pass It On screens.
6. `npm run build`, every QA script, then **always `node scripts/clean-qa.mjs`**. Render check at 390 wide.
   Deploy with `bash scripts/deploy.sh` (personal site on GitHub Pages: ships on the build + tests + rendered
   check bar), then check the live site and play one real game with Dixon's phone.
7. Update `~/.claude/next-sessions/status/holler.md` and memory `project-holler`; `duet --done`.

## After it's live: retire Game Night (its own session)
Walls first: never delete Dixon's content; figgg database changes go through `scripts/figgg-sql.ps1`.
Export `gamenight.*` to JSON in the old repo, leave the `gamenight` schema until Dixon says drop it
(dropping is destructive and needs his yes), put up a "Game Night moved into Holler" page or unpublish Pages,
archive the GitHub repo (ask whether to make it private), and update memory `personal/project-game-night.md`
and both status files.
