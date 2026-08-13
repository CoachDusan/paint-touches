import subprocess, time, urllib.request
from playwright.sync_api import sync_playwright

import os, sys, tempfile

# Repo root is the parent of tests/, so these run from anywhere.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Screenshots and scratch files go to a temp dir, never into the repo.
OUT = os.path.join(tempfile.gettempdir(), "paint-touches-tests") + os.sep
os.makedirs(OUT, exist_ok=True)


PORT = 8787
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

def game_records(page):
    return page.evaluate("""() => new Promise(r => {
      const req = indexedDB.open("paint-touches");
      req.onsuccess = () => { const db=req.result;
        const q = db.transaction("games").objectStore("games").getAll();
        q.onsuccess = () => { db.close(); r(q.result.sort((a,b)=>a.createdAt-b.createdAt)); }; };
    })""")

with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width":1024,"height":768}, device_scale_factor=2)
    page = ctx.new_page()
    errs = []
    page.on("console", lambda m: errs.append(m.text) if m.type=="error" else None)
    page.on("dialog", lambda d: d.accept())
    page.goto(f"http://localhost:{PORT}/index.html", wait_until="networkidle")
    page.wait_for_timeout(800)

    page.click('.tab-bar button[data-view="roster"]')
    page.click('.list-toolbar button'); page.fill('.entity-form [name="number"]', "4")
    page.fill('.entity-form [name="name"]', "Marko")
    page.click('.entity-form button[type="submit"]'); page.wait_for_timeout(300)

    # --- Game 1: away win, score entered ---
    page.click('.tab-bar button[data-view="game"]'); page.wait_for_timeout(300)
    check("venue picker on the new game form",
          page.evaluate("[...document.querySelectorAll('[data-venue]')].map(b=>b.textContent)"),
          ["Home","Away","Neutral"])
    check("home selected by default",
          page.evaluate("!!document.querySelector('[data-venue=home].is-active')"), True)
    page.fill('[name="opponent"]', "Away Win HS")
    page.click('[data-venue=away]'); page.wait_for_timeout(200)
    check("venue selection sticks",
          page.evaluate("!!document.querySelector('[data-venue=away].is-active')"), True)
    page.click('button:has-text("Start Game")'); page.wait_for_timeout(600)

    page.click('.player-tile:has-text("Marko")')
    page.click('.outcome-row button:has-text("2PT Made")'); page.wait_for_timeout(250)
    page.click('.outcome-sheet button:has-text("Skip")'); page.wait_for_timeout(400)

    page.click('button:has-text("End Game")'); page.wait_for_timeout(500)
    check("end game asks for the score", "Final score" in page.text_content(".screen"), True)
    check("the two-totals caveat is shown",
          "counts only the possessions you logged" in page.text_content(".screen"), True)
    page.screenshot(path=OUT+"stage5-endgame.png", full_page=True)
    page.fill('[name="ourGscore"]' if False else '.end-game [name="ourScore"]', "68")
    page.fill('.end-game [name="theirScore"]', "61")
    page.click('button:has-text("Save & End")'); page.wait_for_timeout(900)

    g = game_records(page)[0]
    check("our score stored", g["ourScore"], 68)
    check("their score stored", g["theirScore"], 61)
    check("venue stored", g["venue"], "away")
    check("result is derived, never stored", "result" in g, False)

    # --- Game 2: home, ended with no score ---
    page.click('.tab-bar button[data-view="game"]'); page.wait_for_timeout(400)
    page.fill('[name="opponent"]', "No Score HS")
    page.click('button:has-text("Start Game")'); page.wait_for_timeout(600)
    page.click('.player-tile:has-text("Marko")')
    page.click('.outcome-row button:has-text("2PT Miss")'); page.wait_for_timeout(400)
    page.click('button:has-text("End Game")'); page.wait_for_timeout(500)
    page.click('button:has-text("End without score")'); page.wait_for_timeout(900)

    g2 = game_records(page)[1]
    check("skipping leaves scores empty", (g2["ourScore"], g2["theirScore"]), (None, None))
    check("game still completed without a score", g2["status"], "completed")

    # --- History list ---
    page.click('.tab-bar button[data-view="history"]'); page.wait_for_timeout(700)
    check("win badge shown",
          page.evaluate("[...document.querySelectorAll('.list-row .badge')].map(b=>b.textContent)"), ["W"])
    row = page.text_content('.list-row--tappable:has-text("Away Win HS")')
    check("score shown in the list", "68–61" in row, True)
    check("venue shown in the list", "Away" in row, True)
    noscore = page.text_content('.list-row--tappable:has-text("No Score HS")')
    check("no badge on a game with no score", "W" not in noscore and "L" not in noscore, True)

    # --- Detail + editing ---
    page.click('.list-row--tappable:has-text("Away Win HS")'); page.wait_for_timeout(700)
    check("score headline on detail", "68–61" in page.text_content(".score-line"), True)
    check("caveat repeated where both totals meet",
          "counts only the possessions you logged" in page.text_content(".screen"), True)

    page.click('button:has-text("Edit")'); page.wait_for_timeout(400)
    check("edit form prefilled",
          page.evaluate("document.querySelector('.game-details-form [name=ourScore]').value"), "68")
    page.fill('.game-details-form [name="ourScore"]', "58")
    page.click('[data-venue=home]'); page.wait_for_timeout(150)
    page.click('.game-details-form button:has-text("Save")'); page.wait_for_timeout(700)

    check("edited score shown", "58–61" in page.text_content(".score-line"), True)
    check("result flipped to a loss",
          page.evaluate("document.querySelector('.badge').textContent"), "L")
    g = game_records(page)[0]
    check("edit persisted to the database", (g["ourScore"], g["venue"]), (58, "home"))

    page.click('button:has-text("← All games")'); page.wait_for_timeout(500)
    check("list reflects the edit without a reload",
          page.evaluate("[...document.querySelectorAll('.list-row .badge')].map(b=>b.textContent)"), ["L"])

    # A game with no score can have one added later
    page.click('.list-row--tappable:has-text("No Score HS")'); page.wait_for_timeout(600)
    check("prompts to add a score", page.evaluate("""[...document.querySelectorAll('button')].some(b=>b.textContent==='Add score')"""), True)

    check("no console errors", errs, [])
    b.close()
srv.terminate()
print("\n" + ("ALL PASS" if all(results) else f"{results.count(False)} FAILED"))
