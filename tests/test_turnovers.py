import json, subprocess, time, urllib.request
from playwright.sync_api import sync_playwright

import os, sys, tempfile

# Repo root is the parent of tests/, so these run from anywhere.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Screenshots and scratch files go to a temp dir, never into the repo.
OUT = os.path.join(tempfile.gettempdir(), "paint-touches-tests") + os.sep
os.makedirs(OUT, exist_ok=True)


PORT = 8777

srv = subprocess.Popen(["python3", "-m", "http.server", str(PORT)], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(40):
    try:
        urllib.request.urlopen(f"http://localhost:{PORT}/index.html", timeout=1); break
    except Exception: time.sleep(0.25)

def touch(pid, name, num):
    return {"playerId": pid, "playerName": name, "playerNumber": num, "timestamp": 1}

# Synthetic game: 8 possessions, 3 of them turnovers.
POSS = [
    # Q1, Play A, touches by #4 and #5, made two
    {"quarter":"1","play":{"playId":"A","playName":"Horns"},"touches":[touch("p1","Marko","4"),touch("p2","Luka","5")],"outcome":"2PM","points":2},
    # Q1, Play A, touch by #4, TURNOVER
    {"quarter":"1","play":{"playId":"A","playName":"Horns"},"touches":[touch("p1","Marko","4")],"outcome":"TO","points":0},
    # Q1, Transition, NO touches, TURNOVER
    {"quarter":"1","play":{"playId":None,"playName":"Transition / No Play"},"touches":[],"outcome":"TO","points":0},
    # Q2, Play B, no touches, missed three
    {"quarter":"2","play":{"playId":"B","playName":"Flex"},"touches":[],"outcome":"3PA","points":0},
    # Q2, Play B, touch by #5, TURNOVER
    {"quarter":"2","play":{"playId":"B","playName":"Flex"},"touches":[touch("p2","Luka","5")],"outcome":"TO","points":0},
    # Q2, Play A, touches by #4 twice (same possession), made three
    {"quarter":"2","play":{"playId":"A","playName":"Horns"},"touches":[touch("p1","Marko","4"),touch("p1","Marko","4")],"outcome":"3PM","points":3},
    # Q3, Play A, touch by #5, FT 2/2
    {"quarter":"3","play":{"playId":"A","playName":"Horns"},"touches":[touch("p2","Luka","5")],"outcome":"FT","points":2},
    # Q3, Transition, no touches, missed two
    {"quarter":"3","play":{"playId":None,"playName":"Transition / No Play"},"touches":[],"outcome":"2PA","points":0},
]

with sync_playwright() as pw:
    b = pw.chromium.launch()
    page = b.new_page()
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(f"http://localhost:{PORT}/index.html")
    stats = page.evaluate("""async (poss) => {
        const m = await import('/js/stats.js');
        return m.computeStats(poss);
    }""", POSS)
    b.close()

print(json.dumps(stats, indent=2))
srv.terminate()

def check(label, got, want):
    ok = got == want
    print(("PASS  " if ok else "FAIL  ") + f"{label}: got {got!r}, want {want!r}")
    return ok

results = []
o = stats["overall"]
results.append(check("overall turnovers", o["turnovers"], 3))
results.append(check("overall possessions", o["possessions"], 8))
results.append(check("overall points", o["points"], 7))
results.append(check("overall TO rate", round(o["toRate"], 4), round(3/8, 4)))

ts = stats["touchSplit"]
results.append(check("TOs on possessions WITH touches", ts["withTouches"]["turnovers"], 2))
results.append(check("TOs on possessions WITHOUT touches", ts["noTouches"]["turnovers"], 1))
results.append(check("TO rate with touches", round(ts["withTouches"]["toRate"], 4), round(2/5, 4)))
results.append(check("TO rate no touches", round(ts["noTouches"]["toRate"], 4), round(1/3, 4)))

q = {x["quarter"]: x for x in stats["byQuarter"]}
results.append(check("Q1 turnovers", q["1"]["turnovers"], 2))
results.append(check("Q2 turnovers", q["2"]["turnovers"], 1))
results.append(check("Q3 turnovers", q["3"]["turnovers"], 0))
results.append(check("Q3 TO rate is 0 not null", q["3"]["toRate"], 0))

pl = {x["name"]: x for x in stats["byPlay"]}
results.append(check("Horns turnovers", pl["Horns"]["turnovers"], 1))
results.append(check("Flex turnovers", pl["Flex"]["turnovers"], 1))
results.append(check("Transition turnovers", pl["Transition / No Play"]["turnovers"], 1))
results.append(check("Horns TO rate (1 of 4)", round(pl["Horns"]["toRate"], 4), round(1/4, 4)))

py = {x["name"]: x for x in stats["byPlayer"]}
results.append(check("Marko touches (double-tap counted twice)", py["Marko"]["touches"], 4))
results.append(check("Marko poss. touched (double-tap counted once)", py["Marko"]["possessionsTouched"], 3))
results.append(check("Marko TOs in poss. he touched", py["Marko"]["turnovers"], 1))
results.append(check("Luka TOs in poss. he touched", py["Luka"]["turnovers"], 1))

results.append(check("no console errors", errors, []))
print("\n" + ("ALL PASS" if all(results) else f"{results.count(False)} FAILED"))
