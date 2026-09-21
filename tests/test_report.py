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
    lastOpponent: r.lastGame.game.opponent,
    lastComparison: flat(r.lastGame.comparison.rows),
    lastTones: r.lastGame.comparison.rows.map((row) =>
      (typeof row.cells[3] === "string" ? null : row.cells[3].tone)),
    lastBreakdowns: flat(r.lastGame.breakdowns.rows),
    lastTurnovers: flat(r.lastGame.turnovers.rows),
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

# One game on its own, measured against the games before it — never the ones
# after. Game two is built so the paint touch pays overall (1.20 vs 0.90) but
# not once turnovers are set aside (1.20 vs 3.00): the sentence must say the
# gap is gone, not "real, but smaller". It has 10 breakdowns, under the
# 20-possession floor, so their cost is left unsaid. A separate game puts every
# breakdown in the 4th quarter, which must not come out as "sharpest late".
ONE_GAME = """
() => import('/js/report.js').then((m) => {
  let k = 0;
  const base = (gameId, o) => Object.assign({
    id: "o" + (k++), gameId, quarter: "1", sequenceNumber: k, side: "offense",
    touches: [], points: 0, andOne: null, ftAttempt: null,
    play: { playId: null, playName: "Fastbreak / No Play" },
  }, o);
  const touch = [{ playerId: "pl1", playerName: "Marko", playerNumber: "4", timestamp: 1 }];
  const g = (id, date, opp) => ({ id, date, opponent: opp, ourScore: 70, theirScore: 60,
                                   status: "completed", currentQuarter: "4", createdAt: k });
  const g1 = g("g1", "2026-09-01", "First"), g2 = g("g2", "2026-09-02", "Second"), g3 = g("g3", "2026-09-03", "Third");

  const p1 = [], p2 = [], p3 = [];
  for (let i = 0; i < 20; i++) p1.push(base("g1", { outcome: "2PM", points: 2, touches: touch }));
  for (let i = 0; i < 12; i++) p2.push(base("g2", { outcome: "2PM", points: 2, touches: touch }));
  for (let i = 0; i < 8; i++)  p2.push(base("g2", { outcome: "2PA", points: 0, touches: touch }));
  for (let i = 0; i < 14; i++) p2.push(base("g2", { outcome: "TO", points: 0 }));
  for (let i = 0; i < 6; i++)  p2.push(base("g2", { outcome: "3PM", points: 3 }));
  const def = (gameId, quarter, broken) => base(gameId, {
    side: "defense", quarter, outcome: broken ? "2PM" : "2PA", points: broken ? 2 : 0,
    coverage: { coverageId: "c1", coverageName: "Switch" },
    mistake: broken ? { mistakeId: "m1", mistakeName: "On ball" } : { mistakeId: "none", mistakeName: "No mistake" } });
  for (let i = 0; i < 10; i++) { p2.push(def("g2", "1", false)); p2.push(def("g2", "1", true)); }
  for (let i = 0; i < 20; i++) p3.push(def("g3", "1", false));
  for (let i = 0; i < 20; i++) p3.push(def("g3", "4", i < 10));
  for (let i = 0; i < 5; i++) { p3.push(base("g3", { outcome: "3PM", points: 3, touches: touch }));
                                p3.push(base("g3", { outcome: "3PA", points: 0 })); }

  const e = (game, possessions) => ({ game, possessions });
  const mid = m.buildReport([e(g2, p2)], { before: [e(g1, p1)] });
  const first = m.buildReport([e(g1, p1)], { before: [] });
  const late = m.buildReport([e(g3, p3)], { before: [] });
  const leads = (r) => r.findings.map((f) => f.lead);
  const text = (r, part) => ((r.findings.find((f) => f.lead.indexOf(part) >= 0) || {}).text) || "";
  return {
    midG: mid.G, midGame: mid.lastGame.game.opponent,
    midHeader: mid.lastGame.comparison && mid.lastGame.comparison.headers,
    midPaint: text(mid, "Reaching the paint"),
    midAside: text(mid, "never reach the paint"),
    midLeads: leads(mid),
    midTile: mid.tiles[4].label,
    firstComparison: first.lastGame.comparison,
    lateLeads: leads(late),
  };
})
"""

