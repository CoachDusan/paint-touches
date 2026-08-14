// Turns a flat list of possessions into every stat view in the app. Called
// both live (after every possession closes) and historically (once, on a
// frozen possession list) — same function, same math, so live and
// historical numbers can never disagree with each other.

import { QUARTERS, SIDES, sideOf, NO_MISTAKE } from "./possession.js";

function emptyBucket() {
  return { points: 0, possessions: 0, turnovers: 0 };
}

function add(bucket, possession) {
  bucket.points += possession.points;
  bucket.possessions += 1;
  if (possession.outcome === "TO") bucket.turnovers += 1;
}

function ppp(bucket) {
  return bucket.possessions ? bucket.points / bucket.possessions : null;
}

// Turnovers as a share of possessions — the standard way to read TOs, since
// a raw count means nothing without knowing how many possessions it took.
function toRate(bucket) {
  return bucket.possessions ? bucket.turnovers / bucket.possessions : null;
}

// Offensive stats only. Defensive possessions live in the same list and
// carry points *allowed* in the same field, so without this filter every
// number here — PPP above all — would quietly blend both teams' scoring.
export function computeStats(allPossessions) {
  const possessions = allPossessions.filter((p) => sideOf(p) === SIDES.OFFENSE);

  const overall = emptyBucket();
  const withTouches = emptyBucket();
  const noTouches = emptyBucket();
  const byQuarter = new Map();
  const byPlay = new Map();
  const byPlayer = new Map();

  for (const p of possessions) {
    add(overall, p);
    add(p.touches.length > 0 ? withTouches : noTouches, p);

    if (!byQuarter.has(p.quarter)) byQuarter.set(p.quarter, emptyBucket());
    add(byQuarter.get(p.quarter), p);

    const playKey = p.play ? p.play.playId ?? "transition" : "transition";
    if (!byPlay.has(playKey)) {
      byPlay.set(playKey, {
        name: p.play ? p.play.playName : "Transition / No Play",
        ...emptyBucket(),
        touchPossessions: 0,
      });
    }
    const playBucket = byPlay.get(playKey);
    add(playBucket, p);
    if (p.touches.length > 0) playBucket.touchPossessions += 1;

    // Every player who touched this possession shares "credit" for it —
    // counted once each, even if a player touched the ball twice in the
    // same possession (this is about possessions they were involved in,
    // not raw touch count).
    const seen = new Set();
    for (const t of p.touches) {
      if (!byPlayer.has(t.playerId)) {
        byPlayer.set(t.playerId, {
          name: t.playerName,
          number: t.playerNumber,
          touches: 0,
          possessionsTouched: 0,
          points: 0,
          turnovers: 0,
        });
      }
      const playerBucket = byPlayer.get(t.playerId);
      playerBucket.touches += 1;
      if (!seen.has(t.playerId)) {
        seen.add(t.playerId);
        playerBucket.possessionsTouched += 1;
        playerBucket.points += p.points;
        // Same honesty rule as points: this is "a possession he touched ended
        // in a turnover," NOT "he committed the turnover." We never record who
        // lost the ball, so we must never imply that we do.
        if (p.outcome === "TO") playerBucket.turnovers += 1;
      }
    }
  }

  const quarterOrder = new Map(QUARTERS.map((q, i) => [q, i]));

  return {
    overall: { ...overall, ppp: ppp(overall), toRate: toRate(overall) },
    touchSplit: {
      withTouches: { ...withTouches, ppp: ppp(withTouches), toRate: toRate(withTouches) },
      noTouches: { ...noTouches, ppp: ppp(noTouches), toRate: toRate(noTouches) },
    },
    byQuarter: [...byQuarter.entries()]
      .map(([quarter, b]) => ({ quarter, ...b, ppp: ppp(b), toRate: toRate(b) }))
      .sort((a, b) => (quarterOrder.get(a.quarter) ?? 99) - (quarterOrder.get(b.quarter) ?? 99)),
    byPlay: [...byPlay.entries()]
      .map(([id, b]) => ({
        id,
        name: b.name,
        points: b.points,
        possessions: b.possessions,
        ppp: ppp(b),
        turnovers: b.turnovers,
        toRate: toRate(b),
        touchRate: b.possessions ? b.touchPossessions / b.possessions : null,
      }))
      .sort((a, b) => b.possessions - a.possessions),
    byPlayer: [...byPlayer.entries()]
      .map(([id, b]) => ({
        id,
        name: b.name,
        number: b.number,
        touches: b.touches,
        possessionsTouched: b.possessionsTouched,
        ppp: b.possessionsTouched ? b.points / b.possessionsTouched : null,
        turnovers: b.turnovers,
        toRate: b.possessionsTouched ? b.turnovers / b.possessionsTouched : null,
      }))
      .sort((a, b) => b.touches - a.touches),
  };
}

