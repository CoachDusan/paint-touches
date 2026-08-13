// Turns a flat list of possessions into every stat view in the app. Called
// both live (after every possession closes) and historically (once, on a
// frozen possession list) — same function, same math, so live and
// historical numbers can never disagree with each other.

import { QUARTERS } from "./possession.js";

function emptyBucket() {
  return { points: 0, possessions: 0 };
}

function add(bucket, possession) {
  bucket.points += possession.points;
  bucket.possessions += 1;
}

function ppp(bucket) {
  return bucket.possessions ? bucket.points / bucket.possessions : null;
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
        });
      }
      const playerBucket = byPlayer.get(t.playerId);
      playerBucket.touches += 1;
      if (!seen.has(t.playerId)) {
        seen.add(t.playerId);
        playerBucket.possessionsTouched += 1;
        playerBucket.points += p.points;
      }
    }
  }

  const quarterOrder = new Map(QUARTERS.map((q, i) => [q, i]));

  return {
    overall: { ...overall, ppp: ppp(overall) },
    touchSplit: {
      withTouches: { ...withTouches, ppp: ppp(withTouches) },
      noTouches: { ...noTouches, ppp: ppp(noTouches) },
    },
    byQuarter: [...byQuarter.entries()]
      .map(([quarter, b]) => ({ quarter, ...b, ppp: ppp(b) }))
      .sort((a, b) => (quarterOrder.get(a.quarter) ?? 99) - (quarterOrder.get(b.quarter) ?? 99)),
    byPlay: [...byPlay.entries()]
      .map(([id, b]) => ({
        id,
        name: b.name,
        points: b.points,
        possessions: b.possessions,
        ppp: ppp(b),
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
      }))
      .sort((a, b) => b.touches - a.touches),
  };
}
