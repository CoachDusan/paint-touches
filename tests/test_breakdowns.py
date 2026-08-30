import subprocess, time, urllib.request, json
from playwright.sync_api import sync_playwright

import os, sys, tempfile

# Repo root is the parent of tests/, so these run from anywhere.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Screenshots and scratch files go to a temp dir, never into the repo.
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

WEAK = {"coverageId":"cW","coverageName":"Weak"}
SWITCH = {"coverageId":"cS","coverageName":"Switch"}
CLEAN = {"mistakeId":"none","mistakeName":"No mistake"}
M_UNDER = {"mistakeId":"m1","mistakeName":"Guard went under"}
M_TAG   = {"mistakeId":"m2","mistakeName":"No tag on the roller"}
M_BLOWN = {"mistakeId":"m3","mistakeName":"Blown switch"}
LUKA = {"playerId":"p2","playerName":"Luka","playerNumber":"5"}
MARKO = {"playerId":"p1","playerName":"Marko","playerNumber":"4"}

START = 1767225600000  # game start reference
def dp(seq, cov, mis, player, outcome, pts, quarter, minutes):
    at = START + minutes * 60000
    return {"gameId":"g1","quarter":quarter,"sequenceNumber":seq,"side":"defense",
            "coverage":cov,"mistake":mis,"mistakePlayer":player,"play":None,"touches":[],
            "outcome":outcome,"points":pts,"andOne":None,"ftAttempt":None,
            "startedAt":at,"closedAt":at}

# Weak: 3 breakdowns (2 under, 1 tag). Switch: 2 blown switches. Plus 2 clean.
POSS = [
  dp(1, WEAK,   M_UNDER, LUKA,  "3PM", 3, "1", 5),
  dp(2, WEAK,   M_UNDER, MARKO, "2PM", 2, "2", 14),
  dp(3, WEAK,   M_TAG,   LUKA,  "2PM", 2, "3", 26),
  dp(4, WEAK,   CLEAN,   None,  "2PA", 0, "1", 7),
  dp(5, SWITCH, M_BLOWN, LUKA,  "3PM", 3, "2", 18),
  dp(6, SWITCH, M_BLOWN, MARKO, "2PA", 0, "4", 35),
  dp(7, SWITCH, CLEAN,   None,  "TO",  0, "4", 38),
]

