import subprocess, time, urllib.request
from playwright.sync_api import sync_playwright

import os, sys, tempfile

# Repo root is the parent of tests/, so these run from anywhere.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Screenshots and scratch files go to a temp dir, never into the repo.
OUT = os.path.join(tempfile.gettempdir(), "paint-touches-tests") + os.sep
os.makedirs(OUT, exist_ok=True)


PORT = 8781
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

# A v1 database exactly as it exists on the iPad today, with real data in it.
SEED_V1 = """
() => new Promise((resolve, reject) => {
  const req = indexedDB.open("paint-touches", 1);
  req.onupgradeneeded = (e) => {
    const db = e.target.result;
    db.createObjectStore("players", { keyPath: "id" });
    db.createObjectStore("plays", { keyPath: "id" });
    db.createObjectStore("games", { keyPath: "id" });
    const p = db.createObjectStore("possessions", { keyPath: "id" });
    p.createIndex("by-game", "gameId");
  };
  req.onerror = () => reject(req.error);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction(["players","plays","games","possessions"], "readwrite");
    tx.objectStore("players").put({ id:"pl1", name:"Marko", number:"4", archived:false, createdAt: 1000 });
    tx.objectStore("plays").put({ id:"py1", name:"Horns", archived:false, createdAt: 1000 });
    tx.objectStore("games").put({ id:"g1", date:"2026-08-10", opponent:"Old Game HS",
                                 status:"completed", currentQuarter:"1", createdAt: 1000, completedAt: 2000 });
    tx.objectStore("possessions").put({ id:"ps1", gameId:"g1", quarter:"1", sequenceNumber:1,
      play:{playId:"py1",playName:"Horns"},
      touches:[{playerId:"pl1",playerName:"Marko",playerNumber:"4",timestamp:1}],
      outcome:"2PM", points:2, andOne:null, ftAttempt:null });
    tx.objectStore("possessions").put({ id:"ps2", gameId:"g1", quarter:"1", sequenceNumber:2,
      play:{playId:null,playName:"Transition / No Play"}, touches:[],
      outcome:"TO", points:0, andOne:null, ftAttempt:null });
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

    # Load the page WITHOUT the app booting, so we can plant a v1 database first.
    page.route("**/js/app.js", lambda route: route.abort())
    page.goto(f"http://localhost:{PORT}/index.html")
    check("planted a v1 database", page.evaluate(SEED_V1), True)

    # Now let the real app boot against that existing database — this is the upgrade.
    page.unroute("**/js/app.js")
    page.goto(f"http://localhost:{PORT}/index.html", wait_until="networkidle")
    errs.clear()  # drop the aborted-app.js error from the setup phase above
    page.wait_for_timeout(900)

    dbinfo = page.evaluate("""() => new Promise((resolve) => {
      const req = indexedDB.open("paint-touches");
      req.onsuccess = () => {
        const db = req.result;
        const stores = [...db.objectStoreNames].sort();
        const tx = db.transaction(["players","games","possessions","coverages","mistakes"], "readonly");
        const out = { version: db.version, stores };
        const grab = (s, key) => new Promise(r => {
          const q = tx.objectStore(s).getAll();
          q.onsuccess = () => { out[key] = q.result; r(); };
        });
        Promise.all([grab("players","players"), grab("games","games"),
                     grab("possessions","possessions"), grab("coverages","coverages"),
                     grab("mistakes","mistakes")]).then(() => { db.close(); resolve(out); });
      };
    })""")

    # A v1 database is what sits on a device that hasn't opened the app in a
    # while. It must land on the current version in one jump, intact.
    check("v1 database upgraded straight to v3", dbinfo["version"], 3)
    check("all eight stores present", dbinfo["stores"],
          ["coverages","games","mistakes","players","plays","possessions","quickTags","tagEvents"])
    check("existing player survived upgrade", [p["name"] for p in dbinfo["players"]], ["Marko"])
    check("existing game survived upgrade", [g["opponent"] for g in dbinfo["games"]], ["Old Game HS"])
    check("existing possessions survived upgrade", len(dbinfo["possessions"]), 2)
    check("old possession kept its outcome", sorted(p["outcome"] for p in dbinfo["possessions"]), ["2PM","TO"])
    seeded = [c["name"] for c in sorted(dbinfo["coverages"], key=lambda c: c["createdAt"])]
    check("coverages seeded in order", seeded[:3], ["Drop","Hedge (Show)","Switch"])
    check("mistakes seeded count", len(dbinfo["mistakes"]), 9)

    # Playbook screen: three sections
    page.click('.tab-bar button[data-view="playbook"]')
    page.wait_for_timeout(400)
    check("four section tabs", page.evaluate("[...document.querySelectorAll('.segmented__btn')].map(b=>b.textContent)"),
          ["Plays","Coverages","Mistakes","Tags"])
    check("plays section active first", page.text_content(".screen-title"), "Playbook")
    check("existing play still listed", page.text_content(".entity-list"), "Horns" if page.text_content(".entity-list").strip()=="Horns" else page.text_content(".entity-list"))

    page.click('.segmented__btn:has-text("Coverages")')
    page.wait_for_timeout(400)
    check("coverages heading", page.text_content(".screen-title"), "PnR Coverages")
    names = page.evaluate("[...document.querySelectorAll('.entity-list .list-row__label, .entity-list li')].map(e=>e.textContent)")
    check("Drop is listed first (stable order)", names[0].startswith("Drop"), True)
    check("six coverages listed", len(names), 6)
    page.screenshot(path=OUT+"stage1-coverages.png", full_page=True)

    page.click('.segmented__btn:has-text("Mistakes")')
    page.wait_for_timeout(400)
    check("mistakes heading", page.text_content(".screen-title"), "PnR Mistakes")

    # Add a coverage of his own, confirm it lands at the end
    page.click('.segmented__btn:has-text("Coverages")')
    page.wait_for_timeout(300)
    page.click('.list-toolbar button')
    page.fill('.entity-form [name="name"]', "Veer Back")
    page.click('.entity-form button[type="submit"]')
    page.wait_for_timeout(500)
    names = page.evaluate("[...document.querySelectorAll('.entity-list li')].map(e=>e.textContent)")
    check("added coverage appears last", names[-1].startswith("Veer Back"), True)
    check("now seven coverages", len(names), 7)

    # Reload: seeding must NOT duplicate
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(900)
    count = page.evaluate("""() => new Promise(r => {
      const req = indexedDB.open("paint-touches");
      req.onsuccess = () => { const db=req.result;
        const q = db.transaction("coverages").objectStore("coverages").count();
        q.onsuccess = () => { db.close(); r(q.result); }; };
    })""")
    check("no duplicate seeding on reload", count, 7)

    check("no console errors", errs, [])
    b.close()
srv.terminate()
print("\n" + ("ALL PASS" if all(results) else f"{results.count(False)} FAILED"))
