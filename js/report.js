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

export function buildReport(entries) {
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

  const ctx = { entries, games, G, off, def, perGame, t, n, clean, broken, costPerGame };

  return {
    games, G, off, def, perGame, costPerGame,
    record: record(games),
    tiles: tiles(ctx),
    sides: winsAndLosses(ctx),
    findings: findings(ctx),
    priorities: priorities(ctx),
    caveats: caveats(ctx),
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
      label: "Points a game lost to PnR breakdowns",
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

function findings(ctx) {
  const { off, def, t, n, G, perGame, clean, broken, costPerGame } = ctx;
  const out = [];

  if (t.ppp !== null && n.ppp !== null) {
    const held = perGame.filter(
      (g) => g.off.touchSplit.withTouches.ppp !== null &&
             g.off.touchSplit.noTouches.ppp !== null &&
             g.off.touchSplit.withTouches.ppp > g.off.touchSplit.noTouches.ppp
    ).length;
    out.push({
      lead: `Reaching the paint is worth ${f2(t.ppp - n.ppp)} points a possession.`,
      text: `${f2(t.ppp)} with a paint touch, ${f2(n.ppp)} without, and the gap held in ${held} of ${G} games. ` +
            `${pc(rate(t.possessions, off.overall.possessions))} of possessions get there.`,
    });

    if (off.overall.turnovers > 0) {
      out.push({
        lead: "Possessions that never reach the paint are lost to turnovers.",
        text: `${n.turnovers} of ${off.overall.turnovers} turnovers came on them (${pc(n.toRate)} of those ` +
              `possessions, against ${pc(t.toRate)} after a touch). With turnovers set aside the gap shrinks to ` +
              `${f2(pppNoTurnovers(t))} vs ${f2(pppNoTurnovers(n))} — real, but smaller.`,
      });
    }

    const t3 = rate(t.m3, t.a3);
    const n3 = rate(n.m3, n.a3);
    if (t3 !== null && n3 !== null) {
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

  if (costPerGame !== null) {
    out.push({
      lead: `A pick-and-roll breakdown costs ${f2(broken.ppp - clean.ppp)} points.`,
      text: `${f2(clean.ppp)} allowed when the coverage is run right, ${f2(broken.ppp)} when it breaks. ` +
            `${pc(def.overall.mistakeRate)} of trips break down — about ${Math.round(def.overall.mistakes / G)} a game, ` +
            `roughly ${Math.round(costPerGame)} points a game.`,
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
    out.push({
      lead: "The defense is sharpest late, loosest early.",
      text: `${pc(worst.mistakeRate)} of trips break down in the ${ORD[worst.quarter]} quarter, ` +
            `${pc(best.mistakeRate)} in the ${ORD[best.quarter]}.`,
    });
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
      if (top && top.row.trips / totalTrips >= 0.5) {
        const who = top.game.opponent || "one opponent";
        text += used.length === 1
          ? ` But all ${totalTrips} of its trips came against ${who}, so it says more about one game plan than about the coverage.`
          : ` But it has been used in only ${used.length} of ${G} games, and ${top.row.trips} of its ${totalTrips} trips came against ${who} — too few games to call it better yet.`;
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
