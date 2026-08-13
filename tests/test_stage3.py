import subprocess, time, urllib.request, json
from playwright.sync_api import sync_playwright

import os, sys, tempfile

# Repo root is the parent of tests/, so these run from anywhere.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Screenshots and scratch files go to a temp dir, never into the repo.
OUT = os.path.join(tempfile.gettempdir(), "paint-touches-tests") + os.sep
os.makedirs(OUT, exist_ok=True)


PORT = 8784
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

def d(pid,name,num,cov,mis,player,outcome,points,quarter="1"):
    return {"gameId":"g1","quarter":quarter,"sequenceNumber":pid,"side":"defense",
            "coverage":cov,"mistake":mis,"mistakePlayer":player,"play":None,"touches":[],
            "outcome":outcome,"points":points,"andOne":None,"ftAttempt":None}

DROP={"coverageId":"c1","coverageName":"Drop"}
SW={"coverageId":"c2","coverageName":"Switch"}
CLEAN={"mistakeId":"none","mistakeName":"No mistake"}
UNDER={"mistakeId":"m1","mistakeName":"Guard went under the screen"}
BLOWN={"mistakeId":"m2","mistakeName":"Blown switch"}
MARKO={"playerId":"p1","playerName":"Marko","playerNumber":"4"}
LUKA={"playerId":"p2","playerName":"Luka","playerNumber":"5"}

POSS = [
  # One offensive possession, so we can prove the two sides stay separate.
  {"gameId":"g1","quarter":"1","sequenceNumber":0,"side":"offense",
   "play":{"playId":"py1","playName":"Horns"},
   "touches":[{"playerId":"p1","playerName":"Marko","playerNumber":"4","timestamp":1}],
   "outcome":"2PM","points":2,"andOne":None,"ftAttempt":None},
  d(1,None,None,DROP,CLEAN,None,"2PA",0),
  d(2,None,None,DROP,UNDER,MARKO,"3PM",3),
  d(3,None,None,SW,BLOWN,LUKA,"2PM",2,quarter="2"),
  d(4,None,None,DROP,CLEAN,None,"TO",0),
  # A breakdown nobody was tagged for.
  d(5,None,None,SW,BLOWN,None,"2PM",2,quarter="2"),
]

