# Paint Touches

An iPad web app (PWA) for tracking basketball paint touches and possession efficiency, built for and used by one coach — Dusan — on the sideline during live games.

**Live:** https://coachdusan.github.io/paint-touches/ · **Deploy:** push to `main` (GitHub Pages)

## Who this is for

Dusan is a basketball coach with no coding background who directs this project as its architect: he makes the product decisions, I implement them. **Explain everything in plain English** — name a technical concept, then immediately give the everyday version and why it matters to him. Present choices as trade-offs he will experience, not as implementation detail.

## Non-negotiable rules

These encode decisions that are easy to break by accident and expensive to discover later.

1. **Bump `CACHE_VERSION` in `service-worker.js` on every deploy that changes an app file.** The fetch handler is cache-first, so installed iPads serve the old code forever otherwise. This is the single most common way a shipped change fails to reach the user.
2. **Add new files to `PRECACHE_URLS`** in `service-worker.js`, or the app breaks offline — which is the one condition it exists for.
3. **Never invent per-player scoring or blame stats.** We record *every player who touched the paint*, and never who shot, scored, or lost the ball. Per-player columns therefore mean "possessions this player touched that ended in X" — label them that way. Deliberate design decision, not a gap to fill.
4. **Roster and Playbook entries are soft-archived, not deleted**, and possessions store name snapshots at write time. Mid-season roster changes must never alter a past game's numbers. The one exception is the explicit "delete all archived permanently" button — safe precisely because of those snapshots, and never something to do automatically.
5. **Restore replaces, never merges.** Merging two copies of a season silently doubles every stat. `parseBackup()` refuses anything it can't fully vouch for rather than half-applying it.
6. **`pointsForOutcome()` runs once**, when a possession closes, and the result is stored on the record. Nothing recomputes points later, so live and historical stats can never disagree.
7. **A foul is a trip, not a possession.** Every stat bucket carries both
   `trips` (everything tapped) and `possessions` (what ended a trip down the
   floor). `endsPossession()` is the only place that distinction is defined,
   and PPP — every PPP — divides by `possessions`. Counting a foul as a
   0-point possession would punish an offense for drawing fouls and flatter a
   defense for committing them. Counts of *how often something happened*
   (breakdowns, coverage calls) read `trips`, so a breakdown that ended in a
   foul is still a breakdown. If it sent someone to the line, that trip is
   logged as FT instead, which is where the points come from.
8. **Tap buttons never reorder themselves during a game.** The player/play grids are ordered by an explicit setting (`js/sort.js`), and it only changes when the coach changes it. A button that moves under a thumb mid-possession is a mis-tap, and a mis-tap is a wrong number in a real game.

## Architecture, and why

Vanilla HTML/CSS/ES modules. **No build step, no npm, no framework, no bundler** — deliberately, so that "push to GitHub" *is* "deploy." There is nothing for a non-technical user to install, run, or forget.

- `js/db.js` — IndexedDB (`paint-touches`) via vendored `idb`; stores: players, plays, games, possessions
- `js/models.js` — `Players`/`Plays` (soft-archive), `Games`, `Possessions`; `TRANSITION_PLAY` is a constant, not a DB row
- `js/possession.js` — outcome vocabulary, point values, quarters, FT combos
- `js/stats.js` — `computeStats()` (offense) and `computeDefenseStats()` (defense). **Both filter by `side` first.** Defensive possessions carry points *allowed* in the same `points` field, so any stat function that forgets the filter silently blends both teams' scoring
- `js/views/stats-panel.js` / `defense-stats-panel.js` / `game-stats.js` — shared renderers behind one Offense/Defense switch, so live and History markup can't drift
- `js/views/live-tracking.js` — the sideline screen: touches → outcome, with and-1 and FT sub-flows
- **Possessions vs. tag events.** A possession is a trip down the floor that ends in an outcome. A *quick tag* (e.g. "Lazy box-out") is an observation with no outcome and no PPP — its own `tagEvents` store, one record per player per occurrence. Don't force observations into the possession shape; anything deleting a game must delete both, which is why every deletion path — one game or all of history — goes through `purgeGames()` in `models.js` and its single all-or-nothing transaction
- `js/sort.js` — two different sorts that deliberately behave in opposite ways. The **list sort** (roster, plays, coverages) is a setting: it decides the order of the tap targets and is frozen until changed, per rule 7. The **table sort** (tap a stats column header) is the opposite — it *must* survive new data, because the live panel is rebuilt after every possession and a column you sorted by has to come back sorted with the new numbers in it. Both live in `localStorage`, not IndexedDB: they're per-iPad display settings and have no business travelling inside a backup file
- `js/export.js` — pure string builders (summary / CSV / backup JSON) with no delivery logic, so they can be read and tested directly
- `js/share.js` — the delivery side. Standalone mode has no Safari toolbar, so share and print must be triggered from in-app buttons; each route steps down share sheet → clipboard → on-screen text
- `vendor/idb.js` — vendored via curl, not npm

