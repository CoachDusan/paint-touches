// The head-coach report in words. Takes finished games, returns figures and
// sentences — no DOM, so what the report claims can be checked directly.
//
// It calls computeStats()/computeDefenseStats() rather than re-deriving
// anything, so the report and the stats panels can never disagree.
//
// Every sentence is written from the data, never stored. One more game can
// stop a "3rd quarter dip" from being true, so each finding carries the rule
// it needs — a gap wide enough, a sample big enough — and stays silent
// otherwise. A report that says nothing is better than one that says something
// the numbers no longer support.

import { computeStats, computeDefenseStats } from "./stats.js";
import { gameResult } from "./models.js";
import { formatDate, formatClock, formatElapsed } from "./utils.js";
import { SIDES, sideOf, playNameOf, isNoMistake, DEFENSE_OUTCOME_LABELS } from "./possession.js";

// Under this many possessions, one made three moves PPP by 0.15 — so nothing
// is allowed to claim anything on less.
export const MIN_SAMPLE = 20;
// A breakdown seen fewer times than this isn't "common", whatever it cost.
const COMMON = 10;

const ORD = { "1": "1st", "2": "2nd", "3": "3rd", "4": "4th", OT: "overtime" };

export const f2 = (x) => (x === null || x === undefined ? "—" : x.toFixed(2));
export const pc = (x) => (x === null || x === undefined ? "—" : `${Math.round(x * 100)}%`);
const rate = (a, b) => (b ? a / b : null);
const shots = (m, a) => (a ? `${m}-${a}` : "—");
// Turnovers score nothing, so "leaving them out" is points over what's left.
const pppNoTurnovers = (b) =>
  b.possessions - b.turnovers > 0 ? b.points / (b.possessions - b.turnovers) : null;

function totals(entries) {
  const all = entries.flatMap((e) => e.possessions);
  return { off: computeStats(all), def: computeDefenseStats(all) };
}

// Oldest first, and for two games on the same date — a tournament day — the
// one that finished later is the later game. Sorting on the date alone left
// "last game" pointing at whichever the database happened to return first.
export function gameOrder(a, b) {
  return (a.date || "").localeCompare(b.date || "") ||
    (a.completedAt || a.createdAt || 0) - (b.completedAt || b.createdAt || 0);
}

// `before` turns this into a one-game report: `unordered` is that game alone,
// and `before` is every game that came earlier — what it is measured against.
// Only earlier ones: set against the season as it stood that day, a game's
// report reads the same in March as it did the morning after.
export function buildReport(unordered, { before = null } = {}) {
  const entries = [...unordered].sort((a, b) => gameOrder(a.game, b.game));
  const games = entries.map((e) => e.game);
  const G = games.length;
  const { off, def } = totals(entries);
  const perGame = entries.map((e) => ({ game: e.game, ...totals([e]) }));

  const t = off.touchSplit.withTouches;
  const n = off.touchSplit.noTouches;
  const clean = def.executionSplit.clean;
  const broken = def.executionSplit.broken;

  // What breakdowns cost, in points a game: the gap between a possession that
  // broke down and one that didn't, across the ones that broke. It assumes a
  // broken possession would otherwise have gone like a clean one, which is why
  // it is always shown as "about".
  const costPerGame =
    clean.ppp !== null && broken.ppp !== null && G
      ? ((broken.ppp - clean.ppp) * broken.possessions) / G
      : null;

  const ctx = { entries, games, G, off, def, perGame, t, n, clean, broken, costPerGame, before };

  return {
    games, G, off, def, perGame, costPerGame,
    record: record(games),
    tiles: tiles(ctx),
    sides: winsAndLosses(ctx),
    findings: findings(ctx),
    priorities: priorities(ctx),
    caveats: caveats(ctx),
    offense: offenseDetail(ctx),
    defense: defenseDetail(ctx),
    lastGame: lastGameDetail(ctx),
  };
}

function record(games) {
  const scored = games.filter((g) => gameResult(g));
  return {
    w: scored.filter((g) => gameResult(g) === "W").length,
    l: scored.filter((g) => gameResult(g) === "L").length,
    t: scored.filter((g) => gameResult(g) === "T").length,
  };
}