with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width":1024,"height":768}, device_scale_factor=2)
    page = ctx.new_page()
    errs = []
    page.on("console", lambda m: errs.append(m.text) if m.type=="error" else None)
    page.goto(f"http://localhost:{PORT}/index.html", wait_until="networkidle")
    page.wait_for_timeout(600)

    st = page.evaluate("""async (poss) => {
        const m = await import('/js/stats.js');
        return { off: m.computeStats(poss), def: m.computeDefenseStats(poss) };
    }""", POSS)
    off, dfn = st["off"], st["def"]

    check("offense untouched by 5 defensive possessions", off["overall"]["possessions"], 1)
    check("offense points untouched", off["overall"]["points"], 2)

    o = dfn["overall"]
    check("defensive possessions counted", o["possessions"], 5)
    check("points allowed", o["points"], 7)
    check("PPP allowed", round(o["ppp"],3), round(7/5,3))
    check("forced turnovers", o["forcedTurnovers"], 1)
    check("clean rate", round(o["cleanRate"],3), round(2/5,3))
    check("breakdown count", o["mistakes"], 3)
    check("unassigned breakdown surfaced", o["unassigned"], 1)

    es = dfn["executionSplit"]
    check("PPP when clean", round(es["clean"]["ppp"],3), 0.0)
    check("PPP when broken", round(es["broken"]["ppp"],3), round(7/3,3))

    cov = {c["name"]: c for c in dfn["byCoverage"]}
    check("Drop possessions", cov["Drop"]["possessions"], 3)
    check("Drop PPP allowed", round(cov["Drop"]["ppp"],3), 1.0)
    check("Drop clean rate", round(cov["Drop"]["cleanRate"],3), round(2/3,3))
    check("Drop forced TO rate", round(cov["Drop"]["forcedTurnoverRate"],3), round(1/3,3))
    check("Switch PPP allowed", round(cov["Switch"]["ppp"],3), 2.0)
    check("Switch clean rate", cov["Switch"]["cleanRate"], 0.0)

    mis = {m["name"]: m for m in dfn["byMistake"]}
    check("clean possessions excluded from breakdown table", "No mistake" in mis, False)
    check("blown switch counted twice", mis["Blown switch"]["count"], 2)
    check("blown switch PPP", round(mis["Blown switch"]["ppp"],3), 2.0)

    ply = {p["name"]: p for p in dfn["byPlayer"]}
    check("Marko breakdowns", ply["Marko"]["mistakes"], 1)
    check("Marko PPP allowed on those", round(ply["Marko"]["ppp"],3), 3.0)
    check("unassigned breakdown not attributed to anyone", sum(p["mistakes"] for p in dfn["byPlayer"]), 2)

    q = {x["quarter"]: x for x in dfn["byQuarter"]}
    check("Q2 defensive possessions", q["2"]["possessions"], 2)
    check("Q2 breakdowns", q["2"]["mistakes"], 2)

    # --- Render the panel ---
    page.evaluate("""async (poss) => {
        const { renderGameStats } = await import('/js/views/game-stats.js');
        const root = document.getElementById('view-root');
        root.innerHTML = '';
        root.appendChild(renderGameStats(poss));
    }""", POSS)
    page.wait_for_timeout(400)
    check("stats toggle labels", page.evaluate("[...document.querySelectorAll('.stats-toggle .segmented__btn')].map(b=>b.textContent)"),
          ["Offense (1)","Defense (5)"])
    page.click('.stats-toggle .segmented__btn[data-stats-side=defense]'); page.wait_for_timeout(400)

    def tile(label):
        return page.evaluate("""(l)=>{const t=[...document.querySelectorAll('.stat-tile')]
          .find(x=>x.querySelector('.stat-tile__label').textContent.trim().toLowerCase()===l.toLowerCase());
          return t?t.querySelector('.stat-tile__value').textContent.trim():null;}""", label)
    check("PPP allowed tile", tile("PPP allowed"), "1.40")
    check("forced TOs tile", tile("Forced TOs"), "1")
    check("executed clean tile", tile("Executed clean"), "40%")
    check("PPP when broken tile", tile("PPP when broken"), "2.33")
    check("unassigned warning rendered", "1 breakdown logged without a player" in page.text_content(".stats-panel"), True)
    check("per-player caveat present", "can't be turned into a rate" in page.text_content(".stats-panel"), True)
    check("no horizontal overflow",
          page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth"), False)
    page.screenshot(path=OUT+"stage3-defense-stats.png", full_page=True)

    # --- Regression: does the quarter selector still look right? ---
    page.goto(f"http://localhost:{PORT}/index.html", wait_until="networkidle")
    page.wait_for_timeout(600)
    page.click('.tab-bar button[data-view="roster"]')
    page.click('.list-toolbar button'); page.fill('.entity-form [name="number"]', "4")
    page.fill('.entity-form [name="name"]', "Marko")
    page.click('.entity-form button[type="submit"]'); page.wait_for_timeout(300)
    page.click('.tab-bar button[data-view="game"]')
    page.fill('[name="opponent"]', "Layout Check")
    page.click('button:has-text("Start Game")'); page.wait_for_timeout(600)
    page.screenshot(path=OUT+"stage3-game-top.png")
    check("quarter selector still shows 5 buttons",
          page.evaluate("document.querySelectorAll('.list-toolbar .segmented .segmented__btn').length"), 5)
    check("game screen has no horizontal overflow",
          page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth"), False)

    check("no console errors", errs, [])
    b.close()
srv.terminate()
print("\n" + ("ALL PASS" if all(results) else f"{results.count(False)} FAILED"))
