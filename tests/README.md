# Tests

There is no test framework and no Node in this project. These drive a **real
browser** against a **real local server**, asserting on the DOM the app
actually produces and on what ends up in IndexedDB — because the bugs worth
catching here are ones a unit test would miss: a database upgrade that eats
old games, a stat that silently blends both teams' points, a screen that
works until the network is cut.

## Running them

```bash
python3 tests/run_all.py            # every suite
python3 tests/run_all.py season     # just the ones matching "season"
python3 tests/test_export.py        # one suite directly
```

Each suite starts its own `http.server` on its own port and closes it again,
so they don't collide. Screenshots and scratch files go to a temp directory,
never into the repo.

## One-time setup

```bash
pip3 install playwright
python3 -m playwright install chromium
```

If `playwright` isn't found afterwards, add pip's script directory to your
PATH — on this machine that's `~/Library/Python/3.9/bin`.

## What each suite covers

| Suite | Covers |
|---|---|
| `test_turnovers.py` | Turnover counting and TO rate across every offensive breakdown |
| `test_stage1.py` | **v1 → v2 database upgrade** with a real game planted first; coverage/mistake seeding; stable list ordering |
| `test_stage2.py` | Defensive tracking flow, and that defensive possessions **don't contaminate offensive PPP** |
| `test_stage3.py` | Defensive stats maths; the clean-vs-broken split; per-player caveat |
| `test_breakdowns.py` | Mistakes grouped under their coverage; which mistake each player made; the video clip list; **the live picker narrowing to the chosen coverage** |
| `test_tags.py` | **v2 → v3 upgrade**; quick tags; that tagging creates no possession; undo; no orphans after clearing history |
| `test_stage5.py` | Score, derived win/loss, venue; ending with and without a score; editing afterwards |
| `test_cleanup.py` | Deleting archived entries; clearing history; that a game **in progress survives** both |
| `test_season.py` | Season pooling; that PPP is pooled not averaged; **in-progress games excluded**; trends |
| `test_export.py` | Summary text, CSV quoting, backup validation, **full wipe-and-restore round trip**, share fallbacks |
| `test_offline.py` | Installs the service worker, **severs the network**, then logs a possession and reads its stats |

## Adding to them

The pattern each suite follows:

1. Start a server, open a page, collect console errors.
2. Optionally plant an older database version directly via `indexedDB.open`,
   to prove upgrades don't destroy existing data.
3. Drive the real UI, or import a module and call it (`page.evaluate` with a
   dynamic `import()`) to test stat maths without a UI.
4. `check(label, got, want)` for every assertion; print `ALL PASS` at the end —
   `run_all.py` looks for that string.

Two things worth knowing, both learned the hard way here:

- `textContent` on a table row concatenates cells with **no separator**, so
  read `row.children` individually rather than string-matching.
- Assert on scoped selectors, not the first match on the page. A test that
  grabbed "the first two chips" broke the day a new card appeared above —
  which was useful that time, and won't be next time.

## test_sorting.py

Sorting, both kinds of it.

**List sort** — the order of the tap buttons. Plants a roster added in an
order that is neither jersey nor alphabetical, including `#12` (which sorts
wrongly if anyone ever compares numbers as text) and a player with no number
at all. Checks the Roster defaults to jersey order, that switching the sort
re-orders it, that the choice survives a reload, and that the player buttons
on the game screen follow it.

The one that protects the sideline: **the buttons must not move on their
own.** Tapping a player and closing a possession must leave every tile
exactly where it was.

**Table sort** — tapping a stats column header. Checks the three-tap cycle
(sort → reverse → back to default) and, most importantly, that a sorted
column survives a new possession: the live panel rebuilds itself every time
one closes, and the table has to come back sorted the same way with the new
numbers folded in.