**Sorting breakdowns by coverage.** The Mistakes list has a third sort the
other lists don't: `coverage`. A breakdown stores the *ids* of the coverages
it's assigned to, and ids have no order, so this is the one sort that can't
be computed from the record alone — `sortEntities()` takes an optional
context and `archivableList` fetches the coverage list to build it, but only
when that sort is actually turned on, so the other four lists never pay for
the extra read. Breakdowns rank by the first coverage they're assigned to,
in whatever order the Coverages list is currently set to, and keep typed
order inside each group. Anything assigned to no coverage (or only to
archived ones) applies everywhere and can't sit inside a group, so it sinks
to the bottom — the same rule as a player with no jersey number. Because
this is the list sort, it also reorders the in-game breakdown buttons: with
it on, the ones assigned to the coverage you called come first.

**Outcome colours are by event, not by good news.** Green always means the
ball went in, on either side of the ball — so on defense the green button is
the one you *didn't* want. That is deliberate: the tap keeps the same place
and the same colour whichever bench is being tracked, and switching sides
never costs a beat. `OUTCOME_TONES` in `possession.js` is the single source;
CSS only paints what it names. Green = made, red = missed, blue = foul,
purple = turnover, yellow = free throws.

**Hand-arranged order (`custom`).** The one list sort whose data lives in
IndexedDB rather than `localStorage`. `position` is written onto each record
by `reorder()` in `models.js`, because an arrangement is work the coach did —
it belongs in a backup and has to survive being restored onto another iPad —
whereas *which* sort is switched on stays a per-iPad display setting. Entering
Reorder mode seeds `position` from the currently visible order and flips the
sort to `custom`; without that flip, nudging a row under A–Z would appear to
do nothing, because A–Z would re-sort it straight back. A record with no
`position` sorts below every record that has one, which is what puts a newly
added play at the bottom of the arrangement instead of somewhere random in
the middle of it.

**Sorting defaults, and why they differ.** The roster reads by jersey number, like a scorebook. Everything else keeps the order it was typed in, because those lists are short, hand-ordered by the coach, and their button positions are already muscle memory — alphabetising them by default would silently rearrange a sideline the coach had already learned. Sorting by *activity* (most-touched player floats to the top) was considered and rejected for the same reason. The stats tables read the rendered cell text rather than the raw stats, which is what lets every table be sortable without each caller describing its own columns; it holds only because those cells are plain text.

**Data model.** The unit is a *possession*: tap every player who touches the ball in the paint (repeat taps allowed, zero touches is valid and must count), then one outcome to close it — 2PM, 2PA, 3PM, 3PA, FT, TO. Made shots can attach an and-1 free throw to the same possession. PPP is the headline stat.

## Verifying changes

**Run `python3 tests/run_all.py` before shipping anything** — fourteen suites, ~305 assertions, about two and a half minutes. See `tests/README.md` for what each covers and how to add more.

There is no test framework and no Node here, so these drive a real browser (Playwright via `pip3`, not Homebrew) against a real local server. They cover the things unit tests would miss: database upgrades that must not eat existing games, stats that must not blend both teams' points, and offline behaviour tested by actually severing the network. Re-verify against the live URL after deploying.

Environment has **no** Node/npm, Homebrew, ImageMagick/PIL, or `timeout`. Icons were generated by a raw Python zlib/struct script; use polling loops instead of `timeout`.

## Gotcha

This repo sits inside an outer duplicate folder (`paint-touches/paint-touches/`). The inner directory is the real working tree. Confirm which directory a git command ran in before trusting its output.
