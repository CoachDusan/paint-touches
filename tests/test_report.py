"""The coach report: the sentences it writes, and the screen it writes them on.

Two halves. First the pure builder, handed possessions of a known shape, so
what the report claims can be checked exactly — this is the half that matters,
because a report that states something the numbers don't support is worse than
no report. Then the real screen, reached the way the coach reaches it:
Season → Open the coach report.
"""

import subprocess, time, urllib.request
from playwright.sync_api import sync_playwright

import os, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(tempfile.gettempdir(), "paint-touches-tests") + os.sep
os.makedirs(OUT, exist_ok=True)

PORT = 8798
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

# Two games built to make every number checkable by hand: with a paint touch
# every possession scores 2, without one every possession is a turnover, the
# coverage run right gives up nothing and every breakdown gives up 2.
BUILD = """
() => import('/js/report.js').then((m) => {
  const poss = [];
  const add = (gameId, o) => poss.push(Object.assign({
    id: "p" + poss.length, gameId, quarter: "1", sequenceNumber: poss.length,
    side: "offense", touches: [], points: 0, andOne: null, ftAttempt: null,
    play: { playId: null, playName: "Fastbreak / No Play" },
  }, o));

  const games = [
    { id: "g1", date: "2026-09-01", opponent: "Alpha", ourScore: 80, theirScore: 70,
      status: "completed", currentQuarter: "4", createdAt: 1 },
    { id: "g2", date: "2026-09-02", opponent: "Beta", ourScore: 70, theirScore: 80,
      status: "completed", currentQuarter: "4", createdAt: 2 },
  ];

  for (const g of games) {
    for (let i = 0; i < 20; i++) {
      add(g.id, { outcome: "2PM", points: 2,
                  touches: [{ playerId: "pl1", playerName: "Marko", playerNumber: "4", timestamp: 1 }] });
      add(g.id, { outcome: "TO", points: 0 });
      add(g.id, { side: "defense", outcome: "2PA", points: 0,
                  coverage: { coverageId: "c1", coverageName: "Switch" },
                  mistake: { mistakeId: "none", mistakeName: "No mistake" } });
    }
    for (let i = 0; i < 12; i++) {
      add(g.id, { side: "defense", outcome: "2PM", points: 2,
                  coverage: { coverageId: "c1", coverageName: "Switch" },
                  mistake: { mistakeId: "m1", mistakeName: "On ball" },
                  mistakePlayer: { playerId: "pl7", playerName: "Novak", playerNumber: "7" } });
    }
  }

  const entries = games.map((game) => ({ game, possessions: poss.filter((p) => p.gameId === game.id) }));
  const r = m.buildReport(entries);
  const text = (c) => (typeof c === "string" ? c : c.text);
  const flat = (rows) => rows.map((row) => row.cells.map(text));
  return {
    offGameLog: flat(r.offense.gameLog.rows),
    plays: flat(r.offense.plays.rows),
    quarters: flat(r.offense.quarters.rows),
    offPlayers: flat(r.offense.players.rows),
    playThin: r.offense.plays.rows.map((row) => !!row.thin),
    coverages: flat(r.defense.coverages.rows),
    coverageGroups: r.defense.coverages.rows.map((row) => !!row.group),
    defGameLog: flat(r.defense.gameLog.rows),
    defPlayers: flat(r.defense.players.rows),
    splitTouch: r.offense.split.withTouch.rows,
    splitNone: r.offense.split.without.rows,
    tiles: r.tiles.map((t) => [t.value, t.label]),
    record: r.record,
    findings: r.findings.map((f) => f.lead),
    firstFinding: r.findings[0].text,
    turnoverFinding: (r.findings.find((f) => f.lead.indexOf("never reach the paint") >= 0) || {}).text,
    priorities: r.priorities.map((p) => p.lead),
    breakdownPriority: (r.priorities.find((p) => p.lead.indexOf("On ball") >= 0) || {}).text,
    winRows: r.sides.wins.rows,
    read: r.sides.read,
    caveats: r.caveats,
  };
})
"""

