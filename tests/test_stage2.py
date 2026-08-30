import subprocess, time, urllib.request
from playwright.sync_api import sync_playwright

import os, sys, tempfile

# Repo root is the parent of tests/, so these run from anywhere.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Screenshots and scratch files go to a temp dir, never into the repo.
OUT = os.path.join(tempfile.gettempdir(), "paint-touches-tests") + os.sep
os.makedirs(OUT, exist_ok=True)


PORT = 8782
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

with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width":1024,"height":768}, device_scale_factor=2)
    page = ctx.new_page()
    errs = []
    page.on("console", lambda m: errs.append(m.text) if m.type=="error" else None)
    page.goto(f"http://localhost:{PORT}/index.html", wait_until="networkidle")
    page.wait_for_timeout(700)

    # Roster
    page.click('.tab-bar button[data-view="roster"]')
    for num, name in [("4","Marko"),("5","Luka")]:
        page.click('.list-toolbar button:has-text("+ Add")'); page.fill('.entity-form [name="number"]', num)
        page.fill('.entity-form [name="name"]', name)
        page.click('.entity-form button[type="submit"]'); page.wait_for_timeout(250)

    # Game
    page.click('.tab-bar button[data-view="game"]')
    page.fill('[name="opponent"]', "Defense Test HS")
    page.click('button:has-text("Start Game")'); page.wait_for_timeout(600)

    check("side toggle present", page.evaluate("[...document.querySelectorAll('.side-toggle .segmented__btn')].map(b=>b.textContent)"),
          ["OFFENSE","DEFENSE"])
    check("offense active by default",
          page.evaluate("!!document.querySelector('.side-toggle .segmented__btn[data-side=offense].is-active')"), True)

    # --- One offensive possession: Marko touch, made 2 (worth 2 points) ---
    page.click('.player-tile:has-text("Marko")')
    page.click('.outcome-row button:has-text("2PT Made")'); page.wait_for_timeout(200)
    page.click('.outcome-sheet button:has-text("Skip")'); page.wait_for_timeout(400)

    # --- Switch to defense ---
    page.click('.side-toggle .segmented__btn[data-side="defense"]'); page.wait_for_timeout(400)
    check("defense styling applied", page.evaluate("!!document.querySelector('.live-tracking.is-defense')"), True)
    check("coverages offered", page.evaluate("[...document.querySelectorAll('.card:has(.section-label) .chip-grid .chip')].slice(0,2).map(c=>c.textContent)"),
          ["Drop","Hedge (Show)"])
    check("outcome blocked without a coverage",
          "Pick a coverage above" in page.text_content(".live-tracking"), True)

    # Coverage -> mistake -> player -> outcome (they scored a three)
    page.click('.chip:has-text("Drop")'); page.wait_for_timeout(250)
    check("outcome row appears after coverage",
          page.evaluate("!!document.querySelector('.outcome-row')"), True)
    check("defensive outcome wording",
          page.evaluate("[...document.querySelectorAll('.outcome-row button')].map(b=>b.textContent)"),
          ["2PT Made","2PT Missed","3PT Made","3PT Missed","Free Throws","Foul","Forced TO"])
    check("outcome buttons are colour-coded by event, same on both sides",
          page.evaluate("[...document.querySelectorAll('.outcome-row button')].map(b=>[...b.classList].find(c=>c.startsWith('outcome-btn--')&&c!=='outcome-btn--wide'))"),
          ["outcome-btn--make","outcome-btn--miss","outcome-btn--make","outcome-btn--miss",
           "outcome-btn--ft","outcome-btn--foul","outcome-btn--to"])

    check("no player picker before a mistake is chosen",
          page.evaluate("[...document.querySelectorAll('.section-label')].map(e=>e.textContent).includes('Who made it?')"), False)
    page.click('.chip:has-text("Big not at level of screen")'); page.wait_for_timeout(250)
    check("player picker appears after a mistake",
          page.evaluate("[...document.querySelectorAll('.section-label')].map(e=>e.textContent).includes('Who made it?')"), True)
    check("unassigned warning shown", "unassigned" in page.text_content(".live-tracking"), True)
    page.click('.player-tile:has-text("Luka")'); page.wait_for_timeout(250)
    check("warning clears once a player is picked", "unassigned" in page.text_content(".live-tracking"), False)
    page.screenshot(path=OUT+"stage2-defense.png", full_page=True)
    page.click('.outcome-row button:has-text("3PT Made")'); page.wait_for_timeout(250)
    page.click('.outcome-sheet button:has-text("Skip")'); page.wait_for_timeout(500)

    check("coverage stayed selected for the next possession",
          page.evaluate("!!document.querySelector('.chip.is-active')"), True)
    check("mistake cleared for the next possession",
          page.evaluate("[...document.querySelectorAll('.chip.is-active')].map(c=>c.textContent)"), ["Drop"])

    # A clean possession: No mistake, forced turnover
    page.click('.chip:has-text("No mistake")'); page.wait_for_timeout(200)
    check("no player picker for a clean possession",
          page.evaluate("[...document.querySelectorAll('.section-label')].map(e=>e.textContent).includes('Who made it?')"), False)
    page.click('.outcome-row button:has-text("Forced TO")'); page.wait_for_timeout(500)

    check("counts split by side", page.text_content(".pill"), "1 offense · 2 defense")

    # --- The critical one: does defense pollute offensive PPP? ---
    page.click('button:has-text("Stats")'); page.wait_for_timeout(500)
    def tile(label):
        return page.evaluate("""(l)=>{const t=[...document.querySelectorAll('.stat-tile')]
          .find(x=>x.querySelector('.stat-tile__label').textContent.trim().toLowerCase()===l.toLowerCase());
          return t?t.querySelector('.stat-tile__value').textContent.trim():null;}""", label)
    check("offense possessions exclude defensive ones", tile("Possessions"), "1")
    check("offense points exclude points allowed", tile("Points"), "2")
    check("offense PPP uncontaminated", tile("PPP"), "2.00")
    check("forced TO not counted as our turnover", tile("Turnovers"), "0")

    # --- Stored shape ---
    recs = page.evaluate("""() => new Promise(r => {
      const req = indexedDB.open("paint-touches");
      req.onsuccess = () => { const db=req.result;
        const q = db.transaction("possessions").objectStore("possessions").getAll();
        q.onsuccess = () => { db.close(); r(q.result.sort((a,b)=>a.sequenceNumber-b.sequenceNumber)); }; };
    })""")
    check("three possessions stored", len(recs), 3)
    check("sides recorded", [r["side"] for r in recs], ["offense","defense","defense"])
    check("offensive record still has its play", recs[0]["play"]["playName"], "Transition / No Play")
    check("defensive record has coverage", recs[1]["coverage"]["coverageName"], "Drop")
    check("defensive record has mistake", recs[1]["mistake"]["mistakeName"], "Big not at level of screen")
    check("defensive record has the player", recs[1]["mistakePlayer"]["playerName"], "Luka")
    check("points allowed stored on defensive record", recs[1]["points"], 3)
    check("clean possession marked No mistake", recs[2]["mistake"]["mistakeName"], "No mistake")
    check("clean possession has no player", recs[2]["mistakePlayer"], None)
    check("defensive records carry empty touches", [len(r["touches"]) for r in recs[1:]], [0,0])

    check("no console errors", errs, [])
    b.close()
srv.terminate()
print("\n" + ("ALL PASS" if all(results) else f"{results.count(False)} FAILED"))
