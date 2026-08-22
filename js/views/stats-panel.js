// Shared stats rendering — used by the Live Tracking screen (recomputed
// after every possession) and, later, by the historical game detail view.
// Same computeStats() output in, same markup out, either way.

import { el, formatPPP } from "../utils.js";
import { computeStats } from "../stats.js";
import { getTableSort, cycleTableSort, columnIsNumeric, sortRows } from "../sort.js";

export function statTile(label, value) {
  return el("div", { class: "stat-tile" }, [
    el("div", { class: "stat-tile__value" }, value),
    el("div", { class: "stat-tile__label" }, label),
  ]);
}

export function formatRatio(ratio) {
  return ratio === null || ratio === undefined ? "—" : Math.round(ratio * 100) + "%";
}

/**
 * A stats table. Pass a `tableId` and every column header becomes tappable:
 * tap to sort by it, tap again to reverse, tap a third time to go back to
 * the order the app chose.
 *
 * The chosen column is remembered outside this function, so when the live
 * panel rebuilds itself after a possession the table comes back sorted the
 * same way — with the new numbers folded in, which is the point.
 *
 * Sorting reads the rendered cells rather than the raw stats, so every
 * table gets it without each caller having to describe its own columns.
 * That works because these cells are plain text; anything richer than a
 * number, a percentage, or a name would need a different approach.
 */
export function table(headers, rows, tableId = null) {
  if (rows.length === 0) {
    return el("div", { class: "empty-state empty-state--tight" }, "No possessions logged yet.");
  }

  const defaultOrder = [...rows];
  const body = el("tbody", {}, rows);
  const headerRow = el("tr", {});

  function applySort() {
    const sort = tableId ? getTableSort(tableId) : null;
    body.replaceChildren(
      ...(sort && sort.column < headers.length
        ? sortRows(defaultOrder, sort.column, sort.dir)
        : defaultOrder)
    );
    for (const [index, cell] of [...headerRow.children].entries()) {
      const active = sort && sort.column === index;
      cell.classList.toggle("is-sorted", !!active);
      const arrow = cell.querySelector(".sort-arrow");
      // A faint up-down marker on every sortable column, so it's visible
      // that a header can be tapped before anyone has tapped one.
      if (arrow) {
        arrow.textContent = active ? (sort.dir === "asc" ? "\u2191" : "\u2193") : "\u21c5";
        arrow.classList.toggle("sort-arrow--idle", !active);
      }
    }
  }

  headerRow.replaceChildren(
    ...headers.map((label, index) => {
      // An unlabelled column (the trend bar on the Season screen) has
      // nothing to sort by and nothing to put a label on.
      if (!tableId || !label) return el("th", {}, label);
      return el("th", { class: "stat-table__th--sortable" }, [
        el("button", {
          type: "button",
          class: "sort-th",
          onclick: () => {
            cycleTableSort(tableId, index, columnIsNumeric(defaultOrder, index));
            applySort();
          },
        }, [el("span", {}, label), el("span", { class: "sort-arrow" }, "\u21c5")]),
      ]);
    })
  );

  applySort();

  return el("div", { class: "stat-table-wrap" }, [
    el("table", { class: "stat-table" }, [el("thead", {}, headerRow), body]),
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
        ),
        "off-quarter"
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
        ),
        "off-play"
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
        ),
        "off-player"
      ),
    ]),
  ]);
}