function tiles({ off, def, t, n, G, costPerGame }) {
  return [
    {
      value: f2(off.overall.ppp),
      label: "Offense PPP",
      note: `${off.overall.possessions} possession${off.overall.possessions === 1 ? "" : "s"}`,
    },
    {
      value: `${f2(t.ppp)} / ${f2(n.ppp)}`,
      label: "PPP with / without paint touch",
      note: `${t.possessions} and ${n.possessions} poss`,
    },
    {
      value: pc(rate(t.possessions, off.overall.possessions)),
      label: "Possessions reaching the paint",
      note: `${t.possessions} of ${off.overall.possessions}`,
    },
    { value: f2(def.overall.ppp), label: "PnR PPP allowed", note: `${def.overall.possessions} pick-and-roll poss` },
    {
      value: costPerGame === null ? "—" : `≈${Math.round(costPerGame)}`,
      label: G === 1 ? "Points lost to PnR breakdowns" : "Points a game lost to PnR breakdowns",
      note: `${def.overall.mistakes} breakdowns in ${G} game${G === 1 ? "" : "s"}`,
    },
  ];
}

// Wins and losses side by side. The tracking's whole claim to usefulness is
// that it sees something the box score doesn't, and this is where that shows.
function winsAndLosses({ entries }) {
  const side = (result) => {
    const picked = entries.filter((e) => gameResult(e.game) === result);
    if (picked.length === 0) return null;
    const { off, def } = totals(picked);
    return { count: picked.length, off, def };
  };

  const w = side("W");
  const l = side("L");
  if (!w || !l) return null;

  const rows = (s) => [
    ["Offense PPP", f2(s.off.overall.ppp)],
    ["Possessions reaching the paint", pc(rate(s.off.touchSplit.withTouches.possessions, s.off.overall.possessions))],
    ["Turnover rate", pc(s.off.overall.toRate)],
    ["PnR PPP allowed", f2(s.def.overall.ppp)],
    ["PnR trips that break down", pc(s.def.overall.mistakeRate)],
    ["PPP allowed on a breakdown", f2(s.def.executionSplit.broken.ppp)],
    ["PnR free-throw trips allowed / game", (s.def.overall.ft / s.count).toFixed(1)],
  ];

  const read = [];
  const offGap = Math.abs((w.off.overall.ppp ?? 0) - (l.off.overall.ppp ?? 0));
  read.push(
    offGap < 0.08
      ? `The tracked offense is about the same in wins and losses (${f2(w.off.overall.ppp)} vs ${f2(l.off.overall.ppp)} PPP).`
      : `The tracked offense scores ${f2(w.off.overall.ppp)} PPP in wins and ${f2(l.off.overall.ppp)} in losses.`
  );
  read.push(`Pick-and-roll defense allows ${f2(w.def.overall.ppp)} in wins and ${f2(l.def.overall.ppp)} in losses.`);
  const wr = w.def.overall.mistakeRate;
  const lr = l.def.overall.mistakeRate;
  if (wr !== null && lr !== null) {
    read.push(
      Math.abs(wr - lr) < 0.05
        ? `Breakdowns happen just as often (${pc(wr)} vs ${pc(lr)}); what changes is their cost — ${f2(w.def.executionSplit.broken.ppp)} vs ${f2(l.def.executionSplit.broken.ppp)} per broken possession.`
        : `Breakdowns: ${pc(wr)} of trips in wins, ${pc(lr)} in losses.`
    );
  }

  return {
    wins: { count: w.count, rows: rows(w) },
    losses: { count: l.count, rows: rows(l) },
    read: read.join(" "),
  };
}

// What is left of the paint-touch gap once turnovers are taken out of both
// sides. It usually shrinks; in a single game it can vanish or flip, and the
// sentence has to say which.
function asideTurnovers(t, n) {
  const tn = pppNoTurnovers(t), nn = pppNoTurnovers(n);
  if (tn === null || nn === null) return "";
  const pair = `${f2(tn)} vs ${f2(nn)}`;
  if (tn <= nn) return `With turnovers set aside the gap is gone — ${pair}. The difference was the turnovers.`;
  if (tn - nn >= t.ppp - n.ppp) return `With turnovers set aside the gap holds — ${pair}.`;
  return `With turnovers set aside the gap shrinks to ${pair} — real, but smaller.`;
}

