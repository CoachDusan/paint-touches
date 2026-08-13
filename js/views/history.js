// Every completed game, permanently saved. Tap one to see its frozen
// stats — same stats panel the live screen uses, just fed a possession
// list that will never change again.

import { el, formatDate, formatPPP } from "../utils.js";
import { Games, Possessions } from "../models.js";
import { computeStats } from "../stats.js";
import { renderGameStats } from "./game-stats.js";

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
      const possessions = await Possessions.listByGame(game.id);
      const stats = computeStats(possessions);
      return { game, possessions, stats };
    })
  );

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
                  el("strong", {}, game.opponent ? `vs ${game.opponent}` : "Game"),
                  el("span", { class: "pill" }, formatDate(game.date)),
                ]),
                el("span", {}, `PPP ${formatPPP(stats.overall.points, stats.overall.possessions)}`),
              ]
            )
          )
        ),
      ])
    );
  }

  function showDetail(game, stats) {
    const bar = document.getElementById("app-bar-context");
    if (bar) bar.textContent = `${game.opponent ? "vs " + game.opponent : "Game"} — ${formatDate(game.date)}`;

    const possessions = summaries.find((s) => s.game.id === game.id).possessions;

    root.replaceChildren(
      el("div", { class: "screen" }, [
        el("div", { class: "list-toolbar" }, [
          el("h1", { class: "screen-title" }, game.opponent ? `vs ${game.opponent}` : "Game"),
          el("button", { class: "btn btn-sm", onclick: showList }, "← All games"),
        ]),
        renderGameStats(possessions),
      ])
    );
  }

  showList();
}
