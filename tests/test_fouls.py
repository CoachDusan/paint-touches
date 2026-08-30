"""Fouls: logged and counted, but never divided into PPP.

A non-shooting foul doesn't end the trip down the floor — the ball comes
back in and play continues. So a foul must never land in a PPP denominator
(that would punish an offense for drawing them and flatter a defense for
committing them), while still being counted everywhere a count is honest:
the foul tiles, and the breakdown that caused it.
"""

import json, subprocess, time, urllib.request
from playwright.sync_api import sync_playwright

import os, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(tempfile.gettempdir(), "paint-touches-tests") + os.sep
os.makedirs(OUT, exist_ok=True)

PORT = 8788

srv = subprocess.Popen(["python3", "-m", "http.server", str(PORT)], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(40):
    try:
        urllib.request.urlopen(f"http://localhost:{PORT}/index.html", timeout=1); break
    except Exception: time.sleep(0.25)

def touch(pid, name, num):
    return {"playerId": pid, "playerName": name, "playerNumber": num, "timestamp": 1}

HORNS = {"playId": "A", "playName": "Horns"}
DROP = {"coverageId": "c1", "coverageName": "Drop"}
UNDER = {"mistakeId": "m1", "mistakeName": "Guard went under"}
CLEAN = {"mistakeId": "none", "mistakeName": "No mistake"}

# 4 offensive trips, one of them a foul: 3 possessions, 5 points.
OFFENSE = [
    {"side":"offense","quarter":"1","play":HORNS,"touches":[touch("p1","Marko","4")],
     "outcome":"2PM","points":2},
    {"side":"offense","quarter":"1","play":HORNS,"touches":[touch("p1","Marko","4"),touch("p2","Luka","5")],
     "outcome":"FOUL","points":0},
    {"side":"offense","quarter":"2","play":HORNS,"touches":[],
     "outcome":"TO","points":0},
    {"side":"offense","quarter":"2","play":HORNS,"touches":[touch("p2","Luka","5")],
     "outcome":"3PM","points":3},
]

# 3 defensive trips, one a foul on a broken coverage: 2 possessions, 3 allowed.
DEFENSE = [
    {"side":"defense","quarter":"1","play":None,"touches":[],"coverage":DROP,
     "mistake":UNDER,"mistakePlayer":touch("p1","Marko","4"),"outcome":"3PM","points":3},
    {"side":"defense","quarter":"1","play":None,"touches":[],"coverage":DROP,
     "mistake":UNDER,"mistakePlayer":touch("p1","Marko","4"),"outcome":"FOUL","points":0},
    {"side":"defense","quarter":"2","play":None,"touches":[],"coverage":DROP,
     "mistake":CLEAN,"mistakePlayer":None,"outcome":"TO","points":0},
]

ALL = OFFENSE + DEFENSE

with sync_playwright() as pw:
    b = pw.chromium.launch()
    page = b.new_page()
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(f"http://localhost:{PORT}/index.html")
    data = page.evaluate("""async (poss) => {
        const s = await import('/js/stats.js');
        const e = await import('/js/export.js');
        const p = await import('/js/possession.js');
        return {
          off: s.computeStats(poss),
          def: s.computeDefenseStats(poss),
          summary: e.buildSummaryText({ title: "Foul test", possessions: poss }),
          foulPoints: p.pointsForOutcome("FOUL"),
          outcomes: p.OUTCOMES,
          tone: p.OUTCOME_TONES["FOUL"],
          label: p.OUTCOME_LABELS["FOUL"],
          defLabels: p.DEFENSE_OUTCOME_LABELS,
        };
    }""", ALL)
    b.close()

srv.terminate()

def check(label, got, want):
    ok = got == want
    print(("PASS  " if ok else "FAIL  ") + f"{label}: got {got!r}, want {want!r}")
    return ok

results = []

# --- the vocabulary itself ---
results.append(check("FOUL is an outcome", "FOUL" in data["outcomes"], True))
results.append(check("a foul is worth nothing", data["foulPoints"], 0))
results.append(check("foul reads as 'Foul'", data["label"], "Foul"))
results.append(check("foul is blue", data["tone"], "foul"))
results.append(check("defence says Made, not Allowed",
                     [data["defLabels"]["2PM"], data["defLabels"]["3PM"]], ["2PT Made", "3PT Made"]))

# --- offence: the foul is counted, but not divided into ---
o = data["off"]["overall"]
results.append(check("offence trips include the foul", o["trips"], 4))
results.append(check("offence possessions exclude the foul", o["possessions"], 3))
results.append(check("fouls drawn counted", o["fouls"], 1))
results.append(check("PPP divides by possessions, not trips", round(o["ppp"], 4), round(5/3, 4)))
results.append(check("TO rate divides by possessions", round(o["toRate"], 4), round(1/3, 4)))

pl = {x["name"]: x for x in data["off"]["byPlay"]}
results.append(check("play possessions exclude the foul", pl["Horns"]["possessions"], 3))
results.append(check("touch rate can't exceed 1", round(pl["Horns"]["touchRate"], 4), round(2/3, 4)))

py = {x["name"]: x for x in data["off"]["byPlayer"]}
results.append(check("a touch on a foul still counts as a touch", py["Marko"]["touches"], 2))
results.append(check("but not as a possession he touched", py["Marko"]["possessionsTouched"], 1))
results.append(check("so his PPP isn't dragged down by it", round(py["Marko"]["ppp"], 2), 2.0))

# --- defence: same rule, and the breakdown still gets counted ---
d = data["def"]["overall"]
results.append(check("defence trips include the foul", d["trips"], 3))
results.append(check("defence possessions exclude the foul", d["possessions"], 2))
results.append(check("fouls committed counted", d["fouls"], 1))
results.append(check("PPP allowed divides by possessions", round(d["ppp"], 4), round(3/2, 4)))
results.append(check("clean rate is a share of every trip", round(d["cleanRate"], 4), round(1/3, 4)))
results.append(check("breakdowns counted per trip", d["mistakes"], 2))

bm = {x["name"]: x for x in data["def"]["byMistake"]}
results.append(check("a breakdown that ended in a foul is still a breakdown",
                     bm["Guard went under"]["count"], 2))
results.append(check("but its PPP divides only by possessions",
                     bm["Guard went under"]["possessions"], 1))

cov = {x["name"]: x for x in data["def"]["byCoverage"]}
results.append(check("coverage possessions exclude the foul", cov["Drop"]["possessions"], 2))
results.append(check("coverage trips include it", cov["Drop"]["trips"], 3))
results.append(check("coverage fouls counted", cov["Drop"]["fouls"], 1))

bp = {x["name"]: x for x in data["def"]["byPlayer"]}
results.append(check("player's breakdown count includes the foul one", bp["Marko"]["mistakes"], 2))

# --- the shared summary says so out loud ---
s = data["summary"]
results.append(check("summary PPP over possessions only", "PPP 1.67 · 3 poss · 5 pts" in s, True))
results.append(check("summary reports fouls drawn", "Fouls drawn 1 (not in PPP)" in s, True))
results.append(check("summary reports defensive fouls", "Fouls 1 (not in PPP)" in s, True))
results.append(check("summary explains why they're out of PPP",
                     "Fouls are counted but not divided into PPP" in s, True))

results.append(check("no console errors", errors, []))
print("\n" + ("ALL PASS" if all(results) else f"{results.count(False)} FAILED"))
