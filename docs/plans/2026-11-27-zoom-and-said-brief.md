# Two new Holler games, Zoom In and Who Said It: brief for builder-opus
Date: 2026-11-27 · Repo: C:\Users\bowle\Code\holler · Branch: create `holler/zoom-said` from main (76010a3) · Author: lead session

## 1. Decision (what and why)
Dixon picked two games from a brainstorm: **Zoom In** ("sounds hilarious") and **Who Said It**, "for each person individually". Holler is a private Marco Polo style video chat for Dixon and a few friends (React 19 + Vite + TS, Supabase RPCs in the `holler` schema of figgg's project, GitHub Pages). It already has 11 games; both new ones follow the "everyone at once" pattern of Don't Laugh / On The Spot (`supabase/games4.sql`, `src/games/Laugh.tsx`, `src/games/Spot.tsx`): no turn order, `state.todo` lists who still owes something, 2 days idle closes it.

Who Said It was first pitched as "guess who said a real line from the chat's history", but there is no history to use: iPhone hollers save no captions (`ChatScreen.tsx` ~line 370 skips the captioner on iOS) and the real chats hold 3 text notes in total. So it is built from prompts ABOUT each person instead; that is also the "each person individually" part. One of the friends (John) can't use his camera, so Who Said It must work fully with no camera, and Zoom In must let a no-camera phone join as a guesser.

## 2. The games (the lead's design calls; build these, don't redesign)

### Zoom In (`kind 'zoom'`, 2 to 6 people)
- **Film phase, everyone at once.** You type what your thing is (secret, 1 to 40 characters), then record a 5 second clip of it, filmed normally with the whole thing in frame. The recorder shows a small centre target and the line "Hold it in the middle. They start way zoomed in." The clip sends itself at 5 s (fixed turn length, like Don't Laugh's clip). The answer must never be readable by others before they guess: it goes to `games.secret`, and it is removed from the polo's `effects` server side (follow how `laugh_take_turn` / `spot_take_turn` take a game clip in through `holler_finish_polo` and `game_take_turn`).
- **Just guess.** A phone in Voice or Notes mode (`camMode()` in `src/lib/device.ts`), or anyone who taps "Just guess" on the game page, skips filming: they drop out of the film todo and only guess. The game needs at least one clip to go on.
- **Guess phase.** For each clip that isn't yours: the clip loops muted, starting at 8x zoom on the centre and pulling out smoothly to 1x over 20 s (scale on the video element, exponential so it feels steady). A big "I know it" button stops the pull-out and records how far out it was (0 to 1). You type a guess (1 to 40 characters). Then the reveal: the answer, the clip full frame with sound, and "Did you get it?" Yes / No (honour system, it's friends). If the pull-out reaches 1x with no tap, you still type a guess.
- **Score.** Yes before a third of the pull-out = 3, before two thirds = 2, after = 1, No = 0. The filmer gets nothing for stumping people (that would reward impossible clips); instead the end screen names the hardest clip.
- **The funny part: wrong guesses.** After you've done a clip, you see everyone else's guesses for it with their names ("Kyle: a dog's nose"), like Don't Laugh shows faces only after you've watched. The end screen shows every clip with its answer and all the guesses.
- Camera needed only to film; it joins the camera-game handling that already exists (Pass It On, Charades, On The Spot, Don't Laugh say they need one in Voice/Notes mode), except it offers "Join as a guesser" instead of blocking.

### Who Said It (`kind 'said'`, 3 to 6 people)
- **Each person gets a prompt about them.** At the start the server deals one prompt per person from a deck of templates with the person's first name in them, for example "{name}'s secret talent", "What {name} was in a past life", "The warning label on {name}", "{name}'s go-to karaoke song", "The first thing {name} buys with a million dollars". Write 40 templates: playful roasts, never mean about bodies, money troubles, exes, or anything that would sting; short enough to read in one glance. Plain words, no emojis, no em or en dashes. Keep them in `src/games/content/said.ts` (client) and pass the chosen template ids to the server in `p_opts` the way other games pass their deck draws, OR keep the deck in SQL; pick whichever matches how On The Spot / Trivia already deal (read that first).
- **Write phase, everyone at once.** You answer the prompt for every other person (n minus 1 answers, 1 to 80 characters each). You never see the prompt about yourself until the guess phase. Answers are secret until guessing (in `secret`).
- **Guess phase.** For each person's prompt you see the answers about them, shuffled, minus your own, and match each answer to who wrote it by tapping a face (each face used once, a little matching board). The best one is your own prompt: you see what everyone wrote about you and guess who said each. Skip any prompt where only one answer would be left to match (nothing to guess; at 3 people that's every prompt that isn't about you); those just show in the reveal.
- **Score.** 1 per correct match. A writer gets 1 "fooled" point each time someone pins their answer on someone else (so writing in someone else's style pays).
- **Reveal and end screen.** Per person: the prompt, every answer with who wrote it, and who guessed what. This is the payoff screen, so make it the best looking part.
- Works fully on a phone with no camera.
- Later, not now: a voice version (answers recorded in a disguised voice from `src/lib/voice.ts`) and a "from the archives" version once hollers carry transcripts. Mention both in the plan doc's "Next" line, build neither.

## 3. Files you own
- NEW `supabase/games7.sql` (additive: widen `games_kind_check` with `'zoom', 'said'`, add their rules, replace the dispatchers `game_label`, `game_json`, `game_tick`, `game_take_turn`, `holler_game_begin`, `holler_game_start2` and any other dispatcher keeping every older kind's behaviour byte for byte; new RPCs `public.holler_*`, security definer, token gated, member checked, granted to anon and authenticated, like the rest). Safe to run twice. Read the LATEST definition of each dispatcher (games5.sql/games6.sql may have replaced games4's) before replacing it.
- NEW `supabase/games7-check.sql` (dry run: does everything, runs the tests, then raises an exception on purpose so nothing sticks; copy how `games6-check.sql` does it) and `supabase/games7-tests.sql`.
- NEW `src/games/Zoom.tsx`, NEW `src/games/Said.tsx`, NEW `src/games/content/said.ts`
- `src/games/roundLogic.ts` (`TILE_NAME`, `tileLine`, `isTurns`, `owes` so the dock and home "waiting on you" tag count these), `src/games/Play.tsx` (start sheet entries, player counts, the camera rules), `src/games/all.ts`, `src/games/games.css`, `src/games/Rounds.tsx` only if the shared game page lives there
- `src/ui/ChatScreen.tsx` only for: the `GAME_ICON` map, opening the two game pages from the dock (same way Don't Laugh opens), and recording the Zoom In clip (fixed 5 s turn, the same path Don't Laugh's clip uses). Nothing else in that file.
- `src/lib/api.ts` only to add the new RPC calls and types
- `src/lib/studio.ts` only if the centre target can't be drawn in the game UI over the preview (prefer the UI)
- NEW `scripts/qa-zoom-said.mjs` (copy the shape of `scripts/qa-polish.mjs` / `qa-rounds.mjs`: fake people via the real sign-up flow, `PW_CHANNEL=chrome`, iPhone UA, 390x844, screenshots to `shots/zoom-said/`)
- `docs/plans/2026-11-25-holler-games.md`: add a "Round five built 2026-11-27" section like the others.
No other files. Nobody else is editing this repo right now.

## 4. Hard rules
- **SQL**: run `supabase/games7-check.sql` first with `MSYS_NO_PATHCONV=1 node scripts/sb.mjs sql supabase/games7-check.sql` (it must abort with your deliberate exception and every test before it passing). Only then apply `supabase/games7.sql` the same way. It is figgg's live project: additive only, never rewrite or delete rows of real people, never drop anything but the kind check constraint. `sb.mjs` cuts output at 6000 characters, so keep test output short.
- Never commit to main, never push, never deploy. Commit on `holler/zoom-said` when done (end the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). The lead reviews, merges, deploys.
- QA writes to the real database with fake people named "... QA". After your QA runs, clean them up: `scripts/clean-qa.mjs` overflows when many files pile up, so use the batched cleaner at `C:\Users\bowle\AppData\Local\Temp\claude\fe7063eb42c3ae32\d045ab3c-b62c-4fa4-8508-dfaef127f41a\scratchpad\clean-local.mjs` (run it with `node <that path>` from the repo root). Never touch people not named "... QA". Leave the person called "Desk QA" alone.
- No new npm dependencies. No emojis anywhere. No em or en dashes in any words people see. Words are warm and plain, short.
- iPhone Home Screen quirks are real (read `src/lib/device.ts`, the bottom of `src/lib/studio.ts`, and the game routing note in the plan doc): never change `location.hash` on iPhone standalone (routing is app state), never reload. The shared mic track is never muted or unmuted (11-27 fix: it plays a loud sound on iPhone).
- Nothing in the first download may import `src/games/all.ts`: after `npm run build`, `grep -c pearlfish dist/assets/index-*.js` must print 0.
- Look: match the existing game pages (`games.css`, `.g-page`, the Don't Laugh and On The Spot screens). Solid blocks, no glass, each player's own colour on their name/face.

## 5. Verification (all of it, before reporting)
- `npm run build` passes; the pearlfish grep prints 0.
- `games7-check.sql` aborts on purpose with every test passing; then `games7.sql` applied.
- `npm run dev` (port 5188), then `PW_CHANNEL=chrome node scripts/qa-zoom-said.mjs`: three fake people. Zoom In: two film (typed answer, 5 s clip), the third is a Notes-mode phone that joins as a guesser; the answer is not in any polo's effects or the chat payload of someone who hasn't guessed; "I know it" stops the zoom; a guess and Yes scores by the third rule; wrong guesses show to others only after they've done that clip; game ends and the end screen shows answers and guesses. Who Said It: three people, one in Notes mode; each writes 2 answers; prompts about others are skipped for matching (3 people), each matches the answers about themselves; scores and fooled points add up; end screen shows every prompt with authors. Also: the dock shows both games and marks "your go" correctly; the old suites still pass: `qa-rounds.mjs`, `qa-polish.mjs`, `qa-play.mjs`.
- Screenshots in `shots/zoom-said/`: zoom recorder with target, zoom guess mid pull-out, zoom reveal with others' guesses, zoom end, said write screen, said matching board, said reveal, said end. Look at every one yourself and fix what looks off.
- Clean the QA people (batched cleaner above).
- Checks JSON (all true when you report):
```json
{ "build_passes": true, "no_games_in_first_download": true, "check_sql_aborts_clean": true, "games7_applied": true, "zoom_answer_hidden_until_guessed": true, "zoom_guesser_without_camera": true, "said_works_without_camera": true, "said_scores_and_fooled_add_up": true, "dock_counts_both": true, "old_suites_pass": true, "qa_people_cleaned": true, "committed_on_branch": true }
```

## 6. Report format (fixed)
```
STATUS: done | partial | blocked
BRANCH + COMMIT: <sha>
FILES TOUCHED: <paths>
WHAT CHANGED: <three to six lines, plain words>
CHECKS: <the JSON above, filled in>
SCREENSHOTS: <paths>
VERIFIED vs BELIEVED: <one line each>
OPEN / BLOCKED: <anything you could not do, and why>
```
