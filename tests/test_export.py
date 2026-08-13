import subprocess, time, urllib.request, json, os
from playwright.sync_api import sync_playwright

import os, sys, tempfile

# Repo root is the parent of tests/, so these run from anywhere.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Screenshots and scratch files go to a temp dir, never into the repo.
OUT = os.path.join(tempfile.gettempdir(), "paint-touches-tests") + os.sep
os.makedirs(OUT, exist_ok=True)


PORT = 8789
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

GAME = {"id":"gA","date":"2026-01-05","opponent":"Alpha, HS","venue":"home",
        "ourScore":70,"theirScore":60,"status":"completed"}
POSS = [
  {"gameId":"gA","quarter":"1","sequenceNumber":1,"side":"offense",
   "play":{"playId":"py1","playName":'5 "Out"'},
   "touches":[{"playerId":"p1","playerName":"Marko","playerNumber":"4","timestamp":1}],
   "outcome":"2PM","points":2},
  {"gameId":"gA","quarter":"1","sequenceNumber":2,"side":"offense",
   "play":{"playId":"py1","playName":'5 "Out"'},"touches":[],"outcome":"TO","points":0},
  {"gameId":"gA","quarter":"2","sequenceNumber":3,"side":"defense",
   "coverage":{"coverageId":"c1","coverageName":"Drop"},
   "mistake":{"mistakeId":"m1","mistakeName":"Guard went under"},
   "mistakePlayer":{"playerId":"p2","playerName":"Luka","playerNumber":"5"},
   "play":None,"touches":[],"outcome":"3PM","points":3},
]
TAGS = [{"gameId":"gA","quarter":"3","tagId":"t1","tagName":"Lazy box-out",
         "playerId":"p1","playerName":"Marko","playerNumber":"4","loggedAt":1}]