# A season that got better: every possession lost in game one, every one
# scored in game two. The change has to be coloured, and the clip times have
# to come out of the timestamps rather than being invented.
MOVED = """
() => import('/js/report.js').then((m) => {
  const START = 1000000;
  const games = [
    { id: "a", date: "2026-09-01", opponent: "Before", ourScore: 60, theirScore: 80,
      status: "completed", currentQuarter: "4", createdAt: START },
    { id: "b", date: "2026-09-02", opponent: "After", ourScore: 90, theirScore: 70,
      status: "completed", currentQuarter: "4", createdAt: START },
  ];
  const base = (gameId, o) => Object.assign({
    id: "x" + Math.random(), gameId, quarter: "2", sequenceNumber: 1, side: "offense",
    touches: [], points: 0, andOne: null, ftAttempt: null,
    play: { playId: null, playName: "Fastbreak / No Play" },
  }, o);

  const first = [], second = [];
  for (let i = 0; i < 20; i++) first.push(base("a", { outcome: "TO", points: 0 }));
  for (let i = 0; i < 20; i++) {
    second.push(base("b", { outcome: "2PM", points: 2,
      touches: [{ playerId: "p1", playerName: "Marko", playerNumber: "4", timestamp: START }] }));
  }
  second.push(base("b", {
    side: "defense", outcome: "3PM", points: 3, startedAt: START + 90000,
    coverage: { coverageId: "c1", coverageName: "Weak" },
    mistake: { mistakeId: "m2", mistakeName: "Strong hand" },
    mistakePlayer: { playerId: "p9", playerName: "Vanin", playerNumber: "21" },
  }));

  const r = m.buildReport([
    { game: games[0], possessions: first },
    { game: games[1], possessions: second },
  ]);
  const text = (c) => (typeof c === "string" ? c : c.text);
  return {
    rows: r.lastGame.comparison.rows.map((row) => row.cells.map(text)),
    tones: r.lastGame.comparison.rows.map((row) =>
      (typeof row.cells[3] === "string" ? null : row.cells[3].tone)),
    headers: r.lastGame.comparison.headers,
    breakdown: r.lastGame.breakdowns.rows.map((row) => row.cells.map(text)),
    touchFlag: r.lastGame.turnovers.rows.length,
  };
})
"""

# A list renamed mid-season: "Reject" became "Strong hand", a coverage and a
# play were renamed too, and a player's name was corrected. Every record keeps
# the name it was tapped under, so the season has two names for one entry.
# Totals must not split, the label must be the newest name — and one game on
# its own must still show what it was called then.
RENAMED = """
() => import('/js/report.js').then((m) => {
  const game = (id, date, at) => ({ id, date, opponent: id, ourScore: 70, theirScore: 60,
    status: "completed", currentQuarter: "4", createdAt: at, completedAt: at });
  const pair = (gameId, at, mistakeName, coverageName, playName, playerName) => ([
    { id: gameId + "d", gameId, quarter: "1", sequenceNumber: 1, side: "defense", closedAt: at,
      outcome: "2PM", points: 2, touches: [],
      coverage: { coverageId: "c1", coverageName },
      mistake: { mistakeId: "m1", mistakeName },
      mistakePlayer: { playerId: "p1", playerName, playerNumber: "24" } },
    { id: gameId + "o", gameId, quarter: "1", sequenceNumber: 2, side: "offense", closedAt: at,
      outcome: "2PM", points: 2, andOne: null, ftAttempt: null,
      play: { playId: "pl1", playName },
      touches: [{ playerId: "p1", playerName, playerNumber: "24", timestamp: at }] },
  ]);

  const older = { game: game("old", "2026-09-01", 1000),
                  possessions: pair("old", 1000, "Reject", "Weak", "5 Twist", "Callison") };
  const newer = { game: game("new", "2026-09-20", 5000),
                  possessions: pair("new", 5000, "Strong hand", "Weak side", "Horns", "Charles Callison") };

  const season = m.buildReport([older, newer]);
  const justTheOldGame = m.buildReport([older]);
  return {
    mistakes: season.def.byMistake.map((x) => [x.name, x.count]),
    coverages: season.def.byCoverage.map((x) => [x.name, x.trips]),
    plays: season.off.byPlay.map((x) => [x.name, x.possessions]),
    defPlayer: season.def.byPlayer.map((p) => [p.name, p.breakdowns.map((b) => b.name)]),
    offPlayer: season.off.byPlayer.map((p) => p.name),
    oldGameAlone: justTheOldGame.def.byMistake.map((x) => [x.name, x.count]),
  };
})
"""

