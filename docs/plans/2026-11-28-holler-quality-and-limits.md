# Holler: sharper camera, 16 looks, and the per-chat limit (2026-11-28)

Brief this came from: `~/.claude/next-sessions/2026-11-27-holler-quality-and-limits-START-HERE.md`.

## 1. Camera: one picture size, 720 wide (LIVE)

What was measured, with a real face clip fed to the fake camera (`scripts/measure.mjs`, page `scripts/measure.html`)
and with what real phones had already written (`supabase/limits-survey.sql`, section `rates`):

| Recorder | Asked for | Got | With sound, a minute is |
| --- | --- | --- | --- |
| Chrome, 720x1280 | 1,500 kbps | 1,502 kbps, steady 30 fps | 11.7 MB |
| Safari engine (WebKit), 720x1280 | 600 / 800 / 1,000 / 1,200 / 1,500 kbps | 1,006 / 1,393 / 1,783 / 2,085 / 2,605 kbps total | 7.6 / 10.5 / 13.4 / 15.6 / 19.5 MB |
| Real iPhones, the old 540x960 | 900 kbps | 1,386 average, 1,640 peak (27 hollers) | 10.4 MB |

So Safari and every iPhone browser write about 1.7 times what they are asked for; Chrome writes what it is asked
for. Side by side on the face, nothing above a real 1.4 to 1.5 Mbps looked better at 720 wide.

Decisions (in `src/lib/studio.ts`, top):
- `TARGET_BITS = 1_500_000` is what should land in the file. WebKit is asked for `TARGET / 1.7` (about 882 kbps).
  An iPhone minute is therefore about the same size as before (roughly 11 to 12 MB) but 720 wide instead of 540.
- No lower tier and no HD switch. Simple camera is still the fallback for a phone that cannot keep up.
- `MAX_SEC = 180`: 3 minutes is about 35 MB, and still under 50 MB on a phone at its measured worst. The old
  5-minute cap could never have sent from an iPhone (5 minutes at the real rate is 52 to 61 MB).
- `MAX_BYTES = 46 MB`: a take ends itself early if a recorder ever runs hotter than that.
- Reaction clips (Film my reaction, Don't Laugh, the reveal) still ask for 500 kbps; untouched.

To re-check later: run `limits-survey.sql` and read `rates` (kbps by picture width). If an iOS update changes how
far Safari runs over, `RUNS_OVER` in studio.ts is the one number to change.

## 2. Looks: 37 cut to 16 (LIVE)

Every look was shot on a real face through the app's own camera code (`scripts/look-sheet.mjs <face.y4m> <outDir>`;
`FACE=x,y` puts the warps on the face). Sheet shown to Dixon: `shots/looks-keep-and-cut.jpg`.

Kept: Natural, Golden hour, Movie, Noir, VHS · Big head, Tiny face, Twins · Comic dots, Neon lines, Pencil,
Riso print, Heat vision · Blur behind, Spotlight, Sunset wall. The Motion group is gone.

Two cheap quality fixes: Blur behind no longer smears the person into a glow round their own head (samples that
land on you barely count), and Twins folds back at the picture's edge instead of smearing the last column.
A saved default look or an old holler naming a look that is gone falls back to Natural (`lookId()` in looks.ts).

## 3. Per-chat limit (BUILT, OFF, waits for Dixon's yes)

The rule and every setting are written at the top of `supabase/limits.sql`. In short: each chat keeps its newest
12 minutes of video and voice; what falls past that is marked leaving for 3 days (one ping per chat per daily
batch, a bar at the top of the chat that opens a list with one button each: Save to camera roll); then it is
taken out; its file is deleted a day later; hidden game clips go with no notice. Notes never count.

Files:
- `supabase/limits.sql` the columns, `holler.limit_run(scope)`, and the chat read (`leavesAt`, `leaving`, `keepSeconds`).
- `supabase/limits-check.sql` dry run of the above plus `limits-tests.sql` (built by `scripts/build-limits-check.sh`);
  it ends by reporting what the real run would do today, and keeps nothing.
- `supabase/limits-on.sql` THE SWITCH: sets `limit_on = '1'` and schedules the daily run (17:00 UTC). Dixon's yes only.
- `supabase/limits-off.sql` off again, and clears every leaving mark. `supabase/limits-undo.sql` puts back what
  was taken out while its file still exists (the 24-hour hold).
- `supabase/limits-status.sql` read-only: switch, numbers, storage used, minutes per chat, last runs.
- `supabase/limits-qa-mark.sql`, `limits-qa-due.sql` and `scripts/qa-limit.mjs`: the end-to-end test. It can only
  reach chats named exactly `ZZ limit test` whose every member is a QA person.
- App: `src/ui/Leaving.tsx` (bar and sheet), `src/lib/keep.ts` (share sheet on a phone, download elsewhere),
  badge on leaving tiles in `Thread.tsx`, the chat-info line in `ChatInfo.tsx`.

Storage sums (11-28): the `holler` bucket held about 199 MB; nothing else in the project's 1 GB is big. A full
chat (12 to 15 minutes at about 12 MB a minute) is 145 to 180 MB, plus whatever is waiting out its 3 days and
1-day hold. So 1 GB holds about five full chats. More chats than that means a smaller number than 12.

Open with Dixon (see the status file): the numbers (12 minutes, 3 days, the 24-hour hold, noon Eastern), the
wording of the ping, bar and sheet, and whether Saved follows the same rule (`limit_saved_same`, default yes).
When the switch goes on these lines stop being true and need his words: Saved's "even years from now", the
player's "Saved forever", and the games' "Saved, so these clips stay".