function findings(ctx) {
  const { off, def, t, n, G, perGame, clean, broken, costPerGame } = ctx;
  const out = [];

  if (t.ppp !== null && n.ppp !== null) {
    const held = perGame.filter(
      (g) => g.off.touchSplit.withTouches.ppp !== null &&
             g.off.touchSplit.noTouches.ppp !== null &&
             g.off.touchSplit.withTouches.ppp > g.off.touchSplit.noTouches.ppp
    ).length;
    const share = `${pc(rate(t.possessions, off.overall.possessions))} of possessions get there.`;
    out.push(t.ppp > n.ppp
      ? {
          lead: `Reaching the paint is worth ${f2(t.ppp - n.ppp)} points a possession.`,
          text: G === 1
            ? `${f2(t.ppp)} with a paint touch, ${f2(n.ppp)} without. ${share}`
            : `${f2(t.ppp)} with a paint touch, ${f2(n.ppp)} without, and the gap held in ${held} of ${G} games. ${share}`,
        }
      : {
          lead: "Reaching the paint did not pay here.",
          text: `${f2(t.ppp)} with a paint touch, ${f2(n.ppp)} without. ${share}`,
        });

    if (off.overall.turnovers > 0) {
      out.push({
        lead: "Possessions that never reach the paint are lost to turnovers.",
        text: `${n.turnovers} of ${off.overall.turnovers} turnovers came on them (${pc(n.toRate)} of those ` +
              `possessions, against ${pc(t.toRate)} after a touch). ` + asideTurnovers(t, n),
      });
    }

    const t3 = rate(t.m3, t.a3);
    const n3 = rate(n.m3, n.a3);
    if (t3 !== null && n3 !== null && Math.min(t.a3, n.a3) >= MIN_SAMPLE) {
      out.push(
        t3 < n3
          ? {
              lead: "Threes are not better after a touch — yet.",
              text: `${pc(t3)} on ${t.a3} kick-out threes against ${pc(n3)} on ${n.a3} without a touch. ` +
                    `${pc(rate(n.a3, off.overall.a3))} of all threes come without one.`,
            }
          : {
              lead: "Threes are better after a touch.",
              text: `${pc(t3)} on ${t.a3} attempts against ${pc(n3)} on ${n.a3} without — yet ` +
                    `${pc(rate(n.a3, off.overall.a3))} of all threes still come without a touch.`,
            }
      );
    }
  }

  // A quarter is only worth naming when it actually stands apart: with one
  // more game the "worst" one can be 0.02 behind the next.
  const qs = off.byQuarter.filter((q) => q.quarter !== "OT" && q.possessions >= MIN_SAMPLE && q.ppp !== null);
  if (qs.length >= 3) {
    const ranked = [...qs].sort((a, b) => a.ppp - b.ppp);
    const worst = ranked[0], next = ranked[1];
    const best = ranked[ranked.length - 1], second = ranked[ranked.length - 2];
    if (next.ppp - worst.ppp >= 0.08) {
      out.push({
        lead: `The ${ORD[worst.quarter]} quarter is the offensive dip.`,
        text: `${f2(worst.ppp)} PPP against ${f2(off.overall.ppp)} for the game, with threes at ${shots(worst.m3, worst.a3)}.`,
      });
    } else if (best.ppp - second.ppp >= 0.15) {
      out.push({
        lead: `The ${ORD[best.quarter]} quarter is the offense's best by far:`,
        text: `${f2(best.ppp)} PPP, threes ${shots(best.m3, best.a3)}. The other quarters sit between ` +
              `${f2(worst.ppp)} and ${f2(second.ppp)}.`,
      });
    }
  }

  if (costPerGame !== null && broken.possessions >= MIN_SAMPLE && clean.possessions >= MIN_SAMPLE &&
      broken.ppp - clean.ppp >= PPP_MOVE) {
    out.push({
      lead: `A pick-and-roll breakdown costs ${f2(broken.ppp - clean.ppp)} points.`,
      text: `${f2(clean.ppp)} allowed when the coverage is run right, ${f2(broken.ppp)} when it breaks. ` +
            (G === 1
              ? `${pc(def.overall.mistakeRate)} of trips broke down — ${def.overall.mistakes} of them, roughly ` +
                `${Math.round(costPerGame)} points.`
              : `${pc(def.overall.mistakeRate)} of trips break down — about ${Math.round(def.overall.mistakes / G)} a game, ` +
                `roughly ${Math.round(costPerGame)} points a game.`),
    });
  }

  const common = def.byMistake.filter((m) => m.count >= COMMON);
  if (common.length) {
    const first = common[0];
    const home = def.byCoverage.find((c) => c.breakdowns.some((b) => b.id === first.id));
    const inHome = home ? home.breakdowns.find((b) => b.id === first.id).count : 0;
    const where = home ? (inHome === first.count ? "all in" : `${pc(rate(inHome, first.count))} in`) : "spread across coverages";
    let text = `(${first.count}, ${home ? `${where} ${home.name}` : where}; ${f2(first.ppp)} allowed).`;
    const dearest = [...common].sort((a, b) => (b.ppp ?? 0) - (a.ppp ?? 0))[0];
    if (dearest.id !== first.id) {
      text += ` ${dearest.name} is the most expensive: ${f2(dearest.ppp)} allowed, threes ${shots(dearest.m3, dearest.a3)}.`;
    }
    out.push({ lead: `${first.name} is the most common breakdown`, text });
  }

  const dq = def.byQuarter.filter((q) => q.quarter !== "OT" && q.trips >= MIN_SAMPLE && q.mistakeRate !== null);
  if (dq.length >= 2) {
    const ranked = [...dq].sort((a, b) => b.mistakeRate - a.mistakeRate);
    const worst = ranked[0], best = ranked[ranked.length - 1];
    // A tie, or near one, is no finding — and "sharpest late" is only true when
    // the worst quarter really is the earlier one.
    if (worst.mistakeRate - best.mistakeRate >= RATE_MOVE) {
      out.push(Number(worst.quarter) < Number(best.quarter)
        ? {
            lead: "The defense is sharpest late, loosest early.",
            text: `${pc(worst.mistakeRate)} of trips break down in the ${ORD[worst.quarter]} quarter, ` +
                  `${pc(best.mistakeRate)} in the ${ORD[best.quarter]}.`,
          }
        : {
            lead: `Breakdowns peak in the ${ORD[worst.quarter]} quarter`,
            text: `(${pc(worst.mistakeRate)} of trips) and are rarest in the ${ORD[best.quarter]} ` +
                  `(${pc(best.mistakeRate)}).`,
          });
    }
  }

  const covs = def.byCoverage.filter((c) => c.possessions >= MIN_SAMPLE && c.ppp !== null);
  if (covs.length >= 2) {
    const best = [...covs].sort((a, b) => a.ppp - b.ppp)[0];
    if (best.ppp <= (def.overall.ppp ?? 0) - 0.2) {
      // Which games it was actually called in. A coverage kept for one
      // opponent tells you about that game plan, not about the coverage.
      const used = ctx.perGame
        .map((g) => ({ game: g.game, row: g.def.byCoverage.find((c) => c.id === best.id) }))
        .filter((x) => x.row);
      const top = [...used].sort((a, b) => b.row.trips - a.row.trips)[0];
      const totalTrips = used.reduce((sum, x) => sum + x.row.trips, 0);
      let text = `— ${f2(best.ppp)} on ${best.possessions} possessions.`;
      if (G > 1 && top && top.row.trips / totalTrips >= 0.5) {
        const who = top.game.opponent || "one opponent";
        text += used.length === 1
          ? ` But all ${totalTrips} of its trips came against ${who}, so it says more about one game plan than about the coverage.`
          : used.length < G
            ? ` But it has been used in only ${used.length} of ${G} games, and ${top.row.trips} of its ${totalTrips} trips came against ${who} — too few games to call it better yet.`
            : ` But ${top.row.trips} of its ${totalTrips} trips came against ${who} — too few games to call it better yet.`;
      }
      out.push({ lead: `${best.name} has allowed the fewest points`, text });
    }
  }

  return out;
}

