// Every completed game, permanently saved. Tap one to see its frozen
// stats — same stats panel the live screen uses, just fed a possession
// list that will never change again.

import { el, formatDate, formatPPP } from "../utils.js";
import { Games, Possessions, TagEvents, VENUES, gameResult } from "../models.js";
import { computeStats } from "../stats.js";
import { renderGameStats } from "./game-stats.js";
import { renderExportActions } from "./export-actions.js";
import { buildGameSummaryText, buildCSV } from "../export.js";

export async function render(root) {
  const games = await Games.listCompleted();

  if (games.length === 0) {
    root.replaceChildren(
      el("div", { class: "screen" }, [
        el("h1", { class: "screen-title" }, "History"),
        el("div", { class: "empty-state" }, "No completed games yet. Once you end a game from the Game tab, it'll show up here."),
      ])
    );
    return;
  }

  // Pull each game's possessions once up front so the list can show a
  // real final PPP, not just a bare list of dates.
  const summaries = await Promise.all(
    games.map(async (game) => {
      const [possessions, tagEvents] = await Promise.all([
        Possessions.listByGame(game.id),
        TagEvents.listByGame(game.id),
      ]);
      const stats = computeStats(possessions);
      return { game, possessions, tagEvents, stats };
    })
  );

  const venueLabel = (key) => VENUES.find((v) => v.key === key)?.label || key;

  const scoreLine = (game) =>
    game.ourScore == null || game.theirScore == null ? null : `${game.ourScore}–${game.theirScore}`;

  function resultBadge(game) {
    const result = gameResult(game);
    if (!result) return null;
    const tone = result === "W" ? " badge--win" : result === "L" ? " badge--loss" : "";
    return el("span", { class: "badge" + tone }, result);
  }

  // Scores are entered at the final buzzer, which is exactly when a typo is
  // most likely. Without a way back in, a wrong number would be permanent.
  function buildDetailsForm(game, onDone) {
    let venue = game.venue || "home";

    const venuePicker = el(
      "div",
      { class: "segmented" },
      VENUES.map((v) =>
        el(
          "button",
          {
            type: "button",
            class: "segmented__btn" + (venue === v.key ? " is-active" : ""),
            "data-venue": v.key,
            onclick: () => {
              venue = v.key;
              for (const btn of venuePicker.querySelectorAll(".segmented__btn")) {
                btn.classList.toggle("is-active", btn.dataset.venue === venue);
              }
            },
          },
          v.label
        )
      )
    );

    const card = el("div", { class: "card game-details-form" }, [
      el("div", { class: "section-label" }, "Game details"),
      el("div", { class: "form-row" }, [
        el("div", { class: "field" }, [
          el("label", {}, "Us"),
          el("input", { type: "number", name: "ourScore", min: "0", value: game.ourScore ?? "" }),
        ]),
        el("div", { class: "field" }, [
          el("label", {}, "Them"),
          el("input", { type: "number", name: "theirScore", min: "0", value: game.theirScore ?? "" }),
        ]),
      ]),
      el("div", { class: "field" }, [el("label", {}, "Where"), venuePicker]),
      el("div", { class: "form-row" }, [
        el("button", { class: "btn", onclick: () => onDone(null) }, "Cancel"),
        el("button", {
          class: "btn btn-primary",
          onclick: async () => {
            const read = (name) => {
              const raw = card.querySelector(`[name="${name}"]`).value.trim();
              if (!raw) return null;
              const n = Number(raw);
              return Number.isFinite(n) && n >= 0 ? n : null;
            };
            const updated = await Games.update(game.id, {
              ourScore: read("ourScore"),
              theirScore: read("theirScore"),
              venue,
            });
            const summary = summaries.find((s) => s.game.id === game.id);
            summary.game = updated;
            onDone(updated);
          },
        }, "Save"),
      ]),
    ]);

    return card;
  }

  async function clearHistory() {
    const n = summaries.length;
    if (!confirm(
      `Permanently delete all ${n} saved game${n === 1 ? "" : "s"} and every possession in them?\n\n` +
      `This cannot be undone. A game still in progress is not affected.`
    )) return;
    await Games.clearCompleted();
    render(root);
  }

  function showList() {
    document.getElementById("app-bar-context").textContent = "";
    root.replaceChildren(
      el("div", { class: "screen" }, [
        el("div", { class: "list-toolbar" }, [
          el("h1", { class: "screen-title" }, "History"),
          el("button", { class: "btn btn-sm btn-danger", onclick: clearHistory }, "Clear all history"),
        ]),
        el(
          "ul",
          { class: "entity-list" },
          summaries.map(({ game, stats }) =>
            el(
              "li",
              {
                class: "list-row list-row--tappable",
                onclick: () => showDetail(game, stats),
              },
              [
                el("span", { class: "list-row__main" }, [
                  resultBadge(game),
                  el("strong", {}, game.opponent ? `vs ${game.opponent}` : "Game"),
                  el("span", { class: "pill" }, formatDate(game.date)),
                  game.venue ? el("span", { class: "pill" }, venueLabel(game.venue)) : null,
                  scoreLine(game) ? el("span", { class: "pill" }, scoreLine(game)) : null,
                ]),
                el("span", {}, `PPP ${formatPPP(stats.overall.points, stats.overall.possessions)}`),
              ]
            )
          )
        ),
      ])
    );
  }

  function showDetail(gameArg, stats, { editing = false } = {}) {
    const summary = summaries.find((s) => s.game.id === gameArg.id);
    const game = summary.game;

    const bar = document.getElementById("app-bar-context");
    if (bar) bar.textContent = `${game.opponent ? "vs " + game.opponent : "Game"} — ${formatDate(game.date)}`;

    const header = el("div", { class: "card" }, [
      el("div", { class: "list-toolbar" }, [
        el("div", { class: "score-line" }, [
          scoreLine(game)
            ? el("span", { class: "score-line__score" }, scoreLine(game))
            : el("span", { class: "score-line__score score-line__score--empty" }, "No score recorded"),
          resultBadge(game),
          game.venue ? el("span", { class: "pill" }, venueLabel(game.venue)) : null,
        ]),
        el("button", {
          class: "btn btn-sm",
          onclick: () => showDetail(game, stats, { editing: true }),
        }, scoreLine(game) ? "Edit" : "Add score"),
      ]),
      // Two point totals on one screen will look like a bug unless the
      // difference is spelled out where they meet.
      el("div", { class: "stat-note" },
        "Final scoreboard. The Points below counts only the possessions you logged, so it can be lower."),
    ]);

    root.replaceChildren(
      el("div", { class: "screen" }, [
        el("div", { class: "list-toolbar" }, [
          el("h1", { class: "screen-title" }, game.opponent ? `vs ${game.opponent}` : "Game"),
          el("button", { class: "btn btn-sm", onclick: showList }, "← All games"),
        ]),
        editing ? buildDetailsForm(game, () => showDetail(game, stats)) : header,
        renderGameStats(summary.possessions, summary.tagEvents),
        renderExportActions({
          title: `${game.opponent ? "vs " + game.opponent : "Game"} — ${formatDate(game.date)}`,
          buildSummary: () => buildGameSummaryText(game, summary.possessions, summary.tagEvents),
          buildCsv: () => buildCSV([summary]),
          filenameBase: `paint-touches-${game.date}${game.opponent ? "-" + game.opponent.replace(/[^a-z0-9]+/gi, "-").toLowerCase() : ""}`,
        }),
      ])
    );
  }

  showList();
}