# Two games on the same date — a tournament day — handed over newest first,
# the way the database returns them. "Last game" has to be the one that
# finished later, not whichever arrived first. This was a real bug: the live
# report named the earlier game.
ORDER = """
() => import('/js/report.js').then((m) => {
  const mk = (id, opponent, completedAt) => ({
    id, date: "2026-09-20", opponent, ourScore: 70, theirScore: 60,
    status: "completed", currentQuarter: "4", createdAt: completedAt - 1000, completedAt,
  });
  const poss = (gameId) => [{
    id: gameId + "1", gameId, quarter: "1", sequenceNumber: 1, side: "offense",
    outcome: "2PM", points: 2, touches: [], andOne: null, ftAttempt: null,
    play: { playId: null, playName: "Fastbreak / No Play" },
  }];
  const r = m.buildReport([
    { game: mk("late", "Second game", 5000), possessions: poss("late") },
    { game: mk("early", "First game", 1000), possessions: poss("early") },
  ]);
  return { last: r.lastGame.game.opponent, order: r.perGame.map((g) => g.game.opponent) };
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

    # --- one game on its own ----------------------------------------------
    o = page.evaluate(ONE_GAME)
    check("a one-game report is that game alone", [o["midG"], o["midGame"]], [1, "Second"])
    check("measured against the games before it", o["midHeader"],
          ["", "Previous 1 game", "Second", "Change"])
    check("the first game of a season has nothing before it", o["firstComparison"], None)
    check("one game does not say 'held in 1 of 1'", "held in" in o["midPaint"], False)
    check("a gap that is only turnovers says so",
          "gap is gone — 1.20 vs 3.00" in o["midAside"], True)
    check("and never calls it 'real, but smaller'", "real, but smaller" in o["midAside"], False)
    check("breakdown cost is not claimed from 10 breakdowns",
          any("breakdown costs" in l for l in o["midLeads"]), False)
    check("the breakdown tile drops 'a game' for one game", o["midTile"], "Points lost to PnR breakdowns")
    check("breakdowns in the 4th are not called 'sharpest late'",
          "The defense is sharpest late, loosest early." in o["lateLeads"], False)
    check("they are named where they peak",
          "Breakdowns peak in the 4th quarter" in o["lateLeads"], True)
    check("threes are not compared on 5 attempts a side",
          any("Threes are" in l for l in o["lateLeads"]), False)

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

    # --- the last game against the rest ------------------------------------
    check("the last game is the newest one", r["lastOpponent"], "Beta")
    check("two identical games show no change",
          r["lastComparison"][0], ["Offense PPP", "1.00", "1.00", "+0.00"])
    check("and nothing is coloured", set(r["lastTones"]), {None})
    check("every breakdown of that game is listed", len(r["lastBreakdowns"]), 12)
    check("a breakdown row carries what film needs",
          r["lastBreakdowns"][0], ["Q1", "—", "—", "Switch", "On ball", "#7 Novak", "2PT Made · 2"])
    check("every turnover of that game is listed", len(r["lastTurnovers"]), 20)
    check("a turnover says whether it reached the paint",
          r["lastTurnovers"][0][3:], ["Fastbreak / No Play", "no"])

    moved = page.evaluate(MOVED)
    check("the comparison names the opponent",
          moved["headers"], ["", "Previous 1 game", "After", "Change"])
    check("a real improvement is stated",
          moved["rows"][0], ["Offense PPP", "0.00", "2.00", "+2.00"])
    check("and coloured as good", moved["tones"][0], "good")
    check("fewer turnovers is also good, though the number falls",
          [moved["rows"][4][3], moved["tones"][4]], ["-100 pts", "good"])
    check("the clip time is read from the timestamps, not invented",
          moved["breakdown"][0][2:], ["1:30", "Weak", "Strong hand", "#21 Vanin", "3PT Made · 3"])
    check("a game with no turnovers lists none", moved["touchFlag"], 0)

    # --- renaming a list mid-season ----------------------------------------
    renamed = page.evaluate(RENAMED)
    check("a renamed breakdown stays one row, under the new name",
          renamed["mistakes"], [["Strong hand", 2]])
    check("so does a renamed coverage", renamed["coverages"], [["Weak side", 2]])
    check("and a renamed play", renamed["plays"], [["Horns", 2]])
    check("a player's breakdown list follows the rename too",
          renamed["defPlayer"], [["Charles Callison", ["Strong hand"]]])
    check("a corrected player name shows the corrected one",
          renamed["offPlayer"], ["Charles Callison"])
    check("but that game on its own still says what was tapped then",
          renamed["oldGameAlone"], [["Reject", 1]])

    order = page.evaluate(ORDER)
    check("two games on one date are ordered by which finished later",
          order["order"], ["First game", "Second game"])
    check("and the last game is the later one", order["last"], "Second game")

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
    check("the last game gets its own section", "Last game — Report HS" in screen, True)
    check("with one game there is nothing to compare against",
          "Nothing to compare it with yet" in screen, True)
    check("a clean game says so instead of printing an empty table",
          "No pick-and-roll breakdowns logged in this game." in screen, True)
    check("and so does a season with no pick-and-roll tracked at all",
          "No pick-and-roll possessions tracked." in screen, True)
    check("a one-game report states the paint-touch gap or stays quiet",
          screen.count("Reaching the paint is worth") <= 1, True)
    page.screenshot(path=OUT + "coach-report.png", full_page=True)

    page.click('button:has-text("← Season")'); page.wait_for_timeout(700)
    check("back returns to Season", page.is_visible('button:has-text("Open the coach report")'), True)

    # A single game's report, reached from that game in History.
    page.click('.tab-bar button[data-view="history"]'); page.wait_for_timeout(700)
    page.click('.list-row:has-text("Report HS")'); page.wait_for_timeout(700)
    GAME_BTN = 'button:has-text("Open this game\'s report")'
    check("a finished game offers its own report", page.is_visible(GAME_BTN), True)
    page.click(GAME_BTN); page.wait_for_timeout(900)
    one = page.text_content(".report")
    check("it opens as a game report", page.inner_text("h1.screen-title"), "Game report")
    check("titled with the opponent", "vs Report HS · paint touches" in one, True)
    check("its comparison section is about this game", "This game against the season" in one, True)
    check("the first game says nothing came before it",
          "no game was finished before this one" in one, True)
    check("no one-row game log", "Game log" in one, False)
    page.click('button:has-text("← Game")'); page.wait_for_timeout(700)
    check("back returns to the game", page.is_visible(GAME_BTN), True)

    # The season's date range reads oldest to newest. The database hands games
    # back newest first, which once printed "Sep 20, 2026 – Aug 29, 2026".
    page.evaluate("""() => import('/js/db.js').then(async (m) => {
      const db = await m.getDB();
      await db.put("games", { id: "early", date: "2026-01-05", opponent: "January", status: "completed",
                              currentQuarter: "4", createdAt: 1, completedAt: 1 });
    })""")
    page.click('.tab-bar button[data-view="season"]'); page.wait_for_timeout(800)
    page.click('button:has-text("Open the coach report")'); page.wait_for_timeout(900)
    rng = page.inner_text(".report-head .stat-note")
    check("the season's range starts with its first game", rng.startswith("Jan 5, 2026 – "), True)

    # A report that cannot be built must say so. The button doesn't wait for
    # the report, so a failure used to vanish and the tap did nothing at all.
    # A date stored as a number is enough to make the ordering throw.
    page.click('button:has-text("← Season")'); page.wait_for_timeout(600)
    page.evaluate("""() => import('/js/db.js').then(async (m) => {
      const db = await m.getDB();
      await db.put("games", { id: "broken", date: 20260106, opponent: "Broken", status: "completed",
                              currentQuarter: "4", createdAt: 2, completedAt: 2 });
    })""")
    errs_before = len(errs)
    page.click('button:has-text("Open the coach report")'); page.wait_for_timeout(900)
    check("a failed report says so instead of doing nothing",
          page.is_visible('text=The report could not be built'), True)
    check("and shows what went wrong", "TypeError" in (page.text_content(".report-error") or ""), True)
    check("with a way back", page.is_visible('button:has-text("← Season")'), True)
    del errs[errs_before:]   # the failure is the point of this check, not a stray error
    page.evaluate("""() => import('/js/db.js').then(async (m) => (await m.getDB()).delete("games", "broken"))""")

    check("no console errors", errs, [])
    b.close()
srv.terminate()
print("\n" + ("ALL PASS" if all(results) else f"{results.count(False)} FAILED"))
sys.exit(0 if all(results) else 1)