with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width":1024,"height":768},
                        permissions=["clipboard-read","clipboard-write"])
    page = ctx.new_page()
    errs = []
    page.on("console", lambda m: errs.append(m.text) if m.type=="error" else None)
    page.on("dialog", lambda d: d.accept())
    page.goto(f"http://localhost:{PORT}/index.html", wait_until="networkidle")
    page.wait_for_timeout(700)

    # ---------- Summary text ----------
    text = page.evaluate("""async ([game, poss, tags]) => {
        const m = await import('/js/export.js');
        return m.buildGameSummaryText(game, poss, tags);
    }""", [GAME, POSS, TAGS])
    check("summary titles the game", "vs Alpha, HS — Jan 5, 2026 (Home)" in text, True)
    check("summary shows the final score", "Final: 70–60 (W)" in text, True)
    check("summary offense PPP over logged possessions only", "PPP 1.00 · 2 poss · 2 pts" in text, True)
    check("summary defense reads as allowed", "PPP allowed 3.00 · 1 poss" in text, True)
    check("summary lists breakdowns", "• Guard went under — 1 (100%)" in text, True)
    check("summary includes quick tags", "LAZY BOX-OUT — 1" in text, True)
    check("summary warns it isn't the box score",
          "Counts only tracked possessions" in text, True)
    open(OUT+"summary.txt","w").write(text)

    # ---------- CSV ----------
    csv = page.evaluate("""async ([game, poss, tags]) => {
        const m = await import('/js/export.js');
        return m.buildCSV([{ game, possessions: poss, tagEvents: tags }]);
    }""", [GAME, POSS, TAGS])
    lines = csv.split("\n")
    check("csv header", lines[0].split(",")[:4], ["record_type","game_date","opponent","venue"])
    check("csv has a row per record", len(lines), 5)
    check("comma in opponent name doesn't split the row", lines[1].count('","') >= 5, True)
    check("quotes inside a play name are escaped", '"5 ""Out"""' in lines[1], True)
    check("possession rows tagged", lines[1].startswith('"possession"'), True)
    check("tag row tagged", lines[4].startswith('"tag"'), True)
    check("tag row carries the player", '"#4 Marko"' in lines[4], True)
    check("defensive row carries coverage and culprit",
          '"Drop"' in lines[3] and '"#5 Luka"' in lines[3], True)
    open(OUT+"export.csv","w").write(csv)

    # ---------- Backup validation ----------
    checks = page.evaluate("""async () => {
        const m = await import('/js/export.js');
        const out = {};
        out.notJson = m.parseBackup("hello").ok;
        out.wrongApp = m.parseBackup(JSON.stringify({app:"something-else"})).ok;
        out.wrongFormat = m.parseBackup(JSON.stringify({app:"paint-touches",format:99,data:{}})).ok;
        out.badStore = m.parseBackup(JSON.stringify({app:"paint-touches",format:1,data:{players:"nope"}})).ok;
        const good = m.buildBackup({ players:[{id:"p1"}], games:[{id:"g1"}], possessions:[] });
        const parsed = m.parseBackup(good);
        out.goodOk = parsed.ok;
        out.goodCounts = parsed.counts.players + "/" + parsed.counts.games;
        out.filename = m.backupFilename(new Date("2026-03-04T10:00:00Z"));
        return out;
    }""")
    check("rejects non-JSON", checks["notJson"], False)
    check("rejects another app's file", checks["wrongApp"], False)
    check("rejects a future format", checks["wrongFormat"], False)
    check("rejects a damaged store", checks["badStore"], False)
    check("accepts its own backup", checks["goodOk"], True)
    check("counts what's inside", checks["goodCounts"], "1/1")
    check("filename is dated", checks["filename"], "paint-touches-backup-2026-03-04.json")

    # ---------- Share falls back to the clipboard ----------
    copied = page.evaluate("""async () => {
        const m = await import('/js/share.js');
        const hadShare = navigator.share;
        delete navigator.share;          // pretend we're on a browser without it
        const res = await m.shareText("hello coaches", "t");
        if (hadShare) navigator.share = hadShare;
        return [res.ok, res.how, await navigator.clipboard.readText()];
    }""")
    check("share falls back to clipboard", copied[:2], [True, "clipboard"])
    check("clipboard got the text", copied[2], "hello coaches")

    # ---------- A dismissed share sheet is not a failure ----------
    aborted = page.evaluate("""async () => {
        const m = await import('/js/share.js');
        const had = navigator.share;
        navigator.share = () => Promise.reject(Object.assign(new Error("x"), {name:"AbortError"}));
        const res = await m.shareText("text", "t");
        if (had) navigator.share = had; else delete navigator.share;
        return [res.ok, res.how];
    }""")
    check("cancelling the share sheet isn't treated as an error", aborted, [True, "cancelled"])

    # ---------- Real UI: build a game, then export it ----------
    page.click('.tab-bar button[data-view="roster"]')
    page.click('.list-toolbar button'); page.fill('.entity-form [name="number"]', "4")
    page.fill('.entity-form [name="name"]', "Marko")
    page.click('.entity-form button[type="submit"]'); page.wait_for_timeout(300)
    page.click('.tab-bar button[data-view="game"]')
    page.fill('[name="opponent"]', "Export HS")
    page.click('button:has-text("Start Game")'); page.wait_for_timeout(600)
    page.click('.player-tile:has-text("Marko")')
    page.click('.outcome-row button:has-text("2PT Made")'); page.wait_for_timeout(250)
    page.click('.outcome-sheet button:has-text("Skip")'); page.wait_for_timeout(400)
    page.click('button:has-text("End Game")'); page.wait_for_timeout(400)
    page.fill('.end-game [name="ourScore"]', "80")
    page.fill('.end-game [name="theirScore"]', "70")
    page.click('button:has-text("Save & End")'); page.wait_for_timeout(900)

    page.click('.tab-bar button[data-view="history"]'); page.wait_for_timeout(700)
    page.click('.list-row--tappable:has-text("Export HS")'); page.wait_for_timeout(700)
    check("game detail offers all three exports",
          page.evaluate("[...document.querySelectorAll('.export-actions button')].map(b=>b.textContent)"),
          ["Share summary","Spreadsheet (CSV)","Print / PDF"])

    page.click('.tab-bar button[data-view="season"]'); page.wait_for_timeout(900)
    check("season offers exports too",
          page.evaluate("!!document.querySelector('.export-actions')"), True)
    check("season offers backup and restore",
          page.evaluate("""[...document.querySelectorAll('button')].map(b=>b.textContent)
              .filter(t=>t==='Back up everything'||t==='Restore from file')"""),
          ["Back up everything","Restore from file"])
    page.screenshot(path=OUT+"export-season.png", full_page=True)

    # ---------- Restore round trip ----------
    backup = page.evaluate("""async () => {
        const { Backup } = await import('/js/models.js');
        const { buildBackup, BACKUP_STORES } = await import('/js/export.js');
        return buildBackup(await Backup.readAll(BACKUP_STORES));
    }""")
    path = OUT + "roundtrip-backup.json"
    open(path, "w").write(backup)
    check("backup captured the game",
          len(json.loads(backup)["data"]["games"]), 1)

    # Wipe everything, then restore from the file.
    page.evaluate("""async () => {
        const { Backup } = await import('/js/models.js');
        const { BACKUP_STORES } = await import('/js/export.js');
        await Backup.replaceAll(BACKUP_STORES, {});
    }""")
    counts = page.evaluate("""async () => {
        const { Backup } = await import('/js/models.js');
        const d = await Backup.readAll(["games","players","possessions"]);
        return [d.games.length, d.players.length, d.possessions.length];
    }""")
    check("wiped clean before restoring", counts, [0,0,0])

    page.set_input_files('input[type=file]', path)
    page.wait_for_timeout(2500)  # confirm auto-accepted, then a reload

    restored = page.evaluate("""async () => {
        const { Backup } = await import('/js/models.js');
        const d = await Backup.readAll(["games","players","possessions","quickTags"]);
        return { games: d.games.length, players: d.players.length,
                 poss: d.possessions.length, opponent: d.games[0]?.opponent,
                 score: [d.games[0]?.ourScore, d.games[0]?.theirScore],
                 tags: d.quickTags.length };
    }""")
    check("restored the game", restored["games"], 1)
    check("restored the opponent", restored["opponent"], "Export HS")
    check("restored the score", restored["score"], [80,70])
    check("restored the player", restored["players"], 1)
    check("restored the possession", restored["poss"], 1)
    check("restored the quick tag list", restored["tags"], 1)

    real = [e for e in errs if "ERR_INTERNET_DISCONNECTED" not in e]
    check("no console errors", real, [])
    b.close()
srv.terminate()
print("\n" + ("ALL PASS" if all(results) else f"{results.count(False)} FAILED"))
