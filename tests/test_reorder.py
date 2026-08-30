"""Hand-arranged list order — the Reorder mode on Roster and Playbook.

The order of these lists IS the order of the tap buttons during a game, so
the things worth proving are: an arrangement survives a reload, a newly
added play lands at the bottom of it rather than in the middle, the game
screen honours it, and nothing reshuffles on its own (rule 7).
"""

import subprocess, time, urllib.request
from playwright.sync_api import sync_playwright

import os, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(tempfile.gettempdir(), "paint-touches-tests") + os.sep
os.makedirs(OUT, exist_ok=True)

PORT = 8790
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

NAMES = "[...document.querySelectorAll('.entity-list li .list-row__main')].map(e=>e.textContent.trim())"
SORTS = "[...document.querySelectorAll('.sort-bar .segmented__btn')].map(b=>b.textContent)"
ACTIVE = "document.querySelector('.sort-bar .segmented__btn.is-active')?.textContent"

with sync_playwright() as pw:
    b = pw.chromium.launch()
    page = b.new_page(viewport={"width":810,"height":1080}, device_scale_factor=2)
    errs = []
    page.on("console", lambda m: errs.append(m.text) if m.type=="error" else None)
    page.on("dialog", lambda d: d.accept())
    page.goto(f"http://localhost:{PORT}/index.html", wait_until="networkidle")
    page.wait_for_timeout(700)

    page.click('.tab-bar button[data-view="playbook"]'); page.wait_for_timeout(500)

    # One play: nothing to reorder, so the button shouldn't be offered.
    page.click('.list-toolbar button:has-text("+ Add")')
    page.fill('.entity-form [name="name"]', "Horns")
    page.click('.entity-form button[type="submit"]'); page.wait_for_timeout(350)
    check("no Reorder button with a single play",
          page.evaluate("""[...document.querySelectorAll('button')].some(b=>b.textContent==='Reorder')"""), False)

    for n in ["Flex","5 Out","Zipper","Chin"]:
        page.click('.list-toolbar button:has-text("+ Add")')
        page.fill('.entity-form [name="name"]', n)
        page.click('.entity-form button[type="submit"]'); page.wait_for_timeout(280)

    check("Custom is offered as a sort", "Custom" in page.evaluate(SORTS), True)
    check("typed order to begin with", page.evaluate(NAMES),
          ["Horns","Flex","5 Out","Zipper","Chin"])
    check("Reorder offered once there's more than one",
          page.evaluate("""[...document.querySelectorAll('button')].some(b=>b.textContent==='Reorder')"""), True)

    # --- Reorder starts from what you are looking at, not from nowhere ---
    # Switch to A-Z first, so "seeded from the visible order" is provable.
    page.click('.sort-bar .segmented__btn[data-sort="name"]'); page.wait_for_timeout(500)
    alphabetical = page.evaluate(NAMES)
    check("A–Z really is alphabetical", alphabetical, ["5 Out","Chin","Flex","Horns","Zipper"])

    page.click('button:has-text("Reorder")'); page.wait_for_timeout(600)
    check("reorder starts from the order you were looking at",
          page.evaluate(NAMES), alphabetical)
    check("the ▲ on the first row is dead",
          page.evaluate("document.querySelector('.entity-list li .list-row__actions .btn').disabled"), True)
    check("the ▼ on the last row is dead",
          page.evaluate("""[...document.querySelectorAll('.entity-list li')].pop()
                           .querySelectorAll('.list-row__actions .btn')[1].disabled"""), True)
    page.screenshot(path=OUT+"reorder-mode.png", full_page=True)

    # Zipper is last; walk it to the top.
    for _ in range(4):
        page.click('.entity-list li:has-text("Zipper") button:has-text("▲")'); page.wait_for_timeout(280)
    check("moved to the top", page.evaluate(NAMES),
          ["Zipper","5 Out","Chin","Flex","Horns"])

    # And one step back down, to prove ▼ works too.
    page.click('.entity-list li:has-text("Zipper") button:has-text("▼")'); page.wait_for_timeout(300)
    arranged = ["5 Out","Zipper","Chin","Flex","Horns"]
    check("and one step back down", page.evaluate(NAMES), arranged)

    page.click('button:has-text("Done")'); page.wait_for_timeout(700)
    check("arrangement kept after Done", page.evaluate(NAMES), arranged)
    check("sort switched itself to Custom", page.evaluate(ACTIVE), "Custom")

    # --- It has to survive a reload, or it isn't an arrangement ---
    page.reload(); page.wait_for_timeout(900)
    page.click('.tab-bar button[data-view="playbook"]'); page.wait_for_timeout(600)
    check("arrangement survived a reload", page.evaluate(NAMES), arranged)

    positions = page.evaluate("""() => new Promise(r => {
      const req = indexedDB.open("paint-touches");
      req.onsuccess = () => { const db = req.result;
        const q = db.transaction("plays","readonly").objectStore("plays").getAll();
        q.onsuccess = () => { db.close();
          r(q.result.slice().sort((a,b)=>a.position-b.position).map(p=>[p.name,p.position])); };
      };
    })""")
    check("order is stored on the records, so it travels in a backup",
          positions, [[n, i] for i, n in enumerate(arranged)])

    # --- A new play joins at the bottom, never in the middle ---
    page.click('.list-toolbar button:has-text("+ Add")')
    page.fill('.entity-form [name="name"]', "Brand New")
    page.click('.entity-form button[type="submit"]'); page.wait_for_timeout(450)
    check("a newly added play lands at the bottom",
          page.evaluate(NAMES), arranged + ["Brand New"])

    # --- The game screen is the whole point ---
    page.click('.tab-bar button[data-view="roster"]'); page.wait_for_timeout(400)
    for num, name in [("7","Nikola"),("4","Marko")]:
        page.click('.list-toolbar button:has-text("+ Add")')
        page.fill('.entity-form [name="number"]', num); page.fill('.entity-form [name="name"]', name)
        page.click('.entity-form button[type="submit"]'); page.wait_for_timeout(300)
    check("roster reads by number to begin with",
          page.evaluate(NAMES), ["#4  Marko","#7  Nikola"])
    page.click('button:has-text("Reorder")'); page.wait_for_timeout(600)
    page.click('.entity-list li:has-text("Nikola") button:has-text("▲")'); page.wait_for_timeout(300)
    page.click('button:has-text("Done")'); page.wait_for_timeout(600)
    check("roster can be hand-arranged too",
          page.evaluate(NAMES), ["#7  Nikola","#4  Marko"])

    page.click('.tab-bar button[data-view="game"]'); page.wait_for_timeout(400)
    page.fill('[name="opponent"]', "Order HS")
    page.click('button:has-text("Start Game")'); page.wait_for_timeout(800)
    check("play buttons follow the arrangement",
          page.evaluate("[...document.querySelectorAll('.chip-grid .chip')].map(c=>c.textContent)"),
          ["Transition / No Play"] + arranged + ["Brand New"])
    check("player buttons follow it too",
          page.evaluate("[...document.querySelectorAll('.player-tile .player-tile__name')].map(e=>e.textContent)"),
          ["Nikola","Marko"])

    # Rule 7: logging a possession must not reshuffle anything.
    page.click('.player-tile:has-text("Marko")')
    page.click('.outcome-row button:has-text("2PT Miss")'); page.wait_for_timeout(600)
    check("buttons did not move after a possession",
          page.evaluate("[...document.querySelectorAll('.player-tile .player-tile__name')].map(e=>e.textContent)"),
          ["Nikola","Marko"])

    check("no console errors", errs, [])
    b.close()
srv.terminate()
print("\n" + ("ALL PASS" if all(results) else f"{results.count(False)} FAILED"))