# Same shape, but one game only and barely any of it: nothing here is big
# enough to claim anything, and the report has to stay quiet about it.
THIN = """
() => import('/js/report.js').then((m) => {
  const game = { id: "g9", date: "2026-09-09", opponent: "Tiny", ourScore: 40, theirScore: 41,
                 status: "completed", currentQuarter: "4", createdAt: 9 };
  const possessions = [];
  for (let i = 0; i < 4; i++) {
    possessions.push({ id: "t" + i, gameId: "g9", quarter: "1", sequenceNumber: i, side: "offense",
      outcome: "2PM", points: 2, touches: [], andOne: null, ftAttempt: null,
      play: { playId: "x", playName: "Horns" } });
  }
  const r = m.buildReport([{ game, possessions }]);
  return { findings: r.findings.map((f) => f.lead), priorities: r.priorities.length, sides: r.sides };
})
"""

with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width": 1024, "height": 768}, device_scale_factor=2)
    page = ctx.new_page()
    errs = []
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(str(e)))

    page.goto(f"http://localhost:{PORT}/index.html", wait_until="networkidle")
    page.wait_for_timeout(800)

    r = page.evaluate(BUILD)

    check("overall PPP tile", r["tiles"][0], ["1.00", "Offense PPP"])
    check("touch split tile", r["tiles"][1][0], "2.00 / 0.00")
    check("paint-touch rate tile", r["tiles"][2][0], "50%")
    check("PnR PPP allowed tile", r["tiles"][3][0], "0.75")
    # 24 broken possessions, each 2.00 worse than a clean one, over two games.
    check("cost-per-game tile", r["tiles"][4][0], "≈24")
    check("record read from the scores", r["record"], {"w": 1, "l": 1, "t": 0})

    check("the paint-touch finding leads", r["findings"][0],
          "Reaching the paint is worth 2.00 points a possession.")
    check("it says how many games it held in", "held in 2 of 2 games" in r["firstFinding"], True)
    check("turnovers are attributed to the no-touch possessions",
          "40 of 40 turnovers came on them" in (r["turnoverFinding"] or ""), True)
    check("the breakdown cost is stated",
          "A pick-and-roll breakdown costs 2.00 points." in r["findings"], True)
    check("the most common breakdown is named",
          "On ball is the most common breakdown" in r["findings"], True)

    check("priorities start with the ball",
          r["priorities"][0], "Protect the ball before the paint.")
    check("the breakdown priority names who",
          "Novak 24" in (r["breakdownPriority"] or ""), True)

    check("wins panel counts free-throw trips allowed per game",
          r["winRows"][-1], ["PnR free-throw trips allowed / game", "0.0"])
    check("the read compares both sides",
          "Pick-and-roll defense allows 0.75 in wins and 0.75 in losses." in r["read"], True)
    check("the caveats say these are tracked possessions",
          "tracked possessions, not the box score" in r["caveats"], True)
    check("the caveats say defence is pick-and-roll only",
          "pick-and-roll possessions only" in r["caveats"], True)

    # --- the detail tables -------------------------------------------------
    check("a game log row per game, plus a total",
          [row[0] for row in r["offGameLog"]], ["Alpha · Sep 1, 2026", "Beta · Sep 2, 2026", "2 games"])
    check("the win is marked as a win", r["offGameLog"][0][1], "W 80–70")
    check("the total row carries the season numbers",
          r["offGameLog"][2][2:8], ["80", "1.00", "50%", "2.00", "0.00", "50%"])
    check("points logged is shown against the final score",
          r["offGameLog"][0][8], "40 of 80")

    check("the touch panel", r["splitTouch"][:3],
          [["Possessions", "40"], ["PPP", "2.00"], ["Turnover rate", "0%"]])
    check("the no-touch panel is all turnovers", r["splitNone"][2], ["Turnover rate", "100%"])
    check("PPP without turnovers has nothing left to divide", r["splitNone"][6],
          ["PPP leaving turnovers out", "—"])

    check("by play", r["plays"], [["Fastbreak / No Play", "80", "1.00", "50%", "50%", "—"]])
    check("80 possessions is not a thin sample", r["playThin"], [False])
    check("by quarter", r["quarters"], [["1st quarter", "80", "1.00", "50%", "50%", "—"]])
    check("who gets us to the paint", r["offPlayers"], [["#4 Marko", "40", "100%", "2.00", "0%"]])

    check("defense game log totals",
          # 40 clean trips of 64 is 62.5%, which rounds to 63%.
          r["defGameLog"][2][2:9], ["64", "0.75", "63%", "0.00", "2.00", "0%", "0"])
    check("the coverage groups its breakdowns", r["coverageGroups"], [True, False])
    check("the coverage row", r["coverages"][0][:4], ["Switch", "64", "0.75", "clean 63%"])
    check("the breakdown row names who makes it",
          r["coverages"][1][:5], ["— On ball", "24", "2.00", "38% of trips", "Novak 24"])
    check("breakdowns by player, across how many games",
          r["defPlayers"], [["#7 Novak", "24", "On ball 24", "2"]])

    thin = page.evaluate(THIN)
    check("nothing is claimed from four possessions", thin["findings"], [])
    check("no priorities either", thin["priorities"], 0)
    check("no wins-vs-losses panel without both", thin["sides"], None)

    # The screen, reached the way the coach reaches it.
    page.click('.tab-bar button[data-view="roster"]'); page.wait_for_timeout(400)
    page.click('.list-toolbar button:has-text("+ Add")')
    page.fill('.entity-form [name="number"]', "4")
    page.fill('.entity-form [name="name"]', "Marko")
    page.click('.entity-form button[type="submit"]'); page.wait_for_timeout(400)

    page.click('.tab-bar button[data-view="game"]'); page.wait_for_timeout(400)
    page.fill('[name="opponent"]', "Report HS")
    page.click('button:has-text("Start Game")'); page.wait_for_timeout(700)
    page.click('.live-tracking .player-tile:has-text("Marko")'); page.wait_for_timeout(350)
    page.click('.live-tracking button:has-text("2PT Miss")'); page.wait_for_timeout(500)
    page.click('button:has-text("End Game")'); page.wait_for_timeout(400)
    page.click('button:has-text("End without score")'); page.wait_for_timeout(900)

    page.click('.tab-bar button[data-view="season"]'); page.wait_for_timeout(800)
    check("Season offers the report", page.is_visible('button:has-text("Open the coach report")'), True)
    page.click('button:has-text("Open the coach report")'); page.wait_for_timeout(900)

    screen = page.text_content(".report")
    check("the report screen opens", "Coach report" in screen, True)
    check("it carries the caveats", "How to read these numbers" in screen, True)
    check("it offers a printable copy", page.is_visible('button:has-text("Print / PDF")'), True)
    check("the offense detail is on the page", "Offense — paint touches" in screen, True)
    check("the defense detail is on the page", "Defense — pick-and-roll" in screen, True)
    check("the detail tables render",
          all(t in screen for t in ["Game log", "By play", "By quarter", "Who gets us to the paint",
                                    "Coverages and their breakdowns", "Breakdowns by player"]), True)
    check("a one-game report states the paint-touch gap or stays quiet",
          screen.count("Reaching the paint is worth") <= 1, True)
    page.screenshot(path=OUT + "coach-report.png", full_page=True)

    page.click('button:has-text("← Season")'); page.wait_for_timeout(700)
    check("back returns to Season", page.is_visible('button:has-text("Open the coach report")'), True)

    check("no console errors", errs, [])
    b.close()
srv.terminate()
print("\n" + ("ALL PASS" if all(results) else f"{results.count(False)} FAILED"))
sys.exit(0 if all(results) else 1)
