// The defensive half of the stats, rendered from the same possession list
// the live screen and History already hold. Read it the opposite way to the
// offensive panel: here a *low* PPP is a good night.

import { el, formatPPP } from "../utils.js";
import { computeDefenseStats, computeTagStats } from "../stats.js";
import { statTile, formatRatio, table } from "./stats-panel.js";

export function renderDefenseStatsPanel(possessions, tagEvents = []) {
  const stats = computeDefenseStats(possessions);
  const tagStats = computeTagStats(tagEvents);
  const quarterLabel = (q) => (q === "OT" ? "OT" : `Q${q}`);

  // Quick tags stand on their own — they aren't possessions, so they show
  // up even in a game where no pick-and-roll was ever logged.
  const tagCards = tagStats.map((tag) =>
    el("div", { class: "card" }, [
      el("div", { class: "section-label" }, `${tag.name} — ${tag.total} total`),
      table(
        ["Player", "Count"],
        tag.players.map((p) =>
          el("tr", {}, [
            el("td", {}, `#${p.number || "--"} ${p.name}`),
            el("td", {}, String(p.count)),
          ])
        )
      ),
    ])
  );

  if (stats.overall.possessions === 0) {
    return el("div", { class: "stats-panel stats-panel--defense" }, [
      ...tagCards,
      el("div", { class: "empty-state" },
        "No defensive possessions logged yet. Switch the game screen to DEFENSE and log a pick-and-roll to see these numbers."),
    ]);
  }

  return el("div", { class: "stats-panel stats-panel--defense" }, [
    el("div", { class: "stat-strip" }, [
      statTile("PPP allowed", formatPPP(stats.overall.points, stats.overall.possessions)),
      statTile("Points allowed", stats.overall.points),
      statTile("Possessions", stats.overall.possessions),
      statTile("Forced TOs", stats.overall.forcedTurnovers),
      statTile("Executed clean", formatRatio(stats.overall.cleanRate)),
    ]),

    // The whole point of logging breakdowns: what do they actually cost?
    // If these two numbers sit on top of each other, the mistakes being
    // tracked aren't the ones deciding possessions.
    el("div", { class: "card" }, [
      el("div", { class: "section-label" }, "What a breakdown costs"),
      el("div", { class: "stat-strip" }, [
        statTile("PPP when clean", formatPPP(stats.executionSplit.clean.points, stats.executionSplit.clean.possessions)),
        statTile("PPP when broken", formatPPP(stats.executionSplit.broken.points, stats.executionSplit.broken.possessions)),
      ]),
      el("div", { class: "stat-strip" }, [
        statTile("Clean poss.", stats.executionSplit.clean.possessions),
        statTile("Broken poss.", stats.executionSplit.broken.possessions),
      ]),
    ]),

    el("div", { class: "card" }, [
      el("div", { class: "section-label" }, "By coverage"),
      table(
        ["Coverage", "Poss", "PPP allowed", "Clean %", "Forced TO %"],
        stats.byCoverage.map((c) =>
          el("tr", {}, [
            el("td", {}, c.name),
            el("td", {}, String(c.possessions)),
            el("td", {}, formatPPP(c.points, c.possessions)),
            el("td", {}, formatRatio(c.cleanRate)),
            el("td", {}, formatRatio(c.forcedTurnoverRate)),
          ])
        )
      ),
    ]),

    el("div", { class: "card" }, [
      el("div", { class: "section-label" }, "Most common breakdowns"),
      stats.byMistake.length === 0
        ? el("div", { class: "empty-state empty-state--tight" }, "No breakdowns logged — every possession was executed clean.")
        : table(
            ["Breakdown", "Times", "Share of poss.", "PPP allowed"],
            stats.byMistake.map((m) =>
              el("tr", {}, [
                el("td", {}, m.name),
                el("td", {}, String(m.count)),
                el("td", {}, formatRatio(m.share)),
                el("td", {}, formatPPP(m.points, m.count)),
              ])
            )
          ),
    ]),

    el("div", { class: "card" }, [
      el("div", { class: "section-label" }, "Breakdowns by player"),
      // Raw counts, and deliberately not a rate: we record who erred, never
      // who defended a pick-and-roll cleanly, so there is no honest
      // denominator. A player who defends forty of these will out-count one
      // who defends five, and that is not the same as being worse.
      el("div", { class: "stat-note" },
        "Counts only. We don't record how many pick-and-rolls each player defended, so these can't be turned into a rate — a player who guards more of them will appear more often."),
      stats.byPlayer.length === 0
        ? el("div", { class: "empty-state empty-state--tight" }, "No breakdowns assigned to a player yet.")
        : table(
            ["Player", "Breakdowns", "PPP allowed on those"],
            stats.byPlayer.map((p) =>
              el("tr", {}, [
                el("td", {}, `#${p.number || "--"} ${p.name}`),
                el("td", {}, String(p.mistakes)),
                el("td", {}, formatPPP(p.points, p.mistakes)),
              ])
            )
          ),
      stats.overall.unassigned > 0
        ? el("div", { class: "warn-note" },
            `${stats.overall.unassigned} breakdown${stats.overall.unassigned === 1 ? "" : "s"} logged without a player — not counted in the table above.`)
        : null,
    ]),

    el("div", { class: "card" }, [
      el("div", { class: "section-label" }, "By quarter"),
      table(
        ["Qtr", "Poss", "Pts allowed", "PPP allowed", "Breakdowns", "Breakdown %"],
        stats.byQuarter.map((q) =>
          el("tr", {}, [
            el("td", {}, quarterLabel(q.quarter)),
            el("td", {}, String(q.possessions)),
            el("td", {}, String(q.points)),
            el("td", {}, formatPPP(q.points, q.possessions)),
            el("td", {}, String(q.mistakes)),
            el("td", {}, formatRatio(q.mistakeRate)),
          ])
        )
      ),
    ]),

    ...tagCards,
  ]);
}
