// The coach report on screen: answers first, numbers second, laid out to be
// read top to bottom and printed as it stands. Reached from Season rather than
// from a tab of its own — this is something made between games, never
// something reached for on the bench.
//
// Stage 1 is the page a head coach actually reads. The offense and defense
// detail pages, and the last game against the rest, come next.

import { el, formatDate } from "../utils.js";
import { Games, Possessions } from "../models.js";
import { buildReport, gameOrder } from "../report.js";
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

// A game with nothing to list is good news, not an empty table.
function listCard(title, model, emptyText) {
  if (!model.rows.length) {
    return el("div", { class: "card" }, [
      el("div", { class: "section-label" }, title),
      el("div", { class: "stat-note" }, emptyText),
    ]);
  }
  return tableCard(title, model);
}

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

// The most recent game, set against everything before it — the part that gets
// used on Monday, with enough on every row to find the moment on video.
function lastGameSection(r, single) {
  const last = r.lastGame;
  if (!last) return [];

  const stats = r.perGame[r.perGame.length - 1];
  const score = last.game.ourScore == null || last.game.theirScore == null
    ? "no score recorded"
    : `${last.game.ourScore}–${last.game.theirScore}`;

  return [
    heading(single ? "This game against the season" : `Last game — ${last.game.opponent || "Game"}`,
      `${formatDate(last.game.date)} · ${score} · ` +
      `${plural(stats.off.overall.possessions, "offensive possession")} · ` +
      `${plural(stats.def.overall.trips, "pick-and-roll trip")}`),
    last.comparison
      ? tableCard("Against the season so far", last.comparison)
      : el("div", { class: "card" }, [
          el("div", { class: "section-label" }, "Against the season so far"),
          el("div", { class: "stat-note" }, single
            ? "Nothing to compare it with — no game was finished before this one."
            : "Nothing to compare it with yet — this is the only game."),
        ]),
    listCard(`Breakdowns to find on video (${last.breakdowns.rows.length})`, last.breakdowns,
      "No pick-and-roll breakdowns logged in this game."),
    listCard(`Turnovers (${last.turnovers.rows.length})`, last.turnovers,
      "No turnovers logged in this game."),
    el("div", { class: "card" }, [el("div", { class: "stat-note" }, last.note)]),
  ];
}

// With `gameId`, the report of that one game, measured against the games
// finished before it. Without, the whole season. Same screen, same builder —
// a single game is just a smaller selection.
export async function render(root, { onBack, backLabel = "← Season", gameId = null } = {}) {
  const games = await Games.listCompleted();

  const backBar = (extra = []) =>
    el("div", { class: "list-toolbar" }, [
      el("h1", { class: "screen-title" }, gameId ? "Game report" : "Coach report"),
      el("div", { class: "form-row" }, [
        onBack ? el("button", { class: "btn btn-sm", onclick: onBack }, backLabel) : null,
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

  const load = (list) => Promise.all(
    list.map(async (game) => ({ game, possessions: await Possessions.listByGame(game.id) }))
  );
  const ordered = [...games].sort(gameOrder);
  const at = gameId ? ordered.findIndex((g) => g.id === gameId) : -1;
  const single = at >= 0;
  const r = single
    ? buildReport(await load([ordered[at]]), { before: await load(ordered.slice(0, at)) })
    : buildReport(await load(ordered));
  // From the report's own ordering: the database hands games back newest
  // first, which once printed the range as "Sep 20 – Aug 29".
  const first = r.games[0].date;
  const last = r.games[r.G - 1].date;
  const only = r.games[0];
  // With no scores entered anywhere, "0 – 0" would read as a record rather
  // than as an absence. Say plainly that nothing is known instead.
  const scored = r.record.w + r.record.l + r.record.t;
  // One game shows its score; a "1 – 0" record would say less.
  const rec = !scored ? "—"
    : single ? `${only.ourScore}–${only.theirScore}`
    : `${r.record.w} – ${r.record.l}${r.record.t ? ` – ${r.record.t}` : ""}`;
  const recLabel = !scored ? (single ? "no score recorded" : "no scores recorded")
    : single ? (r.record.w ? "won" : r.record.l ? "lost" : "tied")
    : "won – lost";

  document.getElementById("app-bar-context").textContent = single
    ? `vs ${only.opponent || "Game"}`
    : `${r.G} game${r.G === 1 ? "" : "s"}`;

  root.replaceChildren(
    el("div", { class: "screen report" }, [
      backBar([el("button", { class: "btn btn-sm btn-primary", onclick: printCurrentView }, "Print / PDF")]),

      el("div", { class: "card report-head" }, [
        el("div", {}, [
          el("div", { class: "report-title" }, single
            ? `${only.opponent ? "vs " + only.opponent : "Game"} · paint touches & pick-and-roll defense`
            : `${r.G} game${r.G === 1 ? "" : "s"} · paint touches & pick-and-roll defense`),
          el("div", { class: "stat-note" }, first === last
            ? formatDate(first)
            : `${formatDate(first)} – ${formatDate(last)}`),
        ]),
        el("div", { class: "report-record" }, [
          el("div", { class: "report-record__value" }, rec),
          el("div", { class: "stat-tile__label" }, recLabel),
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
            el("div", { class: "section-label" }, r.G === 1 ? "What the game says" : `What the ${r.G} games say`),
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
      single ? null : listCard("Game log", r.offense.gameLog, "No offensive possessions logged."),
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
      listCard("By play", r.offense.plays, "No offensive possessions logged."),
      listCard("By quarter", r.offense.quarters, "No offensive possessions logged."),
      listCard("Who gets us to the paint", r.offense.players,
        "No paint touches logged yet — tap a player before the outcome to record one."),

      heading("Defense — pick-and-roll",
        `${plural(r.def.overall.trips, "pick-and-roll trip")} · ${plural(r.def.overall.points, "point")} allowed · ` +
        `${plural(r.def.overall.mistakes, "breakdown")} · only pick-and-roll possessions are tracked`),
      // Every defensive table sits on the same "no pick-and-roll tracked yet"
      // footing, so a season with none says so four times rather than printing
      // four sets of bare headers.
      single ? null : listCard("Game log", r.defense.gameLog, "No pick-and-roll possessions tracked."),
      listCard("Coverages and their breakdowns", r.defense.coverages, "No pick-and-roll possessions tracked."),
      listCard("Breakdowns by player", r.defense.players,
        "No breakdowns tagged to a player."),
      listCard("By quarter", r.defense.quarters, "No pick-and-roll possessions tracked."),

      ...lastGameSection(r, single),
    ])
  );
}
