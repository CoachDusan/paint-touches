// Turns your data into files other people (and other machines) can read.
// Everything here is a pure string-builder — no sharing, no downloading —
// so the awkward, browser-specific delivery lives in share.js and this can
// be checked by reading it.

import { formatDate, formatPPP } from "./utils.js";
import { computeStats, computeDefenseStats, computeTagStats } from "./stats.js";
import { gameResult, VENUES } from "./models.js";

const venueLabel = (key) => VENUES.find((v) => v.key === key)?.label || "";

function gameTitle(game) {
  const who = game.opponent ? `vs ${game.opponent}` : "Game";
  const where = game.venue ? ` (${venueLabel(game.venue)})` : "";
  return `${who} — ${formatDate(game.date)}${where}`;
}

function scoreLine(game) {
  if (game.ourScore == null || game.theirScore == null) return null;
  const result = gameResult(game);
  return `Final: ${game.ourScore}–${game.theirScore}${result ? ` (${result})` : ""}`;
}

const pct = (r) => (r === null || r === undefined ? "—" : Math.round(r * 100) + "%");

// ---------------------------------------------------------------------
// Readable summary — written to survive being pasted into a group chat,
// so: no tables, no fixed-width alignment, nothing that depends on a font.
// ---------------------------------------------------------------------
export function buildSummaryText({ title, possessions, tagEvents = [], subtitle = null }) {
  const off = computeStats(possessions);
  const def = computeDefenseStats(possessions);
  const tags = computeTagStats(tagEvents);
  const lines = [`🏀 ${title}`];

  if (subtitle) lines.push(subtitle);

  if (off.overall.possessions > 0) {
    lines.push("", "OFFENSE");
    lines.push(`PPP ${formatPPP(off.overall.points, off.overall.possessions)} · ${off.overall.possessions} poss · ${off.overall.points} pts`);
    lines.push(`Turnovers ${off.overall.turnovers} (${pct(off.overall.toRate)})`);
    lines.push(`Paint touch: ${formatPPP(off.touchSplit.withTouches.points, off.touchSplit.withTouches.possessions)} PPP (${off.touchSplit.withTouches.possessions} poss)`);
    lines.push(`No touch: ${formatPPP(off.touchSplit.noTouches.points, off.touchSplit.noTouches.possessions)} PPP (${off.touchSplit.noTouches.possessions} poss)`);

    if (off.byPlay.length) {
      lines.push("", "By play:");
      for (const p of off.byPlay) {
        lines.push(`• ${p.name} — ${p.possessions} poss, ${formatPPP(p.points, p.possessions)} PPP, ${pct(p.touchRate)} touch`);
      }
    }
  }

  if (def.overall.possessions > 0) {
    lines.push("", "DEFENSE (pick & roll)");
    lines.push(`PPP allowed ${formatPPP(def.overall.points, def.overall.possessions)} · ${def.overall.possessions} poss`);
    lines.push(`Executed clean ${pct(def.overall.cleanRate)} · forced TOs ${def.overall.forcedTurnovers}`);
    lines.push(`When clean: ${formatPPP(def.executionSplit.clean.points, def.executionSplit.clean.possessions)} · when broken: ${formatPPP(def.executionSplit.broken.points, def.executionSplit.broken.possessions)}`);

    if (def.byCoverage.length) {
      lines.push("", "By coverage:");
      for (const c of def.byCoverage) {
        lines.push(`• ${c.name} — ${c.possessions} poss, ${formatPPP(c.points, c.possessions)} allowed, ${pct(c.cleanRate)} clean`);
      }
    }
    if (def.byMistake.length) {
      lines.push("", "Breakdowns:");
      for (const m of def.byMistake) {
        lines.push(`• ${m.name} — ${m.count} (${pct(m.share)})`);
      }
    }
  }

  for (const tag of tags) {
    lines.push("", `${tag.name.toUpperCase()} — ${tag.total}`);
    for (const p of tag.players) {
      lines.push(`• #${p.number || "--"} ${p.name} — ${p.count}`);
    }
  }

  if (off.overall.possessions === 0 && def.overall.possessions === 0 && tags.length === 0) {
    lines.push("", "No possessions logged.");
  }

  // Says where the numbers came from, because a summary read out of context
  // invites being mistaken for the box score.
  lines.push("", "Counts only tracked possessions — not the full box score.");
  lines.push("Tracked with Paint Touches");
  return lines.join("\n");
}

export function buildGameSummaryText(game, possessions, tagEvents) {
  return buildSummaryText({
    title: gameTitle(game),
    subtitle: scoreLine(game),
    possessions,
    tagEvents,
  });
}