function priorities({ off, def, n, G, perGame }) {
  const out = [];

  if (n.turnovers > 0) {
    out.push({
      lead: "Protect the ball before the paint.",
      text: `About ${Math.round(n.turnovers / G)} turnovers a game come on possessions that never touch it. ` +
            `The biggest single leak on offense.`,
    });
  }

  const common = def.byMistake.filter((m) => m.count >= COMMON);
  if (common.length) {
    const first = common[0];
    const who = def.byPlayer
      .map((p) => ({ name: p.name, n: (p.breakdowns.find((b) => b.id === first.id) || {}).count || 0 }))
      .filter((p) => p.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 2)
      .map((p) => `${p.name} ${p.n}`)
      .join(" · ");
    out.push({
      lead: `${first.name} defense.`,
      text: `${first.count} breakdowns in ${G} game${G === 1 ? "" : "s"}${who ? ` — ${who} account for the most` : ""}. ` +
            `Every one has a clip time in the game's defense stats.`,
    });

    const dearest = [...common].sort((a, b) => (b.ppp ?? 0) - (a.ppp ?? 0))[0];
    if (dearest.id !== first.id) {
      out.push({
        lead: `${dearest.name}.`,
        text: `Fewer of them, but each one costs ${f2(dearest.ppp)} — the most expensive of the common breakdowns.`,
      });
    }
  }

  // A set run often enough to judge, going badly enough to look at on video.
  const weak = off.byPlay
    .filter((p) => p.id !== "transition" && p.possessions >= MIN_SAMPLE && p.ppp !== null &&
                   p.ppp <= (off.overall.ppp ?? 0) - 0.3)
    .sort((a, b) => a.ppp - b.ppp);
  for (const play of weak) {
    out.push({
      lead: `Film check on “${play.name}”.`,
      text: `${f2(play.ppp)} PPP and ${pc(play.toRate)} turnovers on ${play.possessions} possessions — ` +
            `worst of the sets run ${MIN_SAMPLE}+ times.`,
    });
  }

  return out;
}