with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width":1024,"height":768}, device_scale_factor=2)
    page = ctx.new_page()
    errs = []
    page.on("console", lambda m: errs.append(m.text) if m.type=="error" else None)
    page.goto(f"http://localhost:{PORT}/index.html", wait_until="networkidle")
    page.wait_for_timeout(700)

    # ---------- Breakdowns grouped under their coverage ----------
    st = page.evaluate("""async (poss) => {
        const m = await import('/js/stats.js');
        return m.computeDefenseStats(poss);
    }""", POSS)
    cov = {c["name"]: c for c in st["byCoverage"]}
    check("Weak's breakdowns listed under Weak",
          [(m["name"], m["count"]) for m in cov["Weak"]["breakdowns"]],
          [("Guard went under", 2), ("No tag on the roller", 1)])
    check("Switch's breakdowns listed under Switch",
          [(m["name"], m["count"]) for m in cov["Switch"]["breakdowns"]],
          [("Blown switch", 2)])
    check("a breakdown's share is of its own coverage, not the whole game",
          round(cov["Weak"]["breakdowns"][0]["share"], 3), round(2/4, 3))
    check("clean possessions don't appear as breakdowns",
          any(m["name"] == "No mistake" for m in cov["Weak"]["breakdowns"]), False)
    check("per-breakdown PPP allowed within a coverage",
          round(cov["Switch"]["breakdowns"][0]["ppp"], 2), 1.5)

    # ---------- Which player made which mistake ----------
    ply = {p["name"]: p for p in st["byPlayer"]}
    check("Luka's mistakes broken down by type",
          [(m["name"], m["count"]) for m in ply["Luka"]["breakdowns"]],
          [("Guard went under", 1), ("No tag on the roller", 1), ("Blown switch", 1)])
    check("Marko's mistakes broken down by type",
          [(m["name"], m["count"]) for m in ply["Marko"]["breakdowns"]],
          [("Guard went under", 1), ("Blown switch", 1)])
    check("totals still agree with the breakdown", ply["Luka"]["mistakes"], 3)

    # ---------- Clip list ----------
    clips = ply["Luka"]["clips"]
    check("a clip per breakdown", len(clips), 3)
    check("clips ordered by quarter then time",
          [(c["quarter"], c["mistakeName"]) for c in clips],
          [("1","Guard went under"), ("2","Blown switch"), ("3","No tag on the roller")])
    check("clips carry the coverage", clips[1]["coverageName"], "Switch")
    check("clips carry a timestamp", clips[0]["at"], START + 5*60000)

    fmt = page.evaluate("""async ([at, start]) => {
        const u = await import('/js/utils.js');
        return [u.formatElapsed(at, start), u.formatElapsed(at, null)];
    }""", [START + 14*60000 + 20000, START])
    check("elapsed formatted as minutes:seconds", fmt[0], "14:20")
    check("elapsed omitted when there's no known start", fmt[1], None)

    # ---------- Rendered panel ----------
    page.evaluate("""async ([poss, start]) => {
        const { renderGameStats } = await import('/js/views/game-stats.js');
        const root = document.getElementById('view-root');
        root.innerHTML = '';
        root.appendChild(renderGameStats(poss, [], { gameStart: start }));
    }""", [POSS, START])
    page.wait_for_timeout(300)
    page.click('.stats-toggle .segmented__btn[data-stats-side=defense]'); page.wait_for_timeout(400)

    heads = page.evaluate("[...document.querySelectorAll('.section-label')].map(e=>e.textContent)")
    check("coverage breakdown section rendered", "Breakdowns by coverage" in heads, True)
    check("player section rendered", "Breakdowns by player" in heads, True)

    check("clips hidden until asked for",
          page.evaluate("[...document.querySelectorAll('.clip-list')].every(c=>c.hidden)"), True)
    check("toggle shows the clip count",
          page.evaluate("""[...document.querySelectorAll('.group-block__head button')].map(b=>b.textContent)"""),
          ["Clips (3)","Clips (2)"])
    page.click('.group-block__head button')
    page.wait_for_timeout(300)
    check("first clip list opens",
          page.evaluate("!document.querySelector('.clip-list').hidden"), True)
    check("toggle flips its label",
          page.evaluate("document.querySelector('.group-block__head button').textContent"), "Hide clips")
    check("clips grouped by quarter",
          page.evaluate("""[...document.querySelector('.clip-list').querySelectorAll('.clip-group__head')].map(e=>e.textContent)"""),
          ["Q1","Q2","Q3"])
    check("a clip shows an elapsed pill",
          page.evaluate("""[...document.querySelector('.clip').querySelectorAll('.pill')].map(e=>e.textContent).includes('5:00 in')"""), True)
    check("the tap-delay caveat is on screen",
          "seek back a few seconds" in page.text_content(".stats-panel"), True)
    page.screenshot(path=OUT+"breakdowns.png", full_page=True)

    page.click('.group-block__head button'); page.wait_for_timeout(250)
    check("clips close again",
          page.evaluate("document.querySelector('.clip-list').hidden"), True)

    # ---------- Live picker narrows to the chosen coverage ----------
    page.goto(f"http://localhost:{PORT}/index.html", wait_until="networkidle")
    page.wait_for_timeout(800)
    page.click('.tab-bar button[data-view="roster"]')
    page.click('.list-toolbar button:has-text("+ Add")'); page.fill('.entity-form [name="number"]', "5")
    page.fill('.entity-form [name="name"]', "Luka")
    page.click('.entity-form button[type="submit"]'); page.wait_for_timeout(300)

    # Assign "Guard went under the screen" to Drop only.
    page.click('.tab-bar button[data-view="playbook"]'); page.wait_for_timeout(400)
    page.click('.segmented__btn:has-text("Mistakes")'); page.wait_for_timeout(500)
    page.click('.entity-list li:has-text("Guard went under the screen") button:has-text("Edit")')
    page.wait_for_timeout(400)
    check("edit form offers coverage assignment",
          page.evaluate("""[...document.querySelectorAll('.entity-form .chip')].map(c=>c.textContent).slice(0,2)"""),
          ["Any coverage","Drop"])
    check("Any is selected by default for an unassigned mistake",
          page.evaluate("""document.querySelector('.entity-form .chip').classList.contains('is-active')"""), True)
    page.click('.entity-form .chip:has-text("Drop")'); page.wait_for_timeout(250)
    check("picking a coverage clears Any",
          page.evaluate("""document.querySelector('.entity-form .chip').classList.contains('is-active')"""), False)
    page.click('.entity-form button[type="submit"]'); page.wait_for_timeout(600)
    check("row shows its assignment",
          "Drop" in page.text_content('.entity-list li:has-text("Guard went under the screen")'), True)

    stored = page.evaluate("""() => new Promise(r => {
      const req = indexedDB.open("paint-touches");
      req.onsuccess = () => { const db=req.result;
        const q = db.transaction("mistakes").objectStore("mistakes").getAll();
        q.onsuccess = () => { db.close();
          r(q.result.filter(m=>m.coverageIds && m.coverageIds.length).map(m=>[m.name, m.coverageIds.length])); }; };
    })""")
    check("assignment persisted", stored, [["Guard went under the screen", 1]])

    page.click('.tab-bar button[data-view="game"]'); page.wait_for_timeout(400)
    page.fill('[name="opponent"]', "Filter HS")
    page.click('button:has-text("Start Game")'); page.wait_for_timeout(600)
    page.click('.side-toggle .segmented__btn[data-side=defense]'); page.wait_for_timeout(400)

    def offered():
        return page.evaluate("""() => {
          const card = [...document.querySelectorAll('.card')]
            .find(c => c.textContent.includes('What broke down?'));
          return [...card.querySelectorAll('.chip')].map(c => c.textContent);
        }""")

    page.click('.chip:has-text("Drop")'); page.wait_for_timeout(350)
    onDrop = offered()
    check("Drop still offers its assigned breakdown", "Guard went under the screen" in onDrop, True)
    check("Drop keeps the unassigned ones too", "Foul" in onDrop, True)

    page.click('.chip:has-text("Switch")'); page.wait_for_timeout(350)
    onSwitch = offered()
    check("Switch no longer offers the Drop-only breakdown",
          "Guard went under the screen" in onSwitch, False)
    check("Switch keeps the unassigned ones", "Foul" in onSwitch, True)
    check("Switch's list is shorter than Drop's", len(onSwitch) < len(onDrop), True)
    check("No mistake is always offered", "No mistake" in onSwitch, True)

    check("no console errors", errs, [])
    b.close()
srv.terminate()
print("\n" + ("ALL PASS" if all(results) else f"{results.count(False)} FAILED"))
