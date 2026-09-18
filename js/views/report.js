// The coach report on screen: answers first, numbers second, laid out to be
// read top to bottom and printed as it stands. Reached from Season rather than
// from a tab of its own — this is something made between games, never
// something reached for on the bench.
//
// Stage 1 is the page a head coach actually reads. The offense and defense
// detail pages, and the last game against the rest, come next.

import { el, formatDate } from "../utils.js";
import { Games, Possessions } from "../models.js";
import { buildReport } from "../report.js";
import { printCurrentView } from "../share.js";

function tile(t) {
  return el("div", { class: "stat-tile" }, [
    el("div", { class: "stat-tile__value" }, t.value),
    el("div", { class: "stat-tile__label" }, t.label),
    el("div", { class: "stat-tile__note" }, t.note),
  ]);
}

function panel(title, rows, tone) {
  return el("div", { class: "report-panel" + (tone ? " report-panel--" + tone : "") }, [
    el("div", { class: "section-label" }, title),
    ...rows.map(([label, value]) =>
      el("div", { class: "report-kv" }, [el("span", {}, label), el("b", {}, value)])
    ),
  ]);
}

// The detail tables. report.js decides what each cell says and whether it has
// earned green, red or grey; this only draws it.
function table(model) {
  const numeric = new Set(model.numeric || []);
  const draw = (c) => (typeof c === "string" ? { text: c } : c);

  return el("div", { class: "stat-table-wrap" }, [
    el("table", { class: "stat-table report-table" }, [
      el("thead", {}, [
        el("tr", {}, model.headers.map((h, i) =>
          el("th", { class: numeric.has(i) ? "num" : "" }, h)
        )),
      ]),
      el("tbody", {}, model.rows.map((r) =>
        el("tr", {
          class: [r.thin ? "is-thin" : "", r.total ? "is-total" : "", r.group ? "is-group" : ""]
            .filter(Boolean).join(" "),
        }, r.cells.map((c, i) => {
          const cell = draw(c);
          return el("td", {
            class: [numeric.has(i) ? "num" : "", cell.tone ? "tone-" + cell.tone : ""]
              .filter(Boolean).join(" "),
          }, cell.text);
        }))
      )),
    ]),
  ]);
}