// Said once, plainly, because a number read out of context is worse than no
// number: these are tracked possessions, and defense is pick-and-roll only.
function caveats({ off, def, games }) {
  const us = games.reduce((sum, g) => sum + (g.ourScore || 0), 0);
  const them = games.reduce((sum, g) => sum + (g.theirScore || 0), 0);
  const parts = [
    "PPP = points per possession. These are tracked possessions, not the box score:",
    us ? `offense logged ${off.overall.points} of ${us} points (${pc(rate(off.overall.points, us))});` : `offense logged ${off.overall.points} points;`,
    `defense tracks pick-and-roll possessions only${them ? ` — ${def.overall.points} of ${them} points allowed` : ""}, so it cannot explain fouls or scoring outside the pick-and-roll.`,
    `A foul that doesn't end a possession is counted but kept out of PPP (${off.overall.fouls} on offense, ${def.overall.fouls} on defense).`,
    "Player numbers on offense mean possessions that player touched the paint in — the app does not record who shot or who turned it over.",
    `Anything resting on fewer than ${MIN_SAMPLE} possessions is left out rather than claimed.`,
  ];
  return parts.join(" ");
}

// ---------------------------------------------------------------------
// The detail behind the findings: the tables a coach reaches for when a line
// on the first page makes them ask "against whom?" or "which set?".
//
// Built as plain rows — a cell is a string, or { text, tone } when a number
// has earned green or red — so the view stays a renderer and every judgement
// (what counts as thin, what counts as clear of average) lives here, where it
// can be tested.
// ---------------------------------------------------------------------

const FOLD = 10; // plays run fewer times than this are folded into one row

const cell = (text, tone) => (tone ? { text, tone } : text);

// Colour only where the sample can carry it: MIN_SAMPLE possessions, and at
// least 0.15 clear of the team's own average — the swing one made three
// creates over 20 possessions. Everything else stays plain.
function pppCell(b, baseline, { lowerIsBetter = false } = {}) {
  if (b.ppp === null || b.ppp === undefined) return "—";
  const text = f2(b.ppp);
  if (b.possessions < MIN_SAMPLE || baseline === null || baseline === undefined) return text;
  const diff = lowerIsBetter ? baseline - b.ppp : b.ppp - baseline;
  if (diff >= 0.15) return cell(text, "good");
  if (diff <= -0.15) return cell(text, "bad");
  return text;
}

const thinRow = (cells, poss) => ({ cells, thin: poss < MIN_SAMPLE });

function gameCell(game) {
  return `${game.opponent || "Game"} · ${formatDate(game.date)}`;
}

function resultCell(game) {
  const result = gameResult(game);
  if (!result || game.ourScore == null || game.theirScore == null) return "—";
  return cell(`${result} ${game.ourScore}–${game.theirScore}`,
              result === "W" ? "good" : result === "L" ? "bad" : null);
}