export function buildSeasonSummaryText(games, possessions, tagEvents) {
  const scored = games.filter((g) => gameResult(g));
  const w = scored.filter((g) => gameResult(g) === "W").length;
  const l = scored.filter((g) => gameResult(g) === "L").length;
  const t = scored.filter((g) => gameResult(g) === "T").length;
  const record = scored.length ? `Record ${w}-${l}${t ? `-${t}` : ""}` : null;

  return buildSummaryText({
    title: `Season — ${games.length} game${games.length === 1 ? "" : "s"}`,
    subtitle: record,
    possessions,
    tagEvents,
  });
}

// ---------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------
const CSV_COLUMNS = [
  "record_type", "game_date", "opponent", "venue", "our_score", "their_score", "result",
  "quarter", "sequence", "side", "play", "coverage", "mistake", "mistake_player",
  "paint_touches", "outcome", "points", "tag", "tag_player",
];

// Quotes every field rather than guessing which need it: a play called
// 5 "Out" or an opponent with a comma would otherwise split a row in two.
function csvCell(value) {
  if (value === null || value === undefined) return '""';
  return `"${String(value).replace(/"/g, '""')}"`;
}

function csvRow(map) {
  return CSV_COLUMNS.map((col) => csvCell(map[col])).join(",");
}

function gameFields(game) {
  return {
    game_date: game.date,
    opponent: game.opponent || "",
    venue: game.venue ? venueLabel(game.venue) : "",
    our_score: game.ourScore ?? "",
    their_score: game.theirScore ?? "",
    result: gameResult(game) || "",
  };
}

// One file holding both possessions and tag events, told apart by
// record_type. Two separate downloads would be tidier in the abstract and
// worse to actually use.
export function buildCSV(entries) {
  const rows = [CSV_COLUMNS.join(",")];

  for (const { game, possessions, tagEvents = [] } of entries) {
    const base = gameFields(game);

    for (const p of possessions) {
      rows.push(csvRow({
        ...base,
        record_type: "possession",
        quarter: p.quarter,
        sequence: p.sequenceNumber,
        side: p.side === "defense" ? "defense" : "offense",
        play: p.play?.playName || "",
        coverage: p.coverage?.coverageName || "",
        mistake: p.mistake?.mistakeName || "",
        mistake_player: p.mistakePlayer ? `#${p.mistakePlayer.playerNumber || "--"} ${p.mistakePlayer.playerName}` : "",
        paint_touches: (p.touches || []).map((t) => `#${t.playerNumber || "--"}`).join(" "),
        outcome: p.outcome,
        points: p.points,
      }));
    }

    for (const e of tagEvents) {
      rows.push(csvRow({
        ...base,
        record_type: "tag",
        quarter: e.quarter,
        tag: e.tagName,
        tag_player: `#${e.playerNumber || "--"} ${e.playerName}`,
      }));
    }
  }

  return rows.join("\n");
}

// ---------------------------------------------------------------------
// Backup. Every store, verbatim, so restoring reproduces the app exactly —
// this is the only copy of a season that exists off the iPad.
// ---------------------------------------------------------------------
export const BACKUP_FORMAT = 1;

export const BACKUP_STORES = [
  "players", "plays", "coverages", "mistakes", "quickTags",
  "games", "possessions", "tagEvents",
];

export function buildBackup(data) {
  return JSON.stringify(
    {
      format: BACKUP_FORMAT,
      app: "paint-touches",
      exportedAt: new Date().toISOString(),
      data,
    },
    null,
    2
  );
}

// Deliberately strict. A restore wipes what's already there, so a file it
// can't fully vouch for must be refused rather than half-applied.
export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't readable as a backup (it isn't valid JSON)." };
  }

  if (!parsed || parsed.app !== "paint-touches") {
    return { ok: false, error: "That doesn't look like a Paint Touches backup." };
  }
  if (parsed.format !== BACKUP_FORMAT) {
    return { ok: false, error: `That backup is format ${parsed.format}, and this app reads format ${BACKUP_FORMAT}.` };
  }
  if (!parsed.data || typeof parsed.data !== "object") {
    return { ok: false, error: "That backup has no data in it." };
  }
  for (const store of BACKUP_STORES) {
    if (parsed.data[store] !== undefined && !Array.isArray(parsed.data[store])) {
      return { ok: false, error: `That backup is damaged — "${store}" isn't a list.` };
    }
  }

  const counts = Object.fromEntries(BACKUP_STORES.map((s) => [s, (parsed.data[s] || []).length]));
  return { ok: true, data: parsed.data, counts, exportedAt: parsed.exportedAt };
}

export function backupFilename(date = new Date()) {
  return `paint-touches-backup-${date.toISOString().slice(0, 10)}.json`;
}
