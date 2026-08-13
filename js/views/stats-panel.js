// Shared stats rendering — used by the Live Tracking screen (recomputed
// after every possession) and, later, by the historical game detail view.
// Same computeStats() output in, same markup out, either way.

import { el, formatPPP } from "../utils.js";
import { computeStats } from "../stats.js";

function statTile(label, value) {
  return el("div", { class: "stat-tile" }, [
    el("div", { class: "stat-tile__value" }, value),
    el("div", { class: "stat-tile__label" }, label),
  ]);
}

function formatRatio(ratio) {
  return ratio === null || ratio === undefined ? "—" : Math.round(ratio * 100) + "%";
}

function table(headers, rows) {
  if (rows.length === 0) {
    return el("div", { class: "empty-state empty-state--tight" }, "No possessions logged yet.");
  }
  return el("div", { class: "stat-table-wrap" }, [
    el("table", { class: "stat-table" }, [
      el("thead", {}, el("tr", {}, headers.map((h) => el("th", {}, h)))),
      el("tbody", {}, rows),
    ]),
  ]);
}

export function renderStatsPanel(possessions) {
  const stats = computeStats(possessions);
  const quarterLabel = (q) => (q === "OT" ? "OT" : `Q${q}`);

  return el("div", { class: "stats-panel" }, [
    el("div", { class: "stat-strip" }, [
      statTile("PPP", formatPPP(stats.overall.points, stats.overall.possessions)),
      statTile("Points", stats.overall.points),
      statTile("Possessions", stats.overall.possessions),
      statTile("Turnovers", stats.overall.turnovers),
      statTile("TO rate", formatRatio(stats.overall.toRate)),
    ]),

    el("div", { class: "card" }, [
      el("div", { class: "section-label" }, "Paint touches vs. none"),
      el("div", { class: "stat-strip" }, [
        statTile("PPP w/ touch", formatPPP(stats.touchSplit.withTouches.points, stats.touchSplit.withTouches.possessions)),
        statTile("PPP no touch", formatPPP(stats.touchSplit.noTouches.points, stats.touchSplit.noTouches.possessions)),
      ]),
      el("div", { class: "stat-strip" }, [
        statTile("Poss. w/ touch", stats.touchSplit.withTouches.possessions),
        statTile("Poss. no touch", stats.touchSplit.noTouches.possessions),
      ]),
      el("div", { class: "stat-strip" }, [
        statTile("TO rate w/ touch", formatRatio(stats.touchSplit.withTouches.toRate)),
        statTile("TO rate no touch", formatRatio(stats.touchSplit.noTouches.toRate)),
      ]),
    ]),

    el("div", { class: "card" }, [
      el("div", { class: "section-label" }, "By quarter"),
      table(
        ["Qtr", "Poss", "Pts", "PPP", "TO", "TO rate"],
        stats.byQuarter.map((q) =>
          el("tr", {}, [
            el("td", {}, quarterLabel(q.quarter)),
            el("td", {}, String(q.possessions)),
            el("td", {}, String(q.points)),
            el("td", {}, formatPPP(q.points, q.possessions)),
            el("td", {}, String(q.turnovers)),
            el("td", {}, formatRatio(q.toRate)),
          ])
        )
      ),
    ]),

    el("div", { class: "card" }, [
      el("div", { class: "section-label" }, "By play"),
      table(
        ["Play", "Poss", "PPP", "TO", "TO rate", "Touch rate"],
        stats.byPlay.map((p) =>
          el("tr", {}, [
            el("td", {}, p.name),
            el("td", {}, String(p.possessions)),
            el("td", {}, formatPPP(p.points, p.possessions)),
            el("td", {}, String(p.turnovers)),
            el("td", {}, formatRatio(p.toRate)),
            el("td", {}, formatRatio(p.touchRate)),
          ])
        )
      ),
    ]),

    el("div", { class: "card" }, [
      el("div", { class: "section-label" }, "By player (paint touches)"),
      table(
        ["Player", "Touches", "Poss. touched", "PPP of those poss.", "TOs in those poss."],
        stats.byPlayer.map((pl) =>
          el("tr", {}, [
            el("td", {}, `#${pl.number || "--"} ${pl.name}`),
            el("td", {}, String(pl.touches)),
            el("td", {}, String(pl.possessionsTouched)),
            el("td", {}, pl.ppp === null ? "—" : pl.ppp.toFixed(2)),
            el("td", {}, String(pl.turnovers)),
          ])
        )
      ),
    ]),
  ]);
}