function offenseDetail({ perGame, off, t, n, G }) {
  const gameLog = {
    headers: ["Game", "Result", "Poss", "PPP", "Touch", "PPP touch", "PPP no touch", "TO", "Pts logged"],
    numeric: [2, 3, 4, 5, 6, 7, 8],
    rows: perGame.map(({ game, off: o }) => {
      const gt = o.touchSplit.withTouches;
      const gn = o.touchSplit.noTouches;
      return {
        cells: [
          gameCell(game), resultCell(game), String(o.overall.possessions), f2(o.overall.ppp),
          pc(rate(gt.possessions, o.overall.possessions)), f2(gt.ppp), f2(gn.ppp), pc(o.overall.toRate),
          // Says out loud how much of the game reached the record, so nobody
          // reads the app's points as the scoreboard.
          game.ourScore == null ? String(o.overall.points) : `${o.overall.points} of ${game.ourScore}`,
        ],
      };
    }).concat([{
      total: true,
      cells: [
        `${G} game${G === 1 ? "" : "s"}`, "", String(off.overall.possessions), f2(off.overall.ppp),
        pc(rate(t.possessions, off.overall.possessions)), f2(t.ppp), f2(n.ppp), pc(off.overall.toRate), "",
      ],
    }]),
  };

  const splitRows = (b) => [
    ["Possessions", String(b.possessions)],
    ["PPP", f2(b.ppp)],
    ["Turnover rate", pc(b.toRate)],
    ["2PT", `${shots(b.m2, b.a2)} · ${pc(rate(b.m2, b.a2))}`],
    ["3PT", `${shots(b.m3, b.a3)} · ${pc(rate(b.m3, b.a3))}`],
    ["Free-throw trips", `${b.ft} · ${pc(rate(b.ft, b.possessions))}`],
    ["PPP leaving turnovers out", f2(pppNoTurnovers(b))],
  ];

  const split = {
    withTouch: { title: "With a paint touch", rows: splitRows(t) },
    without: { title: "Without", rows: splitRows(n) },
    read:
      `Without a touch the offense lives on threes (${n.a3} of its ${n.possessions} possessions end in one) and ` +
      `turnovers (${n.turnovers}). Two-pointers without a touch are rare and poor (${shots(n.m2, n.a2)}). ` +
      `Part of the gap is built in: a possession lost in the backcourt never had the chance to reach the paint — ` +
      `so the lesson is as much “don't lose it on the way” as “get there more.”`,
  };

  const shown = off.byPlay.filter((p) => p.possessions >= FOLD);
  const folded = off.byPlay.filter((p) => p.possessions < FOLD);
  const playRows = shown.map((p) =>
    thinRow([p.name, String(p.possessions), pppCell(p, off.overall.ppp), pc(p.touchRate), pc(p.toRate),
             shots(p.m3, p.a3)], p.possessions)
  );
  if (folded.length) {
    const points = folded.reduce((s, p) => s + p.points, 0);
    const poss = folded.reduce((s, p) => s + p.possessions, 0);
    playRows.push({
      thin: true,
      cells: [`${folded.length} other play${folded.length === 1 ? "" : "s"}, under ${FOLD} each`,
              String(poss), f2(poss ? points / poss : null), "—", "—", "—"],
    });
  }

  return {
    gameLog,
    split,
    plays: {
      headers: ["Play", "Poss", "PPP", "Touch", "TO", "3PT"],
      numeric: [1, 2, 3, 4, 5],
      rows: playRows,
      note: `Green or red means at least 0.15 above or below the team's ${f2(off.overall.ppp)}, on ` +
            `${MIN_SAMPLE}+ possessions. Grey is too little to read.`,
    },
    quarters: {
      headers: ["Quarter", "Poss", "PPP", "Touch", "TO", "3PT"],
      numeric: [1, 2, 3, 4, 5],
      rows: off.byQuarter.map((q) =>
        thinRow([q.quarter === "OT" ? "Overtime" : `${q.quarter}${["st", "nd", "rd"][q.quarter - 1] || "th"} quarter`,
                 String(q.possessions), pppCell(q, off.overall.ppp), pc(q.touchRate),
                 pc(q.toRate), shots(q.m3, q.a3)], q.possessions)
      ),
    },
    players: {
      headers: ["Player", "Poss touched", "Share", "PPP", "TO"],
      numeric: [1, 2, 3, 4],
      rows: off.byPlayer.map((p) =>
        thinRow([p.number ? `#${p.number} ${p.name}` : p.name, String(p.possessionsTouched),
                 pc(rate(p.possessionsTouched, t.possessions)),
                 pppCell({ ppp: p.ppp, possessions: p.possessionsTouched }, t.ppp), pc(p.toRate)],
                p.possessionsTouched)
      ),
      note: "Possessions this player touched the paint in, and what those possessions produced — not the " +
            "player's own shots or turnovers. The app never records who shot or who lost the ball.",
    },
  };
}

