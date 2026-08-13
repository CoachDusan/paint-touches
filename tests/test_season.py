import subprocess, time, urllib.request
from playwright.sync_api import sync_playwright

import os, sys, tempfile

# Repo root is the parent of tests/, so these run from anywhere.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Screenshots and scratch files go to a temp dir, never into the repo.
OUT = os.path.join(tempfile.gettempdir(), "paint-touches-tests") + os.sep
os.makedirs(OUT, exist_ok=True)


PORT = 8788
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

# Three completed games plus one still in progress. The in-progress game is
# deliberately loaded with points that must NOT reach the season totals.
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
    const tx = db.transaction(["games","possessions","players"], "readwrite");
    const G = tx.objectStore("games"), P = tx.objectStore("possessions");
    tx.objectStore("players").put({ id:"p1", name:"Marko", number:"4", archived:false, createdAt:1 });

    G.put({ id:"gA", date:"2026-01-05", opponent:"Alpha", venue:"home",
            ourScore:70, theirScore:60, status:"completed", currentQuarter:"1", createdAt:1, completedAt:2 });
    G.put({ id:"gB", date:"2026-01-12", opponent:"Beta", venue:"away",
            ourScore:50, theirScore:60, status:"completed", currentQuarter:"1", createdAt:3, completedAt:4 });
    G.put({ id:"gC", date:"2026-01-19", opponent:"Gamma", venue:"home",
            ourScore:null, theirScore:null, status:"completed", currentQuarter:"1", createdAt:5, completedAt:6 });
    G.put({ id:"gD", date:"2026-01-26", opponent:"InProgress", venue:"home",
            ourScore:null, theirScore:null, status:"in_progress", currentQuarter:"1", createdAt:7, completedAt:null });

    const HORNS = {playId:"py1", playName:"Horns"};
    const FLEX  = {playId:"py2", playName:"Flex"};
    const DROP  = {coverageId:"c1", coverageName:"Drop"};
    const CLEAN = {mistakeId:"none", mistakeName:"No mistake"};
    const off = (id,g,play,outcome,pts,seq) => P.put({ id, gameId:g, quarter:"1", sequenceNumber:seq,
      side:"offense", play, touches:[], outcome, points:pts, andOne:null, ftAttempt:null });
    const def = (id,g,outcome,pts,seq) => P.put({ id, gameId:g, quarter:"1", sequenceNumber:seq,
      side:"defense", coverage:DROP, mistake:CLEAN, mistakePlayer:null, play:null, touches:[],
      outcome, points:pts, andOne:null, ftAttempt:null });

    off("a1","gA",HORNS,"2PM",2,1); off("a2","gA",HORNS,"2PA",0,2); def("a3","gA","2PM",2,3);
    off("b1","gB",HORNS,"3PM",3,1);
    off("c1","gC",FLEX,"2PA",0,1);
    // Must be excluded from every season number:
    off("d1","gD",HORNS,"3PM",3,1); off("d2","gD",HORNS,"3PM",3,2);

    tx.oncomplete = () => { db.close(); resolve(true); };
    tx.onerror = () => reject(tx.error);
  };
})
"""

with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width":1024,"height":768}, device_scale_factor=2)
    page = ctx.new_page()
    errs = []
    page.on("console", lambda m: errs.append(m.text) if m.type=="error" else None)

    page.route("**/js/app.js", lambda route: route.abort())
    page.goto(f"http://localhost:{PORT}/index.html")
    check("seeded three completed games + one live", page.evaluate(SEED), True)
    page.unroute("**/js/app.js")
    page.goto(f"http://localhost:{PORT}/index.html", wait_until="networkidle")
    errs.clear()
    page.wait_for_timeout(900)

    check("season tab exists",
          page.evaluate("!!document.querySelector('.tab-bar__btn[data-view=season]')"), True)
    page.click('.tab-bar__btn[data-view=season]'); page.wait_for_timeout(900)

    def tile(label, scope=".screen"):
        return page.evaluate("""([l,s])=>{const t=[...document.querySelectorAll(s+' .stat-tile')]
          .find(x=>x.querySelector('.stat-tile__label').textContent.trim().toLowerCase()===l.toLowerCase());
          return t?t.querySelector('.stat-tile__value').textContent.trim():null;}""", [label, scope])

    # Record: only 2 of 3 completed games have a score
    check("games counted", tile("Games"), "3")
    check("record from scored games only", tile("Record"), "1-1")
    check("home split", tile("Home"), "1-0")
    check("away split", tile("Away"), "0-1")
    check("missing-score note shown",
          "1 of 3 games have no score recorded" in page.text_content(".screen"), True)

    # Trend: Horns is the most-used play, so it's selected first
    check("trend kinds offered",
          page.evaluate("[...document.querySelectorAll('[data-trend-kind]')].map(b=>b.textContent)"),
          ["Plays","Coverages"])
    trend = page.evaluate("""[...document.querySelectorAll('.is-coverage-trend, .card')]
        .filter(c=>c.textContent.includes('Trend over the season'))
        .map(c=>[...c.querySelectorAll('.stat-table tbody tr')].map(r=>[...r.children].slice(0,3).map(td=>td.textContent.trim())))[0]""")
    check("trend lists every game oldest first, gaps included",
          trend, [["Jan 5, 2026 · Alpha","2","1.00"],
                  ["Jan 12, 2026 · Beta","1","3.00"],
                  ["Jan 19, 2026 · Gamma","—","—"]])
    check("trend season PPP pools points over possessions", tile("Season PPP"), "1.67")
    check("trend counts only games where it was used", tile("Games used"), "2")

    # Switch to coverages
    page.click('[data-trend-kind=coverages]'); page.wait_for_timeout(600)
    check("coverage trend colours differently",
          page.evaluate("!!document.querySelector('.is-coverage-trend')"), True)
    check("coverage trend PPP allowed", tile("Season PPP"), "2.00")

    page.screenshot(path=OUT+"season.png", full_page=True)

    # Season totals must exclude the in-progress game entirely
    check("season offense possessions exclude live game", tile("Possessions", ".stats-panel"), "4")
    check("season offense points exclude live game", tile("Points", ".stats-panel"), "5")
    check("season PPP is pooled, not averaged", tile("PPP", ".stats-panel"), "1.25")

    page.click('.stats-toggle .segmented__btn[data-stats-side=defense]'); page.wait_for_timeout(500)
    check("season defense pooled", tile("PPP allowed", ".stats-panel"), "2.00")

    check("no console errors", errs, [])
    b.close()
srv.terminate()
print("\n" + ("ALL PASS" if all(results) else f"{results.count(False)} FAILED"))