function tableCard(title, model) {
  return el("div", { class: "card" }, [
    el("div", { class: "section-label" }, title),
    table(model),
    model.note ? el("div", { class: "stat-note" }, model.note) : null,
  ]);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function heading(text, sub) {
  return el("div", { class: "card report-section-head" }, [
    el("div", { class: "report-title" }, text),
    el("div", { class: "stat-note" }, sub),
  ]);
}

function bullets(items, tag) {
  return el(tag, { class: "report-list" },
    items.map((item) => el("li", {}, [el("strong", {}, item.lead + " "), item.text]))
  );
}

export async function render(root, { onBack } = {}) {
  const games = await Games.listCompleted();

  const backBar = (extra = []) =>
    el("div", { class: "list-toolbar" }, [
      el("h1", { class: "screen-title" }, "Coach report"),
      el("div", { class: "form-row" }, [
        onBack ? el("button", { class: "btn btn-sm", onclick: onBack }, "← Season") : null,
        ...extra,
      ]),
    ]);

  if (games.length === 0) {
    root.replaceChildren(
      el("div", { class: "screen" }, [
        backBar(),
        el("div", { class: "empty-state" },
          "No completed games yet. The report is built from finished games."),
      ])
    );
    return;
  }

  const entries = await Promise.all(
    games.map(async (game) => ({ game, possessions: await Possessions.listByGame(game.id) }))
  );
  // Oldest first, so "the gap held in 5 of 7 games" walks the season forward.
  entries.sort((a, b) => (a.game.date || "").localeCompare(b.game.date || ""));

  const r = buildReport(entries);
  const first = entries[0].game.date;
  const last = entries[entries.length - 1].game.date;
  // With no scores entered anywhere, "0 – 0" would read as a record rather
  // than as an absence. Say plainly that nothing is known instead.
  const scored = r.record.w + r.record.l + r.record.t;
  const rec = scored ? `${r.record.w} – ${r.record.l}${r.record.t ? ` – ${r.record.t}` : ""}` : "—";

  document.getElementById("app-bar-context").textContent = `${r.G} game${r.G === 1 ? "" : "s"}`;

  root.replaceChildren(
    el("div", { class: "screen report" }, [
      backBar([el("button", { class: "btn btn-sm btn-primary", onclick: printCurrentView }, "Print / PDF")]),

      el("div", { class: "card report-head" }, [
        el("div", {}, [
          el("div", { class: "report-title" }, `${r.G} game${r.G === 1 ? "" : "s"} · paint touches & pick-and-roll defense`),
          el("div", { class: "stat-note" }, `${formatDate(first)} – ${formatDate(last)}`),
        ]),
        el("div", { class: "report-record" }, [
          el("div", { class: "report-record__value" }, rec),
          el("div", { class: "stat-tile__label" }, scored ? "won – lost" : "no scores recorded"),
        ]),
      ]),

      el("div", { class: "card" }, [
        el("div", { class: "stat-strip report-tiles" }, r.tiles.map(tile)),
      ]),

      r.sides
        ? el("div", { class: "card" }, [
            el("div", { class: "section-label" }, "Wins vs losses — what the tracking adds"),
            el("div", { class: "report-panels" }, [
              panel(`${r.sides.wins.count} wins`, r.sides.wins.rows, "win"),
              panel(`${r.sides.losses.count} losses`, r.sides.losses.rows, "loss"),
              el("div", { class: "report-panel" }, [
                el("div", { class: "section-label" }, "The read"),
                el("p", { class: "report-read" }, r.sides.read),
              ]),
            ]),
          ])
        : null,

      r.findings.length
        ? el("div", { class: "card" }, [
            el("div", { class: "section-label" }, `What the ${r.G} game${r.G === 1 ? "" : "s"} say`),
            bullets(r.findings, "ul"),
          ])
        : null,

      r.priorities.length
        ? el("div", { class: "card" }, [
            el("div", { class: "section-label" }, "Priorities"),
            bullets(r.priorities, "ol"),
          ])
        : null,

      el("div", { class: "card" }, [
        el("div", { class: "section-label" }, "How to read these numbers"),
        el("div", { class: "stat-note" }, r.caveats),
      ]),

      // The detail behind the first page: where a coach goes after asking
      // "against whom?" or "which set?".
      heading("Offense — paint touches",
        `${plural(r.off.overall.possessions, "possession")} · ${plural(r.off.overall.points, "point")} · ` +
        `${plural(r.off.overall.fouls, "non-shooting foul")} drawn (not in PPP)`),
      tableCard("Game log", r.offense.gameLog),
      el("div", { class: "card" }, [
        el("div", { class: "section-label" }, "With a paint touch vs without"),
        el("div", { class: "report-panels" }, [
          panel(r.offense.split.withTouch.title, r.offense.split.withTouch.rows, "win"),
          panel(r.offense.split.without.title, r.offense.split.without.rows, "loss"),
          el("div", { class: "report-panel" }, [
            el("div", { class: "section-label" }, "The read"),
            el("p", { class: "report-read" }, r.offense.split.read),
          ]),
        ]),
      ]),
      tableCard("By play", r.offense.plays),
      tableCard("By quarter", r.offense.quarters),
      tableCard("Who gets us to the paint", r.offense.players),

      heading("Defense — pick-and-roll",
        `${plural(r.def.overall.trips, "pick-and-roll trip")} · ${plural(r.def.overall.points, "point")} allowed · ` +
        `${plural(r.def.overall.mistakes, "breakdown")} · only pick-and-roll possessions are tracked`),
      tableCard("Game log", r.defense.gameLog),
      tableCard("Coverages and their breakdowns", r.defense.coverages),
      tableCard("Breakdowns by player", r.defense.players),
      tableCard("By quarter", r.defense.quarters),
    ])
  );
}