function defenseDetail({ perGame, def, G }) {
  const gameLog = {
    headers: ["Game", "Result", "PnR trips", "PPP allowed", "Clean", "PPP clean", "PPP broken", "Forced TO", "FT trips"],
    numeric: [2, 3, 4, 5, 6, 7, 8],
    rows: perGame.map(({ game, def: d }) => ({
      cells: [
        gameCell(game), resultCell(game), String(d.overall.trips), f2(d.overall.ppp),
        pc(d.overall.cleanRate), f2(d.executionSplit.clean.ppp), f2(d.executionSplit.broken.ppp),
        pc(d.overall.forcedTurnoverRate), String(d.overall.ft),
      ],
    })).concat([{
      total: true,
      cells: [
        `${G} game${G === 1 ? "" : "s"}`, "", String(def.overall.trips), f2(def.overall.ppp),
        pc(def.overall.cleanRate), f2(def.executionSplit.clean.ppp), f2(def.executionSplit.broken.ppp),
        pc(def.overall.forcedTurnoverRate), String(def.overall.ft),
      ],
    }]),
  };

  // Who makes a given breakdown, read back from the per-player lists so the
  // coverage table can name names without a second pass over possessions.
  const whoMakes = (mistakeId) =>
    def.byPlayer
      .map((p) => ({ name: p.name, n: (p.breakdowns.find((b) => b.id === mistakeId) || {}).count || 0 }))
      .filter((p) => p.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 3)
      .map((p) => `${p.name} ${p.n}`)
      .join(" · ");

  const coverageRows = [];
  for (const c of def.byCoverage) {
    coverageRows.push({
      group: true,
      cells: [c.name, String(c.trips), pppCell(c, def.overall.ppp, { lowerIsBetter: true }),
              `clean ${pc(c.cleanRate)}`, `${f2(c.ppp)} allowed`, shots(c.m3 ?? 0, c.a3 ?? 0)],
    });
    for (const b of c.breakdowns) {
      coverageRows.push(thinRow(
        [`— ${b.name}`, String(b.count), pppCell(b, def.executionSplit.clean.ppp, { lowerIsBetter: true }),
         `${pc(b.share)} of trips`, whoMakes(b.id) || "no player tagged", shots(b.m3 ?? 0, b.a3 ?? 0)],
        b.possessions
      ));
    }
  }

  // How many different games a player's breakdowns are spread over: one bad
  // night reads very differently from the same total every week.
  const gamesWith = new Map();
  for (const { game, def: d } of perGame) {
    for (const p of d.byPlayer) {
      if (!gamesWith.has(p.id)) gamesWith.set(p.id, new Set());
      gamesWith.get(p.id).add(game.id);
    }
  }

  return {
    gameLog,
    coverages: {
      headers: ["Coverage / breakdown", "Trips", "PPP allowed", "Share", "Who / clean", "3PT allowed"],
      numeric: [1, 2],
      rows: coverageRows,
      note: `Breakdown rows are green or red against the ${f2(def.executionSplit.clean.ppp)} a possession run ` +
            `right gives up. Only pick-and-roll possessions are tracked.`,
    },
    players: {
      headers: ["Player", "Breakdowns", "Which", "Games"],
      numeric: [1, 3],
      rows: def.byPlayer.map((p) => ({
        cells: [
          p.number ? `#${p.number} ${p.name}` : p.name,
          String(p.mistakes),
          p.breakdowns.slice(0, 2).map((b) => `${b.name} ${b.count}`).join(" · "),
          String((gamesWith.get(p.id) || new Set()).size),
        ],
      })),
      note: `Counts, not rates: more minutes means more chances. ${def.overall.unassigned} breakdown` +
            `${def.overall.unassigned === 1 ? "" : "s"} had no player tagged. Every one has a clip time in the ` +
            `game's defense stats.`,
    },
    quarters: {
      headers: ["Quarter", "Trips", "PPP allowed", "Broken"],
      numeric: [1, 2, 3],
      rows: def.byQuarter.map((q) => ({
        cells: [q.quarter === "OT" ? "Overtime" : `${q.quarter}${["st", "nd", "rd"][q.quarter - 1] || "th"} quarter`,
                String(q.trips), pppCell(q, def.overall.ppp, { lowerIsBetter: true }), pc(q.mistakeRate)],
        thin: q.possessions < MIN_SAMPLE,
      })),
    },
  };
}

// ---------------------------------------------------------------------
// The last game against everything before it.
//
// One game is a small sample — 80 possessions on a good night — so this is
// deliberately a "worth a look" panel and never a trend. A change is only
// coloured once it clears 0.10 PPP or 5 percentage points, and the note says
// so. The two lists underneath are the ones that get used on Monday: every
// breakdown and every turnover, with enough to find the moment on video.
// ---------------------------------------------------------------------

const PPP_MOVE = 0.1;   // below this a game-to-game change is noise
const RATE_MOVE = 0.05;

const isClean = (p) => isNoMistake(p.mistake);

const quarterName = (q) => (q === "OT" ? "OT" : `Q${q}`);

