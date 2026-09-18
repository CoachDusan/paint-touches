// Every completed game, permanently saved. Tap one to see its frozen
// stats — same stats panel the live screen uses, just fed a possession
// list that will never change again.

import { el, formatDate, formatPPP } from "../utils.js";
import { Games, Players, Possessions, QuickTags, TagEvents, VENUES, gameResult } from "../models.js";
import { QUARTERS } from "../possession.js";
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

  // The same two lists the bench screen taps from, so a tag added after the
  // game is the same record in every way but one — it knows it came later.
  const [quickTags, players] = await Promise.all([QuickTags.list(), Players.list()]);
  // Kept outside the render so picking a tag, then a quarter, then three
  // players in a row doesn't reset the picker on every repaint.
  const tagDraft = { tagId: null, quarter: null };

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

  // Deleting one game, rather than all of them. Offered only from inside a
  // game's own screen — never from a row in the list — so you have to have
  // the game open, with its date and score in front of you, before the
  // button exists at all. A delete on a tappable list row is one thumb-slip
  // away from destroying the wrong night's work.
  async function deleteGame(game) {
    const summary = summaries.find((s) => s.game.id === game.id);
    const who = game.opponent ? `vs ${game.opponent}` : "this game";
    const n = summary.possessions.length;
    const t = summary.tagEvents.length;
    if (!confirm(
      `Permanently delete ${who} — ${formatDate(game.date)}?\n\n` +
      `${n} possession${n === 1 ? "" : "s"}` +
      `${t ? ` and ${t} quick tag${t === 1 ? "" : "s"}` : ""} will go with it, ` +
      `and this game will drop out of your season totals.\n\nThis cannot be undone.`
    )) return;
    await Games.remove(game.id);
    await render(root);
  }

  // An observation often arrives after the final buzzer — on the bus, or
  // watching film. This writes the record the bench writes, with two
  // differences: the quarter is picked by hand, because nothing here can infer
  // it, and the record is marked as added later so its clock time is never
  // read as the moment it happened.
  function buildTagEditor(game, summary, repaint) {
    if (quickTags.length === 0) return null;

    const tag = quickTags.find((t) => t.id === tagDraft.tagId) || null;
    const quarterLabel = (q) => (q === "OT" ? "OT" : `Q${q}`);

    const tagChips = el("div", { class: "chip-grid" },
      quickTags.map((t) =>
        el("button", {
          class: "chip" + (tagDraft.tagId === t.id ? " is-active" : ""),
          onclick: () => {
            tagDraft.tagId = tagDraft.tagId === t.id ? null : t.id;
            repaint();
          },
        }, t.name)
      )
    );

    const quarterChips = el("div", { class: "chip-grid" },
      QUARTERS.map((q) =>
        el("button", {
          class: "chip" + (tagDraft.quarter === q ? " is-active" : ""),
          onclick: () => {
            tagDraft.quarter = tagDraft.quarter === q ? null : q;
            repaint();
          },
        }, quarterLabel(q))
      )
    );

    let target;
    if (players.length === 0) {
      target = el("div", { class: "stat-note" }, "Your roster is empty — add players first.");
    } else if (!tag || !tagDraft.quarter) {
      target = el("div", { class: "stat-note" }, "Pick a tag and a quarter, then tap the player it was.");
    } else {
      target = el("div", { class: "chip-grid" },
        players.map((player) =>
          el("button", {
            class: "chip",
            onclick: async () => {
              await TagEvents.add({
                gameId: game.id,
                quarter: tagDraft.quarter,
                tagId: tag.id,
                tagName: tag.name,
                playerId: player.id,
                playerName: player.name,
                playerNumber: player.number,
                addedAfterGame: true,
              });
              summary.tagEvents = await TagEvents.listByGame(game.id);
              repaint();
            },
          }, player.number ? `#${player.number} ${player.name}` : player.name)
        )
      );
    }

    const logged = summary.tagEvents.map((e) =>
      el("li", { class: "list-row" }, [
        el("span", { class: "list-row__main" }, [
          el("strong", {}, e.tagName),
          el("span", { class: "pill" }, e.quarter ? quarterLabel(e.quarter) : "no quarter"),
          el("span", {}, e.playerNumber ? `#${e.playerNumber} ${e.playerName}` : e.playerName),
          e.addedAfterGame ? el("span", { class: "pill" }, "added later") : null,
        ]),
        el("button", {
          class: "btn btn-sm btn-danger",
          onclick: () => removeTagEvent(game, e, summary, repaint),
        }, "Remove"),
      ])
    );

    return el("div", { class: "card" }, [
      el("div", { class: "section-label" }, "Quick tags"),
      el("div", { class: "stat-note" },
        "Add something you noticed after the game. It counts exactly like a tag tapped from the bench."),
      // Three rows of identical chips with nothing between them is a guessing
      // game. Numbered labels say what each row is and what order to tap in.
      el("div", { class: "stat-note" }, "1 · Which tag"),
      tagChips,
      el("div", { class: "stat-note" }, "2 · Which quarter"),
      quarterChips,
      el("div", { class: "stat-note" }, "3 · Which player"),
      target,
      logged.length
        ? el("div", { class: "section-label" }, `Tagged in this game (${logged.length})`)
        : null,
      logged.length ? el("ul", { class: "entity-list" }, logged) : null,
    ]);
  }

  async function removeTagEvent(game, event, summary, repaint) {
    const who = event.playerNumber ? `#${event.playerNumber} ${event.playerName}` : event.playerName;
    if (!confirm(`Remove "${event.tagName}" for ${who}?\n\nThis cannot be undone.`)) return;
    await TagEvents.remove(event.id);
    summary.tagEvents = await TagEvents.listByGame(game.id);
    repaint();
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
        renderGameStats(summary.possessions, summary.tagEvents, { gameStart: game.createdAt }),
        buildTagEditor(game, summary, () => showDetail(game, stats)),
        renderExportActions({
          title: `${game.opponent ? "vs " + game.opponent : "Game"} — ${formatDate(game.date)}`,
          buildSummary: () => buildGameSummaryText(game, summary.possessions, summary.tagEvents),
          buildCsv: () => buildCSV([summary]),
          filenameBase: `paint-touches-${game.date}${game.opponent ? "-" + game.opponent.replace(/[^a-z0-9]+/gi, "-").toLowerCase() : ""}`,
        }),
        // Last thing on the screen, under the exports, because the safe
        // move before deleting a game is to save a copy of it first.
        el("div", { class: "card" }, [
          el("div", { class: "section-label" }, "Delete"),
          el("div", { class: "stat-note" },
            "Removes this game and every possession and quick tag in it. Your season totals will change. Export or back up first — there is no undo."),
          el("button", {
            class: "btn btn-danger btn-block",
            onclick: () => deleteGame(game),
          }, "Delete this game"),
        ]),
      ])
    );
  }

  showList();
}