// ---------------------------------------------------------------------
// Defence. A separate function rather than a branch inside computeStats,
// because almost nothing carries over: there are no touches, no plays, and
// `points` means points *allowed*. The one shared idea is PPP, which is
// still total points over total possessions — just read from the other
// bench, where lower is better.
// ---------------------------------------------------------------------

function isClean(possession) {
  return !possession.mistake || possession.mistake.mistakeId === NO_MISTAKE.id;
}

export function computeDefenseStats(allPossessions) {
  const possessions = allPossessions.filter((p) => sideOf(p) === SIDES.DEFENSE);

  const overall = emptyBucket();
  const clean = emptyBucket();
  const broken = emptyBucket();
  const byCoverage = new Map();
  const byMistake = new Map();
  const byPlayer = new Map();
  const byQuarter = new Map();

  let forcedTurnovers = 0;
  let unassigned = 0;

  for (const p of possessions) {
    add(overall, p);
    add(isClean(p) ? clean : broken, p);
    if (p.outcome === "TO") forcedTurnovers += 1;

    if (!byQuarter.has(p.quarter)) byQuarter.set(p.quarter, { ...emptyBucket(), mistakes: 0 });
    const quarterBucket = byQuarter.get(p.quarter);
    add(quarterBucket, p);
    if (!isClean(p)) quarterBucket.mistakes += 1;

    const coverageKey = p.coverage?.coverageId ?? "unknown";
    if (!byCoverage.has(coverageKey)) {
      byCoverage.set(coverageKey, {
        name: p.coverage?.coverageName || "Unrecorded",
        ...emptyBucket(),
        cleanPossessions: 0,
        forcedTurnovers: 0,
        breakdowns: new Map(),
      });
    }
    const coverageBucket = byCoverage.get(coverageKey);
    add(coverageBucket, p);
    if (isClean(p)) coverageBucket.cleanPossessions += 1;
    if (p.outcome === "TO") coverageBucket.forcedTurnovers += 1;

    if (isClean(p)) continue;

    // Which breakdowns happen inside which coverage. Read from what was
    // actually logged rather than from how mistakes are assigned, so a
    // mistake tapped under the wrong coverage shows up where it happened.
    if (!coverageBucket.breakdowns.has(p.mistake.mistakeId)) {
      coverageBucket.breakdowns.set(p.mistake.mistakeId, { name: p.mistake.mistakeName, ...emptyBucket() });
    }
    add(coverageBucket.breakdowns.get(p.mistake.mistakeId), p);

    const mistakeKey = p.mistake.mistakeId;
    if (!byMistake.has(mistakeKey)) {
      byMistake.set(mistakeKey, { name: p.mistake.mistakeName, ...emptyBucket() });
    }
    add(byMistake.get(mistakeKey), p);

    // A breakdown nobody was tagged for still counts as a breakdown — it
    // just can't be attributed. Surfaced so a pile of them is visible
    // rather than silently shrinking everyone's totals.
    if (!p.mistakePlayer) {
      unassigned += 1;
      continue;
    }

    const playerKey = p.mistakePlayer.playerId;
    if (!byPlayer.has(playerKey)) {
      byPlayer.set(playerKey, {
        name: p.mistakePlayer.playerName,
        number: p.mistakePlayer.playerNumber,
        ...emptyBucket(),
        breakdowns: new Map(),
        clips: [],
      });
    }
    const playerBucket = byPlayer.get(playerKey);
    add(playerBucket, p);

    if (!playerBucket.breakdowns.has(p.mistake.mistakeId)) {
      playerBucket.breakdowns.set(p.mistake.mistakeId, { name: p.mistake.mistakeName, count: 0 });
    }
    playerBucket.breakdowns.get(p.mistake.mistakeId).count += 1;

    // Enough to find the moment on video: which quarter, when it was tapped,
    // and what to look for. Timestamps have been recorded since the first
    // version, so this fills in for games already logged.
    playerBucket.clips.push({
      quarter: p.quarter,
      at: p.startedAt || p.closedAt || null,
      mistakeName: p.mistake.mistakeName,
      coverageName: p.coverage?.coverageName || null,
      outcome: p.outcome,
      points: p.points,
    });
  }

  const quarterOrder = new Map(QUARTERS.map((q, i) => [q, i]));
  const share = (n) => (overall.possessions ? n / overall.possessions : null);

  return {
    overall: {
      ...overall,
      ppp: ppp(overall),
      forcedTurnovers,
      forcedTurnoverRate: share(forcedTurnovers),
      mistakes: broken.possessions,
      mistakeRate: share(broken.possessions),
      cleanRate: share(clean.possessions),
      unassigned,
    },
    // The cost of a breakdown, in the only currency that matters. If these
    // two numbers are the same, the mistakes being logged aren't the ones
    // deciding possessions.
    executionSplit: {
      clean: { ...clean, ppp: ppp(clean) },
      broken: { ...broken, ppp: ppp(broken) },
    },
    byQuarter: [...byQuarter.entries()]
      .map(([quarter, b]) => ({
        quarter,
        ...b,
        ppp: ppp(b),
        mistakeRate: b.possessions ? b.mistakes / b.possessions : null,
      }))
      .sort((a, b) => (quarterOrder.get(a.quarter) ?? 99) - (quarterOrder.get(b.quarter) ?? 99)),
    byCoverage: [...byCoverage.entries()]
      .map(([id, b]) => ({
        id,
        name: b.name,
        possessions: b.possessions,
        points: b.points,
        ppp: ppp(b),
        cleanRate: b.possessions ? b.cleanPossessions / b.possessions : null,
        forcedTurnoverRate: b.possessions ? b.forcedTurnovers / b.possessions : null,
        breakdowns: [...b.breakdowns.entries()]
          .map(([id, m]) => ({
            id,
            name: m.name,
            count: m.possessions,
            share: b.possessions ? m.possessions / b.possessions : null,
            points: m.points,
            ppp: ppp(m),
          }))
          .sort((a, b2) => b2.count - a.count),
      }))
      .sort((a, b) => b.possessions - a.possessions),
    byMistake: [...byMistake.entries()]
      .map(([id, b]) => ({
        id,
        name: b.name,
        count: b.possessions,
        share: share(b.possessions),
        points: b.points,
        ppp: ppp(b),
      }))
      .sort((a, b) => b.count - a.count),
    byPlayer: [...byPlayer.entries()]
      .map(([id, b]) => ({
        id,
        name: b.name,
        number: b.number,
        mistakes: b.possessions,
        points: b.points,
        ppp: ppp(b),
        breakdowns: [...b.breakdowns.entries()]
          .map(([id, m]) => ({ id, name: m.name, count: m.count }))
          .sort((a, b2) => b2.count - a.count),
        // Chronological, because that's the order you'd scrub through video.
        clips: b.clips
          .slice()
          .sort((x, y) => (quarterOrder.get(x.quarter) ?? 99) - (quarterOrder.get(y.quarter) ?? 99) || (x.at || 0) - (y.at || 0)),
      }))
      .sort((a, b) => b.mistakes - a.mistakes),
  };
}

// ---------------------------------------------------------------------
// Quick tags. Not possessions, so not PPP — just how many times each player
// was tagged with each thing. One record per player per occurrence, so this
// is a straight count.
// ---------------------------------------------------------------------
export function computeTagStats(events) {
  const byTag = new Map();

  for (const e of events) {
    if (!byTag.has(e.tagId)) byTag.set(e.tagId, { name: e.tagName, total: 0, players: new Map() });
    const tag = byTag.get(e.tagId);
    tag.total += 1;

    if (!tag.players.has(e.playerId)) {
      tag.players.set(e.playerId, { name: e.playerName, number: e.playerNumber, count: 0 });
    }
    tag.players.get(e.playerId).count += 1;
  }

  return [...byTag.entries()]
    .map(([id, t]) => ({
      id,
      name: t.name,
      total: t.total,
      players: [...t.players.values()].sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.total - a.total);
}
