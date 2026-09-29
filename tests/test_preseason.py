"""Preseason and season: one start date splits them, one switch decides what
the Season screen and the coach report include.

Two preseason games and the first game of the season, built so every number
can be checked by hand: the preseason offense scores 1.00 a possession and
allows 2.00; the season game scores 1.33 and allows nothing.
"""

import subprocess, time, urllib.request
from playwright.sync_api import sync_playwright

import os, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(tempfile.gettempdir(), "paint-touches-tests") + os.sep
os.makedirs(OUT, exist_ok=True)

PORT = 8802
results = []


def check(label, got, want):
    ok = got == want
    results.append(ok)
    print(("PASS  " if ok else "FAIL  ") + f"{label}: got {got!r}, want {want!r}")


srv = subprocess.Popen(["python3", "-m", "http.server", str(PORT)], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(40):
    try:
        urllib.request.urlopen(f"http://localhost:{PORT}/index.html", timeout=1)
        break
    except Exception:
        time.sleep(0.25)

SEED = """
() => new Promise((resolve, reject) => {
  const req = indexedDB.open("paint-touches", 3);
  req.onupgradeneeded = (e) => {
    const db = e.target.result;
    ["players","plays","games","coverages","mistakes","quickTags"].forEach(n =>
      db.createObjectStore(n, { keyPath:"id" }));
    db.createObjectStore("possessions", { keyPath:"id" }).createIndex("by-game","gameId");
    db.createObjectStore("tagEvents", { keyPath:"id" }).createIndex("by-game","gameId");
  };
  req.onerror = () => reject(req.error);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction(["games","possessions"], "readwrite");
    const G = tx.objectStore("games"), P = tx.objectStore("possessions");
    const game = (id, date, opponent, us, them, t) => G.put({ id, date, opponent, venue:"home",
      ourScore:us, theirScore:them, status:"completed", currentQuarter:"4", createdAt:t, completedAt:t + 1 });
    game("p1", "2026-08-20", "Alpha", 80, 70, 1);
    game("p2", "2026-08-29", "Beta", 70, 75, 3);
    game("s1", "2026-09-27", "Lokomotiv Kuban", 88, 80, 5);

    const HORNS = { playId:"py1", playName:"Horns" };
    const DROP = { coverageId:"c1", coverageName:"Drop" };
    const CLEAN = { mistakeId:"none", mistakeName:"No mistake" };
    let n = 0;
    const off = (g, outcome, points) => P.put({ id:"x" + n, gameId:g, quarter:"1", sequenceNumber:n++,
      side:"offense", play:HORNS, touches:[], outcome, points, andOne:null, ftAttempt:null });
    const def = (g, outcome, points) => P.put({ id:"x" + n, gameId:g, quarter:"1", sequenceNumber:n++,
      side:"defense", coverage:DROP, mistake:CLEAN, mistakePlayer:null, play:null, touches:[],
      outcome, points, andOne:null, ftAttempt:null });

    for (const g of ["p1", "p2"]) {
      for (let i = 0; i < 10; i++) { off(g, "2PM", 2); off(g, "2PA", 0); }
      for (let i = 0; i < 12; i++) def(g, "2PM", 2);
    }
    for (let i = 0; i < 20; i++) off("s1", "2PM", 2);
    for (let i = 0; i < 10; i++) off("s1", "2PA", 0);
    for (let i = 0; i < 25; i++) def("s1", "2PA", 0);

    tx.oncomplete = () => { db.close(); resolve(true); };
    tx.onerror = () => reject(tx.error);
  };
})
"""

PURE = """
() => import('/js/phase.js').then((m) => {
  const g = (id, date) => ({ id, date });
  const list = [g("a", "2026-08-01"), g("b", "2026-08-20"), g("c", "2026-09-27"), g("d", "2026-10-02")];
  const split = m.splitByPhase(list, "2026-09-27", (x) => x);
  const label = (game, earlier, start) => m.comparisonPool(game, earlier, start, (x) => x).label;
  return {
    boundary: [m.isPreseason(g("x", "2026-09-26"), "2026-09-27"), m.isPreseason(g("x", "2026-09-27"), "2026-09-27")],
    noStart: m.isPreseason(g("x", "2000-01-01"), null),
    split: [split.preseason.map((x) => x.id), split.season.map((x) => x.id)],
    firstSeasonGame: label(list[2], list.slice(0, 2), "2026-09-27"),
    secondSeasonGame: label(list[3], list.slice(0, 3), "2026-09-27"),
    preseasonGame: label(list[1], list.slice(0, 1), "2026-09-27"),
    noStartPool: label(list[3], list.slice(0, 3), null),
  };
})
"""

with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width": 1024, "height": 768}, device_scale_factor=2)
    page = ctx.new_page()
    errs = []
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(str(e)))

    page.route("**/js/app.js", lambda route: route.abort())
    page.goto(f"http://localhost:{PORT}/index.html")
    check("seeded two preseason games and the first season game", page.evaluate(SEED), True)

    # --- The rules, on their own -------------------------------------------
    r = page.evaluate(PURE)
    check("the day before the start is preseason, the start day is season", r["boundary"], [True, False])
    check("with no start date nothing is preseason", r["noStart"], False)
    check("split by the start date", r["split"], [["a", "b"], ["c", "d"]])
    check("first season game is set against the preseason", r["firstSeasonGame"], "Preseason, 2 games")
    check("later season games against the season only", r["secondSeasonGame"], "Previous 1 game of the season")
    check("a preseason game against earlier preseason", r["preseasonGame"], "Previous 1 game of preseason")
    check("no start date: every earlier game, as before", r["noStartPool"], "Previous 3 games")

    page.unroute("**/js/app.js")
    page.goto(f"http://localhost:{PORT}/index.html", wait_until="networkidle")
    errs.clear()  # the deliberately blocked first load
    page.wait_for_timeout(900)

    def tile(label, scope=".screen"):
        return page.evaluate("""([l,s])=>{const t=[...document.querySelectorAll(s+' .stat-tile')]
          .find(x=>x.querySelector('.stat-tile__label').textContent.trim().toLowerCase()===l.toLowerCase());
          return t?t.querySelector('.stat-tile__value').textContent.trim():null;}""", [label, scope])

    def table_after(title):
        return page.evaluate("""(t)=>{const c=[...document.querySelectorAll('.card')].find(c=>{
            const l=c.querySelector('.section-label'); return l && l.textContent.trim()===t;});
          if(!c) return null;
          return {head:[...c.querySelectorAll('thead th')].map(x=>x.textContent.trim()),
                  rows:[...c.querySelectorAll('tbody tr')].map(r=>[...r.children].map(td=>({t:td.textContent.trim(),
                    good:td.classList.contains('tone-good')})))};}""", title)

    def open_season():
        page.click('.tab-bar__btn[data-view=season]')
        page.wait_for_timeout(800)

    def set_scope(key):
        page.click(f'.season-scope [data-scope={key}]')
        page.wait_for_timeout(800)

    def open_report():
        page.click("text=Open the coach report")
        page.wait_for_timeout(1000)

    # --- Before a start date: everything counts together, as it always did --
    open_season()
    check("no switch until a start date is set", page.evaluate("!!document.querySelector('.season-scope')"), False)
    check("every game counts", tile("Games"), "3")

    # --- Set the start date: the Lokomotiv Kuban game ------------------------
    page.fill('input[name="season-start"]', "2026-09-27")
    page.dispatch_event('input[name="season-start"]', "change")
    page.wait_for_timeout(800)
    check("switch appears, three ways",
          page.evaluate("[...document.querySelectorAll('.season-scope .segmented__btn')].map(b=>b.textContent)"),
          ["Season only", "Season + preseason", "Season vs preseason"])
    check("season only is the starting choice",
          page.evaluate("document.querySelector('.season-scope .is-active').dataset.scope"), "season")
    check("counts shown", "2 games of preseason, 1 game of the season" in page.text_content(".screen"), True)
    check("season only: one game", tile("Games"), "1")
    check("season only: the season's PPP", tile("PPP", ".stats-panel"), "1.33")
    page.screenshot(path=OUT + "preseason-season.png", full_page=True)

    # The report, season only: one game, measured against the preseason.
    open_report()
    check("report says what it covers", "Season only" in page.text_content(".report-head"), True)
    check("report is the one season game", tile("Offense PPP"), "1.33")
    first = table_after("Against the preseason — first game of the season")
    check("first season game set against the preseason",
          first and first["head"][1:3], ["Preseason, 2 games", "Lokomotiv Kuban"])
    check("no season-vs-preseason section in season only",
          "Season vs preseason" in page.text_content(".screen"), False)
    page.click("text=← Season"); page.wait_for_timeout(800)

    # --- Season + preseason --------------------------------------------------
    set_scope("all")
    check("remembered and active",
          page.evaluate("document.querySelector('.season-scope .is-active').dataset.scope"), "all")
    check("all: three games", tile("Games"), "3")
    check("all: pooled PPP", tile("PPP", ".stats-panel"), "1.14")
    trend = page.evaluate("""[...document.querySelectorAll('.card')].filter(c=>c.textContent.includes('Trend over the season'))
        .map(c=>[...c.querySelectorAll('tbody tr')].map(r=>r.children[0].textContent.trim()))[0]""")
    check("trend marks the preseason games", trend,
          ["Pre · Aug 20, 2026 · Alpha", "Pre · Aug 29, 2026 · Beta", "Sep 27, 2026 · Lokomotiv Kuban"])
    open_report()
    check("all: report covers three games", tile("Offense PPP"), "1.14")
    every = table_after("Against every game before it")
    check("all: last game against every game before it", every and every["head"][1], "Previous 2 games")
    page.click("text=← Season"); page.wait_for_timeout(800)

    # --- Season vs preseason -------------------------------------------------
    set_scope("compare")
    check("compare: two records",
          [x in page.text_content(".screen") for x in ("Record — season", "Record — preseason")], [True, True])
    check("compare: two sets of totals",
          [x in page.text_content(".screen") for x in ("Season totals", "Preseason totals")], [True, True])
    open_report()
    key = table_after("Key numbers")
    check("compare: columns", key and key["head"], ["", "Preseason · 2 games", "Season · 1 game", "Change"])
    ppp = next(r for r in key["rows"] if r[0]["t"] == "Offense PPP")
    check("compare: offense PPP side by side", [c["t"] for c in ppp], ["Offense PPP", "1.00", "1.33", "+0.33"])
    check("compare: enough on both sides, so it is coloured", ppp[3]["good"], True)
    allowed = next(r for r in key["rows"] if r[0]["t"] == "PnR PPP allowed")
    check("compare: fewer points allowed is the good direction",
          [allowed[3]["t"], allowed[3]["good"]], ["-2.00", True])
    broke = next(r for r in key["rows"] if r[0]["t"] == "PPP allowed on a breakdown")
    check("compare: nothing to compare stays a dash", broke[3]["t"], "—")
    read = page.evaluate("""[...document.querySelectorAll('.card')].find(c=>c.querySelector('.section-label')
        && c.querySelector('.section-label').textContent==='The read' && c.textContent.includes('preseason'))
        .querySelector('.report-read').textContent""")
    check("compare: the read says it plainly",
          "The offense is better than in the preseason: 1.33 against 1.00." in read, True)
    plays = table_after("By play")
    horns = next(r for r in plays["rows"] if r[0]["t"] == "Horns")
    check("compare: Horns side by side",
          [c["t"] for c in horns], ["Horns", "40", "1.00", "30", "1.33", "+0.33"])
    page.screenshot(path=OUT + "preseason-compare.png", full_page=True)
    page.click("text=← Season"); page.wait_for_timeout(800)

    # --- History: preseason games are marked, game reports compare like with like
    page.click('.tab-bar__btn[data-view=history]'); page.wait_for_timeout(800)
    check("history marks the two preseason games",
          page.evaluate("[...document.querySelectorAll('.list-row .pill')].filter(p=>p.textContent==='Preseason').length"), 2)

    def game_report(opponent):
        page.click(f".list-row:has-text('{opponent}')"); page.wait_for_timeout(800)
        page.click("text=Open this game's report"); page.wait_for_timeout(1000)

    game_report("Lokomotiv Kuban")
    t = table_after("Against the preseason — first game of the season")
    check("Lokomotiv's report: set against the preseason", t and t["head"][1], "Preseason, 2 games")
    page.click("text=← Game"); page.wait_for_timeout(600)
    page.click("text=← All games"); page.wait_for_timeout(600)
    game_report("Beta")
    t = table_after("Against the preseason so far")
    check("a preseason game's report: earlier preseason only", t and t["head"][1], "Previous 1 game of preseason")
    page.click("text=← Game"); page.wait_for_timeout(600)
    page.click("text=← All games"); page.wait_for_timeout(600)

    # --- A start date with no season games yet ------------------------------
    open_season()
    page.fill('input[name="season-start"]', "2026-10-10")
    page.dispatch_event('input[name="season-start"]', "change")
    page.wait_for_timeout(800)
    set_scope("season")
    check("season only, none yet: says so",
          "No season games finished yet" in page.text_content(".screen"), True)
    open_report()
    check("report with no season games: says so, doesn't fail",
          "No season games finished yet" in page.text_content(".screen"), True)
    page.click("text=← Season"); page.wait_for_timeout(800)

    # --- Clearing the date puts everything back together --------------------
    page.fill('input[name="season-start"]', "")
    page.dispatch_event('input[name="season-start"]', "change")
    page.wait_for_timeout(800)
    check("cleared: switch gone, every game counts",
          [page.evaluate("!!document.querySelector('.season-scope')"), tile("Games")], [False, "3"])

    check("no console errors", errs, [])
    b.close()

srv.terminate()
print("\n" + ("ALL PASS" if all(results) else f"{results.count(False)} FAILED"))
raise SystemExit(0 if all(results) else 1)
