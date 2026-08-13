// Every completed game added together. This screen exists almost for free:
// computeStats() takes a flat list of possessions and has no idea whether
// they came from one game or forty, so pooling them gives season totals
// with no new maths.
//
// Season PPP is therefore total points over total possessions — NOT the
// average of each game's PPP, which would let a 12-possession blowout weigh
// as heavily as a full game.

import { el, formatDate, formatPPP } from "../utils.js";
import { Games, Possessions, TagEvents, gameResult, VENUES } from "../models.js";
import { computeStats, computeDefenseStats } from "../stats.js";
import { statTile, table } from "./stats-panel.js";
import { renderGameStats } from "./game-stats.js";
import { renderExportActions } from "./export-actions.js";
import { renderBackupCard } from "./backup-card.js";
import { buildSeasonSummaryText, buildCSV } from "../export.js";

// Games still in progress are left out: a half-tracked game would drag the
// season numbers around and then change again when it finishes.
export async function render(root) {
  const games = await Games.listCompleted();

  if (games.length === 0) {
    root.replaceChildren(
      el("div", { class: "screen" }, [
        el("h1", { class: "screen-title" }, "Season"),
        el("div", { class: "empty-state" },
          "No completed games yet. Once you end a game it joins your season totals here."),
      ])
    );
    return;
  }

  const perGame = await Promise.all(
    games.map(async (game) => {
      const [possessions, tagEvents] = await Promise.all([
        Possessions.listByGame(game.id),
        TagEvents.listByGame(game.id),
      ]);
      return { game, possessions, tagEvents };
    })
  );

  // Oldest first, so a trend reads left-to-right the way a season does.
  const chronological = [...perGame].sort((a, b) => (a.game.date || "").localeCompare(b.game.date || ""));
  const allPossessions = perGame.flatMap((g) => g.possessions);
  const allTagEvents = perGame.flatMap((g) => g.tagEvents);

  const seasonOffense = computeStats(allPossessions);
  const seasonDefense = computeDefenseStats(allPossessions);

  const state = { kind: "plays", id: null };

  function buildRecord() {
    const withResult = games.filter((g) => gameResult(g));
    const tally = (list) => ({
      w: list.filter((g) => gameResult(g) === "W").length,
      l: list.filter((g) => gameResult(g) === "L").length,
      t: list.filter((g) => gameResult(g) === "T").length,
    });
    const overall = tally(withResult);
    const fmt = (r) => `${r.w}-${r.l}${r.t ? `-${r.t}` : ""}`;

    const venueTiles = VENUES.map((v) => {
      const at = withResult.filter((g) => g.venue === v.key);
      return at.length ? statTile(v.label, fmt(tally(at))) : null;
    }).filter(Boolean);

    return el("div", { class: "card" }, [
      el("div", { class: "section-label" }, "Record"),
      el("div", { class: "stat-strip" }, [
        statTile("Games", games.length),
        withResult.length ? statTile("Record", fmt(overall)) : null,
        ...venueTiles,
      ].filter(Boolean)),
      withResult.length < games.length
        ? el("div", { class: "stat-note" },
            `${games.length - withResult.length} of ${games.length} games have no score recorded, so they're not in the record. Add one from History.`)
        : null,
    ]);
  }

  // Which plays and coverages actually appear in the season's data — read
  // from the possessions rather than the current lists, so something you
  // archived mid-season still shows the games it was used in.
  const playOptions = seasonOffense.byPlay.map((p) => ({ id: p.id, name: p.name }));
  const coverageOptions = seasonDefense.byCoverage.map((c) => ({ id: c.id, name: c.name }));

  function optionsFor(kind) {
    return kind === "plays" ? playOptions : coverageOptions;
  }

  // Per game, pull the one row we care about straight out of the same stats
  // engine the rest of the app uses, rather than re-deriving the maths here.
  function trendRows() {
    return chronological.map(({ game, possessions }) => {
      const row =
        state.kind === "plays"
          ? computeStats(possessions).byPlay.find((p) => p.id === state.id)
          : computeDefenseStats(possessions).byCoverage.find((c) => c.id === state.id);
      return { game, row };
    });
  }

  function buildTrend() {
    const options = optionsFor(state.kind);
    if (state.id === null || !options.some((o) => o.id === state.id)) {
      state.id = options[0]?.id ?? null;
    }

    const kindSwitch = el("div", { class: "segmented" },
      [
        { key: "plays", label: "Plays" },
        { key: "coverages", label: "Coverages" },
      ].map((k) =>
        el("button", {
          class: "segmented__btn" + (state.kind === k.key ? " is-active" : ""),
          "data-trend-kind": k.key,
          onclick: () => {
            if (state.kind === k.key) return;
            state.kind = k.key;
            state.id = null;
            paint();
          },
        }, k.label)
      )
    );

    if (options.length === 0) {
      return el("div", { class: "card" }, [
        el("div", { class: "section-label" }, "Trend over the season"),
        kindSwitch,
        el("div", { class: "empty-state empty-state--tight" },
          state.kind === "plays"
            ? "No offensive possessions logged yet."
            : "No defensive possessions logged yet."),
      ]);
    }

    const rows = trendRows();
    const used = rows.filter((r) => r.row);
    const best = Math.max(1, ...used.map((r) => r.row.ppp ?? 0));
    const totals = used.reduce(
      (acc, r) => ({ points: acc.points + r.row.points, possessions: acc.possessions + r.row.possessions }),
      { points: 0, possessions: 0 }
    );

    return el("div", { class: "card" + (state.kind === "coverages" ? " is-coverage-trend" : "") }, [
      el("div", { class: "section-label" }, "Trend over the season"),
      kindSwitch,
      el("div", { class: "chip-grid trend-chips" },
        options.map((o) =>
          el("button", {
            class: "chip" + (state.id === o.id ? " is-active" : ""),
            onclick: () => {
              state.id = o.id;
              paint();
            },
          }, o.name)
        )
      ),
      el("div", { class: "stat-strip" }, [
        statTile("Season PPP", formatPPP(totals.points, totals.possessions)),
        statTile("Possessions", totals.possessions),
        statTile("Games used", used.length),
      ]),
      table(
        ["Game", "Poss", "PPP", ""],
        rows.map(({ game, row }) =>
          el("tr", {}, [
            el("td", {}, `${formatDate(game.date)}${game.opponent ? " · " + game.opponent : ""}`),
            el("td", {}, row ? String(row.possessions) : "—"),
            el("td", {}, row ? formatPPP(row.points, row.possessions) : "—"),
            // A bar beats a column of numbers for spotting a slope, and it
            // costs one div rather than a charting library.
            el("td", { class: "trend-cell" },
              row && row.ppp !== null
                ? el("span", {
                    class: "trend-bar",
                    style: `width:${Math.max(2, Math.round((row.ppp / best) * 100))}%`,
                  })
                : null),
          ])
        )
      ),
      el("div", { class: "stat-note" },
        "Bars are scaled against this selection's best game. On the Coverages side a shorter bar is the good one — that's points you allowed."),
    ]);
  }

  function paint() {
    document.getElementById("app-bar-context").textContent =
      `${games.length} game${games.length === 1 ? "" : "s"}`;

    root.replaceChildren(
      el("div", { class: "screen" }, [
        el("h1", { class: "screen-title" }, "Season"),
        buildRecord(),
        buildTrend(),
        el("div", { class: "card" }, [
          el("div", { class: "section-label" }, "Season totals — every completed game"),
          el("div", { class: "stat-note" },
            "Total points divided by total possessions, not the average of each game's PPP — otherwise a short game would count as much as a full one."),
        ]),
        renderGameStats(allPossessions, allTagEvents),
        renderExportActions({
          title: `Season — ${games.length} games`,
          buildSummary: () => buildSeasonSummaryText(games, allPossessions, allTagEvents),
          buildCsv: () => buildCSV(chronological),
          filenameBase: "paint-touches-season",
        }),
        renderBackupCard(),
      ])
    );
  }

  paint();
}