// Two clocks, because neither is enough alone: the wall clock matches a phone
// video's timestamp, the elapsed time matches a recording started at tip-off.
// A game logged afterwards from video has neither, which the note says.
const tappedCells = (p, game) => [
  p.startedAt ? formatClock(p.startedAt) : "—",
  formatElapsed(p.startedAt, game.createdAt) || "—",
];

function lastGameDetail({ entries, perGame, G, before: earlier }) {
  if (G === 0) return null;

  const { game, possessions } = entries[entries.length - 1];
  const now = perGame[perGame.length - 1];
  const before = earlier || entries.slice(0, -1);

  const metrics = [
    ["Offense PPP", (s) => s.off.overall.ppp, "ppp", 1],
    ["Possessions reaching the paint",
      (s) => rate(s.off.touchSplit.withTouches.possessions, s.off.overall.possessions), "rate", 1],
    ["PPP with a paint touch", (s) => s.off.touchSplit.withTouches.ppp, "ppp", 1],
    ["PPP without", (s) => s.off.touchSplit.noTouches.ppp, "ppp", 1],
    ["Turnover rate", (s) => s.off.overall.toRate, "rate", -1],
    ["PnR PPP allowed", (s) => s.def.overall.ppp, "ppp", -1],
    ["PnR trips run clean", (s) => s.def.overall.cleanRate, "rate", 1],
    ["PPP allowed on a breakdown", (s) => s.def.executionSplit.broken.ppp, "ppp", -1],
  ];

  let comparison = null;
  if (before.length) {
    const prev = totals(before);
    comparison = {
      headers: ["", `Previous ${before.length} game${before.length === 1 ? "" : "s"}`,
                game.opponent || "Last game", "Change"],
      numeric: [1, 2, 3],
      rows: metrics.map(([label, read, kind, better]) => {
        const was = read(prev);
        const is = read(now);
        const fmt = kind === "ppp" ? f2 : pc;
        let change = "—";
        if (was !== null && was !== undefined && is !== null && is !== undefined) {
          const diff = is - was;
          const shown = kind === "ppp"
            ? `${diff >= 0 ? "+" : ""}${diff.toFixed(2)}`
            : `${diff >= 0 ? "+" : ""}${Math.round(diff * 100)} pts`;
          const moved = Math.abs(diff) >= (kind === "ppp" ? PPP_MOVE : RATE_MOVE);
          change = moved ? cell(shown, diff * better > 0 ? "good" : "bad") : shown;
        }
        return { cells: [label, fmt(was), cell(fmt(is), null), change] };
      }),
      note: `One game is a small sample — ${now.off.overall.possessions} possessions on offense and ` +
            `${now.def.overall.trips} pick-and-roll trips. A change is only coloured once it clears ` +
            `${PPP_MOVE.toFixed(2)} PPP or ${Math.round(RATE_MOVE * 100)} percentage points, and even then it is ` +
            `worth a look, not a trend.`,
    };
  }

  const breakdownRows = possessions
    .filter((p) => sideOf(p) === SIDES.DEFENSE && !isClean(p))
    .map((p) => ({
      cells: [
        quarterName(p.quarter), ...tappedCells(p, game),
        p.coverage ? p.coverage.coverageName : "—",
        p.mistake.mistakeName || "unnamed breakdown",
        p.mistakePlayer
          ? (p.mistakePlayer.playerNumber ? `#${p.mistakePlayer.playerNumber} ${p.mistakePlayer.playerName}` : p.mistakePlayer.playerName)
          : "no player tagged",
        `${DEFENSE_OUTCOME_LABELS[p.outcome] || p.outcome} · ${p.points}`,
      ],
    }));

  const turnoverRows = possessions
    .filter((p) => sideOf(p) === SIDES.OFFENSE && p.outcome === "TO")
    .map((p) => ({
      cells: [
        quarterName(p.quarter), ...tappedCells(p, game), playNameOf(p),
        // Whether it was lost before the paint or after is the whole point of
        // the first finding, so it is spelled out for every one of them.
        p.touches && p.touches.length ? "yes" : cell("no", "bad"),
      ],
    }));

  return {
    game,
    comparison,
    breakdowns: {
      headers: ["Q", "Tapped", "Into game", "Coverage", "Breakdown", "Player", "Result"],
      numeric: [],
      rows: breakdownRows,
    },
    turnovers: {
      headers: ["Q", "Tapped", "Into game", "Play", "Touch"],
      numeric: [],
      rows: turnoverRows,
    },
    note: "“Tapped” is the iPad clock when the possession was logged; “into game” counts from when the game " +
          "was started. A game logged afterwards from video has neither — go by quarter and order instead.",
  };
}
