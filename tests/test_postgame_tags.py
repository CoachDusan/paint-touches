"""Quick tags added to a game that is already finished, and the play name
that is read from the app rather than from the record.

A tag noticed on the bus or on film has to land in the same place as one
tapped from the bench — but it cannot pretend to know when it happened, so
the quarter is chosen by hand and the record is marked as added later. This
drives the real screens: add one, see it counted, export it, remove it.
"""

import subprocess, time, urllib.request
from playwright.sync_api import sync_playwright

import os, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(tempfile.gettempdir(), "paint-touches-tests") + os.sep
os.makedirs(OUT, exist_ok=True)

PORT = 8795
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

# A tag added after the game, handed straight to the CSV builder: the quarter
# is all the timing it honestly has, so both time columns must come back empty.
CSV_PROBE = """
() => import('/js/export.js').then(m => m.buildCSV([{
  game: { date: "2026-09-18", opponent: "Late HS", venue: "home", ourScore: null,
          theirScore: null, createdAt: 1000 },
  possessions: [],
  tagEvents: [{ tagName: "Film note", playerName: "Marko", playerNumber: "4",
                quarter: "3", loggedAt: 99999999, addedAfterGame: true }],
}]))
"""

with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width": 1024, "height": 768}, device_scale_factor=2)
    page = ctx.new_page()
    errs = []
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    page.on("dialog", lambda d: d.accept())

    page.goto(f"http://localhost:{PORT}/index.html", wait_until="networkidle")
    page.wait_for_timeout(700)

    # A player to tag, and a tag to give him.
    page.click('.tab-bar button[data-view="roster"]'); page.wait_for_timeout(400)
    page.click('.list-toolbar button:has-text("+ Add")')
    page.fill('.entity-form [name="number"]', "4")
    page.fill('.entity-form [name="name"]', "Marko")
    page.click('.entity-form button[type="submit"]'); page.wait_for_timeout(400)

    page.click('.tab-bar button[data-view="playbook"]'); page.wait_for_timeout(400)
    page.click('.segmented__btn:has-text("Tags")'); page.wait_for_timeout(400)
    page.click('.list-toolbar button:has-text("+ Add")')
    page.fill('.entity-form [name="name"]', "Film note")
    page.click('.entity-form button[type="submit"]'); page.wait_for_timeout(400)

    # One possession with no play called, to see what the app calls it now.
    # A miss, not a make: a make opens the and-1 question and the possession
    # is not written until that is answered.
    page.click('.tab-bar button[data-view="game"]'); page.wait_for_timeout(400)
    page.fill('[name="opponent"]', "Late HS")
    page.click('button:has-text("Start Game")'); page.wait_for_timeout(700)
    page.click('.live-tracking button:has-text("2PT Miss")'); page.wait_for_timeout(600)
    check("the possession was logged", page.text_content(".pill"), "1 offense · 0 defense")

    page.click('button:has-text("Stats")'); page.wait_for_timeout(600)
    panel = page.text_content(".stats-panel")
    check("no play called reads as Fastbreak", "Fastbreak / No Play" in panel, True)
    check("the old name is gone", "Transition / No Play" in panel, False)
    page.click('button:has-text("Hide Stats")'); page.wait_for_timeout(300)

    page.click('button:has-text("End Game")'); page.wait_for_timeout(400)
    page.click('button:has-text("End without score")'); page.wait_for_timeout(800)

    # History → the finished game.
    page.click('.tab-bar button[data-view="history"]'); page.wait_for_timeout(700)
    page.click('.list-row--tappable:has-text("Late HS")'); page.wait_for_timeout(700)

    card = '.card:has-text("Quick tags")'
    check("the finished game offers quick tags", page.is_visible(card), True)
    check("nothing to tap until a tag and a quarter are picked",
          "Pick a tag and a quarter" in page.text_content(card), True)

    page.click(f'{card} .chip:has-text("Film note")'); page.wait_for_timeout(350)
    check("a tag alone is not enough",
          "Pick a tag and a quarter" in page.text_content(card), True)
    page.click(f'{card} .chip:has-text("Q3")'); page.wait_for_timeout(350)
    check("the player appears once both are picked",
          page.is_visible(f'{card} .chip:has-text("Marko")'), True)
    page.screenshot(path=OUT + "postgame-tags.png", full_page=True)

    page.click(f'{card} .chip:has-text("Marko")'); page.wait_for_timeout(700)
    text = page.text_content(card)
    check("the tag is listed", "Tagged in this game (1)" in text, True)
    check("it says it was added later", "added later" in text, True)
    check("it carries the chosen quarter", "Q3" in text, True)

    stored = page.evaluate("""() => new Promise(r => {
      const req = indexedDB.open("paint-touches");
      req.onsuccess = () => { const db = req.result;
        const q = db.transaction("tagEvents").objectStore("tagEvents").getAll();
        q.onsuccess = () => { db.close();
          r(q.result.map(e => [e.tagName, e.quarter, e.playerNumber, !!e.addedAfterGame])); }; };
    })""")
    check("stored as a normal tag event, marked as added later",
          stored, [["Film note", "3", "4", True]])

    # It has to count exactly like one tapped from the bench.
    page.click('.stats-toggle .segmented__btn[data-stats-side=defense]'); page.wait_for_timeout(600)
    check("counted in the game's stats",
          "Film note — 1 total" in page.text_content(".stats-panel"), True)

    csv_text = page.evaluate(CSV_PROBE)
    tag_row = [r for r in csv_text.split("\n") if '"tag"' in r][0]
    check("exported with the quarter", '"3"' in tag_row, True)
    check("exported with no clock time, since it does not have one",
          tag_row.endswith('"",""'), True)

    # A mis-tap from the bus must be removable.
    page.click(f'{card} .list-row:has-text("Film note") button:has-text("Remove")')
    page.wait_for_timeout(800)
    check("removed from the card", "Tagged in this game" in page.text_content(card), False)
    left = page.evaluate("""() => new Promise(r => {
      const req = indexedDB.open("paint-touches");
      req.onsuccess = () => { const db = req.result;
        const q = db.transaction("tagEvents").objectStore("tagEvents").count();
        q.onsuccess = () => { db.close(); r(q.result); }; };
    })""")
    check("removed from the database too", left, 0)

    check("no console errors", errs, [])
    b.close()
srv.terminate()
print("\n" + ("ALL PASS" if all(results) else f"{results.count(False)} FAILED"))
sys.exit(0 if all(results) else 1)
