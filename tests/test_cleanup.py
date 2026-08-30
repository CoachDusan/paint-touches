import subprocess, time, urllib.request
from playwright.sync_api import sync_playwright

import os, sys, tempfile

# Repo root is the parent of tests/, so these run from anywhere.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Screenshots and scratch files go to a temp dir, never into the repo.
OUT = os.path.join(tempfile.gettempdir(), "paint-touches-tests") + os.sep
os.makedirs(OUT, exist_ok=True)


PORT = 8783
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
    page.on("dialog", lambda d: d.accept())
    page.goto(f"http://localhost:{PORT}/index.html", wait_until="networkidle")
    page.wait_for_timeout(700)

    # Four players; archive two of them.
    page.click('.tab-bar button[data-view="roster"]')
    for num, name in [("4","Marko"),("5","Luka"),("6","Old One"),("7","Old Two")]:
        page.click('.list-toolbar button:has-text("+ Add")'); page.fill('.entity-form [name="number"]', num)
        page.fill('.entity-form [name="name"]', name)
        page.click('.entity-form button[type="submit"]'); page.wait_for_timeout(220)
    for name in ["Old One","Old Two"]:
        page.click(f'.entity-list li:has-text("{name}") button:has-text("Archive")')
        page.wait_for_timeout(300)

    check("two players remain active",
          page.evaluate("[...document.querySelectorAll('.entity-list li')].length"), 2)
    page.click('button:has-text("Show archived")'); page.wait_for_timeout(300)
    check("two players archived",
          page.evaluate("""[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Delete all 2 archived'))"""), True)

    # Two completed games, one still in progress, all with possessions.
    # Game A gets two possessions, Game B one, so deleting A alone is
    # provable: the possession count has to land on B's single record.
    for opp, n in [("Game A", 2), ("Game B", 1)]:
        page.click('.tab-bar button[data-view="game"]'); page.wait_for_timeout(300)
        page.fill('[name="opponent"]', opp)
        page.click('button:has-text("Start Game")'); page.wait_for_timeout(500)
        for _ in range(n):
            page.click('.player-tile:has-text("Marko")')
            page.click('.outcome-row button:has-text("2PT Miss")'); page.wait_for_timeout(400)
        page.click('button:has-text("End Game")'); page.wait_for_timeout(400)
        page.click('button:has-text("End without score")'); page.wait_for_timeout(700)

    page.click('.tab-bar button[data-view="game"]'); page.wait_for_timeout(300)
    page.fill('[name="opponent"]', "Still Playing")
    page.click('button:has-text("Start Game")'); page.wait_for_timeout(500)
    page.click('.player-tile:has-text("Luka")')
    page.click('.outcome-row button:has-text("2PT Miss")'); page.wait_for_timeout(400)

    def counts():
        return page.evaluate("""() => new Promise(r => {
          const req = indexedDB.open("paint-touches");
          req.onsuccess = () => { const db = req.result;
            const tx = db.transaction(["games","possessions","players"], "readonly");
            const out = {};
            const g = tx.objectStore("games").getAll();
            const p = tx.objectStore("possessions").getAll();
            const pl = tx.objectStore("players").getAll();
            let n = 0; const done = () => { if (++n === 3) { db.close(); r(out); } };
            g.onsuccess = () => { out.games = g.result.length;
              out.inProgress = g.result.filter(x=>x.status==="in_progress").length; done(); };
            p.onsuccess = () => { out.possessions = p.result.length; done(); };
            pl.onsuccess = () => { out.players = pl.result.length; done(); };
          };
        })""")

    before = counts()
    check("3 games before clearing", before["games"], 3)
    check("4 possessions before clearing", before["possessions"], 4)
    check("4 player records before deleting archived", before["players"], 4)

    # Clear history
    page.click('.tab-bar button[data-view="history"]'); page.wait_for_timeout(600)
    check("two completed games listed",
          page.evaluate("[...document.querySelectorAll('.list-row--tappable')].length"), 2)
    page.screenshot(path=OUT+"cleanup-history.png", full_page=True)

    # --- Deleting ONE game, from inside that game's own screen ---
    check("no delete button on the list itself",
          page.evaluate("""[...document.querySelectorAll('button')].some(b=>b.textContent==='Delete this game')"""), False)
    page.click('.list-row--tappable:has-text("Game A")'); page.wait_for_timeout(600)
    check("delete offered inside the game",
          page.evaluate("""[...document.querySelectorAll('button')].some(b=>b.textContent==='Delete this game')"""), True)
    page.screenshot(path=OUT+"cleanup-game-detail.png", full_page=True)
    page.click('button:has-text("Delete this game")'); page.wait_for_timeout(900)

    one_gone = counts()
    check("only that game was deleted", one_gone["games"], 2)
    check("its possessions went with it", one_gone["possessions"], 2)
    check("the in-progress game was not touched", one_gone["inProgress"], 1)
    check("back on the list after deleting",
          page.evaluate("[...document.querySelectorAll('.list-row--tappable')].length"), 1)
    check("the surviving game is the other one",
          "Game B" in page.text_content(".screen"), True)
    check("the deleted game is gone from the list",
          "Game A" in page.text_content(".screen"), False)

    page.click('button:has-text("Clear all history")'); page.wait_for_timeout(900)

    after = counts()
    check("completed games deleted", after["games"], 1)
    check("in-progress game survived", after["inProgress"], 1)
    check("only the in-progress game's possession remains", after["possessions"], 1)
    check("history screen now empty",
          "No completed games yet" in page.text_content(".screen"), True)

    # Delete archived players
    page.click('.tab-bar button[data-view="roster"]'); page.wait_for_timeout(400)
    page.click('button:has-text("Show archived")'); page.wait_for_timeout(300)
    page.click('button:has-text("Delete all 2 archived")'); page.wait_for_timeout(800)

    final = counts()
    check("archived players permanently gone", final["players"], 2)
    check("active players untouched",
          page.evaluate("[...document.querySelectorAll('.entity-list li')].length"), 2)
    check("no archived toggle left",
          page.evaluate("""[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Show archived'))"""), False)
    check("active roster is the right two",
          page.evaluate("[...document.querySelectorAll('.entity-list li')].map(e=>e.textContent.replace(/EditArchive/,'').replace(/\\s+/g,' ').trim())"),
          ["#4 Marko","#5 Luka"])

    check("in-progress game still intact after all clearing", counts()["inProgress"], 1)
    check("no console errors", errs, [])
    b.close()
srv.terminate()
print("\n" + ("ALL PASS" if all(results) else f"{results.count(False)} FAILED"))
