import subprocess, time, urllib.request
from playwright.sync_api import sync_playwright

import os, sys, tempfile

# Repo root is the parent of tests/, so these run from anywhere.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Screenshots and scratch files go to a temp dir, never into the repo.
OUT = os.path.join(tempfile.gettempdir(), "paint-touches-tests") + os.sep
os.makedirs(OUT, exist_ok=True)


PORT = 8786
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

# A v2 database (coverages/mistakes exist, quickTags/tagEvents do not) holding
# a real game — exactly what's on the iPad right now.
SEED_V2 = """
() => new Promise((resolve, reject) => {
  const req = indexedDB.open("paint-touches", 2);
  req.onupgradeneeded = (e) => {
    const db = e.target.result;
    ["players","plays","games","coverages","mistakes"].forEach(n => db.createObjectStore(n, { keyPath:"id" }));
    const p = db.createObjectStore("possessions", { keyPath: "id" });
    p.createIndex("by-game", "gameId");
  };
  req.onerror = () => reject(req.error);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction(["players","games","possessions","coverages"], "readwrite");
    tx.objectStore("players").put({ id:"pl1", name:"Marko", number:"4", archived:false, createdAt:1 });
    tx.objectStore("players").put({ id:"pl2", name:"Luka", number:"5", archived:false, createdAt:2 });
    tx.objectStore("coverages").put({ id:"c1", name:"Drop", archived:false, createdAt:1 });
    tx.objectStore("games").put({ id:"g0", date:"2026-08-10", opponent:"Older Game",
                                 status:"completed", currentQuarter:"1", createdAt:1, completedAt:2 });
    tx.objectStore("possessions").put({ id:"ps0", gameId:"g0", quarter:"1", sequenceNumber:1, side:"offense",
      play:{playId:null,playName:"Transition / No Play"}, touches:[], outcome:"2PM", points:2,
      andOne:null, ftAttempt:null });
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
    page.on("dialog", lambda d: d.accept())

    page.route("**/js/app.js", lambda route: route.abort())
    page.goto(f"http://localhost:{PORT}/index.html")
    check("planted a v2 database", page.evaluate(SEED_V2), True)
    page.unroute("**/js/app.js")
    page.goto(f"http://localhost:{PORT}/index.html", wait_until="networkidle")
    errs.clear()
    page.wait_for_timeout(1000)

    info = page.evaluate("""() => new Promise(r => {
      const req = indexedDB.open("paint-touches");
      req.onsuccess = () => { const db = req.result;
        const out = { version: db.version, stores: [...db.objectStoreNames].sort() };
        const tx = db.transaction(["quickTags","players","games"], "readonly");
        const q = tx.objectStore("quickTags").getAll();
        const pl = tx.objectStore("players").getAll();
        const g = tx.objectStore("games").getAll();
        let n=0; const done=()=>{ if(++n===3){ db.close(); r(out); } };
        q.onsuccess=()=>{ out.tags=q.result.map(t=>t.name); done(); };
        pl.onsuccess=()=>{ out.players=pl.result.length; done(); };
        g.onsuccess=()=>{ out.games=g.result.length; done(); };
      };
    })""")
    check("database upgraded to v3", info["version"], 3)
    check("tag stores added", "quickTags" in info["stores"] and "tagEvents" in info["stores"], True)
    check("v2 players survived", info["players"], 2)
    check("v2 game survived", info["games"], 1)
    check("Lazy box-out seeded", info["tags"], ["Lazy box-out"])

    # Playbook now has four sections
    page.click('.tab-bar button[data-view="playbook"]'); page.wait_for_timeout(400)
    check("four playbook sections",
          page.evaluate("[...document.querySelectorAll('.segmented__btn')].map(b=>b.textContent)"),
          ["Plays","Coverages","Mistakes","Tags"])
    page.click('.segmented__btn:has-text("Tags")'); page.wait_for_timeout(400)
    check("tags section lists the seed", "Lazy box-out" in page.text_content(".entity-list"), True)

    # Start a game
    page.click('.tab-bar button[data-view="game"]'); page.wait_for_timeout(300)
    page.fill('[name="opponent"]', "Boxout HS")
    page.click('button:has-text("Start Game")'); page.wait_for_timeout(600)

    check("no quick tags on the offense side",
          "Quick tags" in page.text_content(".live-tracking"), False)
    page.click('.side-toggle .segmented__btn[data-side=defense]'); page.wait_for_timeout(400)
    check("quick tags on the defense side",
          "QUICK TAGS" in page.text_content(".live-tracking").upper(), True)
    check("no player grid until a tag is picked",
          "each tap counts once" in page.text_content(".live-tracking"), False)

    page.click('.chip:has-text("Lazy box-out")'); page.wait_for_timeout(300)
    check("player grid appears", "each tap counts once" in page.text_content(".live-tracking"), True)
    page.screenshot(path=OUT+"tags-defense.png", full_page=True)

    # Three taps: Marko twice, Luka once
    page.click('.card:has-text("Quick tags") .player-tile:has-text("Marko")'); page.wait_for_timeout(350)
    page.click('.card:has-text("Quick tags") .player-tile:has-text("Marko")'); page.wait_for_timeout(350)
    page.click('.card:has-text("Quick tags") .player-tile:has-text("Luka")'); page.wait_for_timeout(350)
    check("running tally shown",
          page.evaluate("[...document.querySelectorAll('.card .touch-chip')].map(c=>c.textContent)"),
          ["#4 ×2","#5 ×1"])

    # A mis-tap must be undoable
    page.click('.card:has-text("Quick tags") .player-tile:has-text("Luka")'); page.wait_for_timeout(350)
    check("mis-tap recorded",
          page.evaluate("[...document.querySelectorAll('.card .touch-chip')].map(c=>c.textContent)"),
          ["#4 ×2","#5 ×2"])
    page.click('button:has-text("Undo last")'); page.wait_for_timeout(450)
    check("undo removed exactly one",
          page.evaluate("[...document.querySelectorAll('.card .touch-chip')].map(c=>c.textContent)"),
          ["#4 ×2","#5 ×1"])

    # Tagging must not create possessions
    check("no possessions created by tagging", page.text_content(".pill"), "0 offense · 0 defense")

    # Stats
    page.click('button:has-text("Stats")'); page.wait_for_timeout(500)
    page.click('.stats-toggle .segmented__btn[data-stats-side=defense]'); page.wait_for_timeout(500)
    panel = page.text_content(".stats-panel")
    check("tag total in heading", "Lazy box-out — 3 total" in panel, True)
    check("per-player counts listed",
          page.evaluate("""[...document.querySelectorAll('.stat-table tbody tr')].map(r=>[...r.children].map(c=>c.textContent.trim()))"""),
          [["#4 Marko","2"], ["#5 Luka","1"]])
    check("tag stats show with zero defensive possessions",
          "No defensive possessions logged yet" in panel, True)

    # Survives into History
    page.click('button:has-text("Hide Stats")'); page.wait_for_timeout(300)
    page.click('button:has-text("End Game")'); page.wait_for_timeout(400)
    page.click('button:has-text("End without score")'); page.wait_for_timeout(800)
    page.click('.tab-bar button[data-view="history"]'); page.wait_for_timeout(700)
    page.click('.list-row--tappable:has-text("Boxout HS")'); page.wait_for_timeout(700)
    page.click('.stats-toggle .segmented__btn[data-stats-side=defense]'); page.wait_for_timeout(500)
    check("tags frozen into history", "Lazy box-out — 3 total" in page.text_content(".stats-panel"), True)

    # Clearing history must take the tag events with it
    page.click('button:has-text("← All games")'); page.wait_for_timeout(400)
    page.click('button:has-text("Clear all history")'); page.wait_for_timeout(900)
    left = page.evaluate("""() => new Promise(r => {
      const req = indexedDB.open("paint-touches");
      req.onsuccess = () => { const db=req.result;
        const q = db.transaction("tagEvents").objectStore("tagEvents").count();
        q.onsuccess = () => { db.close(); r(q.result); }; };
    })""")
    check("no orphaned tag events after clearing history", left, 0)

    check("no console errors", errs, [])
    b.close()
srv.terminate()
print("\n" + ("ALL PASS" if all(results) else f"{results.count(False)} FAILED"))
