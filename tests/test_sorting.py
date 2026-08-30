"""Sorting: the order of the tap buttons, and the order of stats rows.

Two separate promises are under test here.

1. The list sort is a *setting*. Chosen on the Roster screen, it decides the
   order of the player buttons during a game, and it must not move on its
   own — a button that relocates mid-possession is a mis-tap.

2. The table sort must survive new data. The live stats panel is rebuilt
   after every possession, so a column you sorted by has to come back sorted
   the same way with the new numbers folded in. That's the whole request.
"""

import subprocess, time, urllib.request
from playwright.sync_api import sync_playwright

import os, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(tempfile.gettempdir(), "paint-touches-tests") + os.sep
os.makedirs(OUT, exist_ok=True)

PORT = 8791
results = []

def check(label, got, want):
    ok = got == want
    results.append(ok)
    print(("PASS  " if ok else "FAIL  ") + f"{label}: got {got!r}, want {want!r}")

srv = subprocess.Popen(["python3","-m","http.server",str(PORT)], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(40):
    try: urllib.request.urlopen(f"http://localhost:{PORT}/index.html", timeout=1); break
    except Exception: time.sleep(0.25)

# Deliberately adversarial roster: added in an order that is neither jersey
# order nor alphabetical, with a two-digit number that would sort wrongly if
# anyone compared numbers as text ("9" > "12"), and one player with no
# number at all.
SEED = """
() => new Promise((resolve, reject) => {
  const req = indexedDB.open("paint-touches", 3);
  req.onupgradeneeded = (e) => {
    const db = e.target.result;
    ["players","plays","games","coverages","mistakes","quickTags"].forEach(n => {
      if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, { keyPath:"id" });
    });
    if (!db.objectStoreNames.contains("possessions")) {
      db.createObjectStore("possessions", { keyPath:"id" }).createIndex("by-game","gameId");
    }
    if (!db.objectStoreNames.contains("tagEvents")) {
      db.createObjectStore("tagEvents", { keyPath:"id" }).createIndex("by-game","gameId");
    }
  };
  req.onerror = () => reject(req.error);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction(["players","plays","coverages","mistakes"], "readwrite");
    const players = tx.objectStore("players");
    players.put({ id:"p1", name:"Zoran", number:"12", archived:false, createdAt:1 });
    players.put({ id:"p2", name:"Ana",   number:"9",  archived:false, createdAt:2 });
    players.put({ id:"p3", name:"Marko", number:"4",  archived:false, createdAt:3 });
    players.put({ id:"p4", name:"Bojan", number:"",   archived:false, createdAt:4 });
    const plays = tx.objectStore("plays");
    plays.put({ id:"y1", name:"Zipper", archived:false, createdAt:1 });
    plays.put({ id:"y2", name:"Horns",  archived:false, createdAt:2 });
    // Coverages and breakdowns, planted rather than left to the app's own
    // defaults: the defaults are assigned to no coverage at all, which is
    // exactly the case the Coverage sort has nothing to say about.
    const cov = tx.objectStore("coverages");
    cov.put({ id:"c1", name:"Drop",   archived:false, createdAt:1 });
    cov.put({ id:"c2", name:"Switch", archived:false, createdAt:2 });
    const mis = tx.objectStore("mistakes");
    mis.put({ id:"m1", name:"Foul",         archived:false, createdAt:1 });
    mis.put({ id:"m2", name:"Went under",   archived:false, createdAt:2, coverageIds:["c2"] });
    mis.put({ id:"m3", name:"Big late",     archived:false, createdAt:3, coverageIds:["c1"] });
    mis.put({ id:"m4", name:"No tag",       archived:false, createdAt:4, coverageIds:["c1","c2"] });
    tx.oncomplete = () => { db.close(); resolve(true); };
    tx.onerror = () => reject(tx.error);
  };
})
"""

ROW_LABELS = "[...document.querySelectorAll('.entity-list .list-row__main')].map(r=>r.textContent.trim())"
# The mistakes rows carry coverage pills after the name, so read just the
# first span — the name — rather than the whole row.
ROW_NAMES = ("[...document.querySelectorAll('.entity-list .list-row__main')]"
             ".map(r=>(r.querySelector('span')||r).textContent.trim())")
CHIP_LABELS = """(label) => {
  const card = [...document.querySelectorAll('.card')]
    .find(c => c.querySelector('.section-label')?.textContent.includes(label));
  return card ? [...card.querySelectorAll('.chip')].map(c => c.textContent.trim()) : null;
}"""
TILE_LABELS = "[...document.querySelectorAll('.player-grid .player-tile')].map(t=>t.textContent.trim())"
# Playwright's :has-text() only works in its own selectors, not in
# querySelectorAll, so finding a card by its heading is done in plain JS.
CARD_ROWS = """(label) => {
  const card = [...document.querySelectorAll('.stats-panel .card')]
    .find(c => c.querySelector('.section-label')?.textContent.includes(label));
  if (!card) return null;
  return [...card.querySelectorAll('tbody tr')].map(r => [...r.children].map(c => c.textContent.trim()));
}"""

SORTED_ARROW = """(label) => {
  const card = [...document.querySelectorAll('.stats-panel .card')]
    .find(c => c.querySelector('.section-label')?.textContent.includes(label));
  const th = card.querySelector('th.is-sorted');
  return th ? th.querySelector('.sort-arrow').textContent : null;
}"""

with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width":1024,"height":768}, device_scale_factor=2)
    page = ctx.new_page()
    errs = []
    page.on("console", lambda m: errs.append(m.text) if m.type=="error" else None)
    page.on("dialog", lambda d: d.accept())

    page.route("**/js/app.js", lambda route: route.abort())
    page.goto(f"http://localhost:{PORT}/index.html")
    check("planted a roster", page.evaluate(SEED), True)
    page.unroute("**/js/app.js")
    page.goto(f"http://localhost:{PORT}/index.html", wait_until="networkidle")
    errs.clear()
    page.wait_for_timeout(900)

    # ---- 1. Roster defaults to jersey order -------------------------------
    page.click('.tab-bar button[data-view="roster"]'); page.wait_for_timeout(500)
    check("roster sorts by number, not by when they were added",
          page.evaluate(ROW_LABELS),
          ["#4  Marko", "#9  Ana", "#12  Zoran", "#--  Bojan"])
    check("the # option is the one showing as active",
          page.text_content('.sort-bar .segmented__btn.is-active'), "#")
    page.screenshot(path=OUT+"sort-roster-number.png", full_page=True)

    # ---- 2. Switching the sort re-orders it -------------------------------
    page.click('.sort-bar .segmented__btn[data-sort="name"]'); page.wait_for_timeout(500)
    check("A–Z re-orders the roster",
          page.evaluate(ROW_LABELS),
          ["#9  Ana", "#--  Bojan", "#4  Marko", "#12  Zoran"])
    page.click('.sort-bar .segmented__btn[data-sort="added"]'); page.wait_for_timeout(500)
    check("Added gives back the order they were typed in",
          page.evaluate(ROW_LABELS),
          ["#12  Zoran", "#9  Ana", "#4  Marko", "#--  Bojan"])

    # ---- 3. The setting survives a reload and reaches the game screen -----
    page.click('.sort-bar .segmented__btn[data-sort="number"]'); page.wait_for_timeout(400)
    page.reload(wait_until="networkidle"); page.wait_for_timeout(900)
    page.click('.tab-bar button[data-view="roster"]'); page.wait_for_timeout(500)
    check("the choice is remembered after closing the app",
          page.evaluate(ROW_LABELS),
          ["#4  Marko", "#9  Ana", "#12  Zoran", "#--  Bojan"])

    page.click('.tab-bar button[data-view="game"]'); page.wait_for_timeout(400)
    page.fill('[name="opponent"]', "Sorting HS")
    page.click('button:has-text("Start Game")'); page.wait_for_timeout(800)
    check("player buttons follow the roster order",
          page.evaluate(TILE_LABELS),
          ["#4Marko", "#9Ana", "#12Zoran", "#--Bojan"])
    page.screenshot(path=OUT+"sort-game-tiles.png", full_page=True)

    # ---- 4. Buttons must not move while a possession is open --------------
    before = page.evaluate(TILE_LABELS)
    page.click('.player-grid .player-tile:has-text("Zoran")'); page.wait_for_timeout(300)
    page.click('.player-grid .player-tile:has-text("Zoran")'); page.wait_for_timeout(300)
    check("tapping a player does not reorder the buttons under your thumb",
          page.evaluate(TILE_LABELS), before)

    # Close it, then log a second possession touched only by Marko.
    # A made two asks about the and-1 before it closes.
    page.click('button:has-text("2PT Made")'); page.wait_for_timeout(400)
    page.click('.outcome-sheet button:has-text("Skip")'); page.wait_for_timeout(600)
    check("buttons still in the same places after a possession",
          page.evaluate(TILE_LABELS), before)
    page.click('.player-grid .player-tile:has-text("Marko")'); page.wait_for_timeout(300)
    page.click('button:has-text("Turnover")'); page.wait_for_timeout(600)

    # ---- 5. Stats tables sort by a tapped column --------------------------
    page.click('button:has-text("Stats")'); page.wait_for_timeout(700)
    by_player = '.card:has-text("By player (paint touches)")'
    check("by-player table defaults to most touches first",
          [r[0] for r in page.evaluate(CARD_ROWS, "By player")],
          ["#12 Zoran", "#4 Marko"])

    # Player is a name column, so it opens A–Z rather than biggest-first.
    page.click(f'{by_player} .sort-th:has-text("Player")'); page.wait_for_timeout(400)
    check("tapping Player sorts by name",
          [r[0] for r in page.evaluate(CARD_ROWS, "By player")],
          ["#4 Marko", "#12 Zoran"])
    check("the sorted column is marked", page.evaluate(SORTED_ARROW, "By player"), "\u2191")

    page.click(f'{by_player} .sort-th:has-text("Player")'); page.wait_for_timeout(400)
    check("tapping again reverses it",
          [r[0] for r in page.evaluate(CARD_ROWS, "By player")],
          ["#12 Zoran", "#4 Marko"])

    page.click(f'{by_player} .sort-th:has-text("Player")'); page.wait_for_timeout(400)
    check("a third tap goes back to the app's own order",
          page.evaluate(SORTED_ARROW, "By player"), None)

    # ---- 6. The chosen column survives new possessions --------------------
    # This is the "re-sort with new inputs" case: sort by Touches fewest-first,
    # then log a possession that changes who belongs at the bottom of it.
    page.click(f'{by_player} .sort-th:has-text("Touches")'); page.wait_for_timeout(400)
    page.click(f'{by_player} .sort-th:has-text("Touches")'); page.wait_for_timeout(400)
    check("Touches sorted fewest-first",
          [(r[0], r[1]) for r in page.evaluate(CARD_ROWS, "By player")],
          [("#4 Marko", "1"), ("#12 Zoran", "2")])

    page.click('button:has-text("Hide Stats")'); page.wait_for_timeout(400)
    # Three more touches for Marko — enough to overtake Zoran on that column.
    for _ in range(3):
        page.click('.player-grid .player-tile:has-text("Marko")'); page.wait_for_timeout(250)
    page.click('button:has-text("2PT Made")'); page.wait_for_timeout(400)
    page.click('.outcome-sheet button:has-text("Skip")'); page.wait_for_timeout(600)
    page.click('button:has-text("Stats")'); page.wait_for_timeout(700)

    check("the column stayed sorted, and the new numbers moved the rows",
          [(r[0], r[1]) for r in page.evaluate(CARD_ROWS, "By player")],
          [("#12 Zoran", "2"), ("#4 Marko", "4")])
    check("the column is still marked as the sorted one",
          page.evaluate(SORTED_ARROW, "By player"), "\u2191")
    page.evaluate("""() => {
      const card = [...document.querySelectorAll('.stats-panel .card')]
        .find(c => c.querySelector('.section-label')?.textContent.includes('By player'));
      card.scrollIntoView();
    }""")
    page.wait_for_timeout(300)
    page.screenshot(path=OUT+"sort-stats-column.png")

    # ---- 7. Playbook lists sort too, and default to typed order ----------
    page.click('button:has-text("Hide Stats")'); page.wait_for_timeout(300)
    page.click('.tab-bar button[data-view="playbook"]'); page.wait_for_timeout(600)
    check("plays keep the order they were typed in by default",
          page.evaluate(ROW_LABELS), ["Zipper", "Horns"])
    check("plays are not offered a number sort — they have no numbers",
          page.evaluate("[...document.querySelectorAll('.sort-bar .segmented__btn')].map(b=>b.getAttribute('data-sort'))"),
          ["added", "name", "custom"])
    page.click('.sort-bar .segmented__btn[data-sort="name"]'); page.wait_for_timeout(500)
    check("plays sort A–Z on request", page.evaluate(ROW_LABELS), ["Horns", "Zipper"])

    # ---- 8. Breakdowns can be grouped by the coverage they belong to -----
    # This is the third sort, offered on the Mistakes list only: a breakdown
    # belongs to a coverage, so it can read in coverage order instead of
    # typed order. Anything assigned to no coverage applies everywhere and
    # can't sit inside a group, so it sinks to the bottom.
    page.click('.segmented__btn[data-section="mistakes"]'); page.wait_for_timeout(600)
    check("breakdowns keep typed order by default",
          page.evaluate(ROW_NAMES),
          ["Foul", "Went under", "Big late", "No tag"])
    check("only the Mistakes list offers a Coverage sort",
          page.evaluate("[...document.querySelectorAll('.sort-bar .segmented__btn')].map(b=>b.getAttribute('data-sort'))"),
          ["added", "name", "coverage", "custom"])

    page.click('.sort-bar .segmented__btn[data-sort="coverage"]'); page.wait_for_timeout(600)
    check("Coverage groups them: Drop's, then Switch's, then the any-coverage ones",
          page.evaluate(ROW_NAMES),
          ["Big late", "No tag", "Went under", "Foul"])
    page.screenshot(path=OUT+"sort-mistakes-coverage.png", full_page=True)

    page.reload(wait_until="networkidle"); page.wait_for_timeout(900)
    page.click('.tab-bar button[data-view="playbook"]'); page.wait_for_timeout(600)
    page.click('.segmented__btn[data-section="mistakes"]'); page.wait_for_timeout(600)
    check("the Coverage choice is remembered after closing the app",
          page.evaluate(ROW_NAMES),
          ["Big late", "No tag", "Went under", "Foul"])

    # ---- 9. And it reaches the buttons you tap during a game -------------
    page.click('.tab-bar button[data-view="game"]'); page.wait_for_timeout(700)
    page.click('.side-toggle .segmented__btn[data-side="defense"]'); page.wait_for_timeout(500)
    page.click('.chip-grid .chip:has-text("Drop")'); page.wait_for_timeout(500)
    check("in-game breakdown buttons lead with the ones assigned to Drop",
          page.evaluate(CHIP_LABELS, "What broke down?"),
          ["No mistake", "Big late", "No tag", "Foul"])

    check("no console errors", errs, [])
    b.close()
srv.terminate()
print("\n" + ("ALL PASS" if all(results) else f"{results.count(False)} FAILED"))
