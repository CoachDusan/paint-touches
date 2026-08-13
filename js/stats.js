// Turns a flat list of possessions into every stat view in the app. Called
// both live (after every possession closes) and historically (once, on a
// frozen possession list) — same function, same math, so live and
// historical numbers can never disagree with each other.

import { QUARTERS } from "./possession.js";

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

export function computeStats(possessions) {
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
