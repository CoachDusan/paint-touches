// The screen you'll actually use during a game: pick the play, tap every
// player who touches the paint, then tap the outcome. A live stats panel
// (Stage 4) can be toggled on any time to see PPP and every breakdown
// computed from this game's possessions so far.

import { el, formatDate } from "../utils.js";
import { Games, Players, Plays, Possessions, TRANSITION_PLAY } from "../models.js";
import { pointsForOutcome, OUTCOME_LABELS, FT_COMBOS, QUARTERS } from "../possession.js";
import { renderStatsPanel } from "./stats-panel.js";

export async function render(root, game) {
  const [players, plays, existingPossessions] = await Promise.all([
    Players.list(),
    Plays.list(),
    Possessions.listByGame(game.id),
  ]);

  const state = {
    game,
    players,
    plays: [TRANSITION_PLAY, ...plays],
    possessions: existingPossessions,
    current: { playId: undefined, playName: undefined, touches: [] },
    // null | { outcome: "2PM"|"3PM" } (and-1 prompt) | { outcome: "FT" } (FT combo grid)
    subFlow: null,
    showStats: false,
  };

  function setAppBarContext() {
    const bar = document.getElementById("app-bar-context");
    if (bar) {
      const who = game.opponent ? `vs ${game.opponent}` : "Game";
      bar.textContent = `${who} — ${formatDate(game.date)}`;
    }
  }

  function resetPossession() {
    state.current = { playId: undefined, playName: undefined, touches: [] };
    state.subFlow = null;
  }

  async function finalizePossession(outcome, extra = {}) {
    const play = state.current.playId !== undefined
      ? { playId: state.current.playId, playName: state.current.playName }
      : { playId: TRANSITION_PLAY.id, playName: TRANSITION_PLAY.name };

    const points = pointsForOutcome(outcome, extra);
    const now = Date.now();

    const record = await Possessions.add({
      gameId: state.game.id,
      quarter: state.game.currentQuarter,
      sequenceNumber: state.possessions.length + 1,
      play,
      touches: state.current.touches,
      outcome,
      andOne: extra.andOne || null,
      ftAttempt: extra.ftAttempt || null,
      points,
      startedAt: state.current.touches[0]?.timestamp || now,
      closedAt: now,
    });

    state.possessions.push(record);
    resetPossession();
    paint();
  }

  function buildQuarterSelector() {
    return el(
      "div",
      { class: "segmented" },
      QUARTERS.map((q) =>
        el(
          "button",
          {
            class: "segmented__btn" + (state.game.currentQuarter === q ? " is-active" : ""),
            onclick: async () => {
              state.game = await Games.update(state.game.id, { currentQuarter: q });
              paint();
            },
          },
          q === "OT" ? "OT" : `Q${q}`
        )
      )
    );
  }

  function buildPlayPicker() {
    return el("div", { class: "card" }, [
      el("div", { class: "section-label" }, "Play"),
      el(
        "div",
        { class: "chip-grid" },
        state.plays.map((play) =>
          el(
            "button",
            {
              class: "chip" + (state.current.playId === play.id ? " is-active" : ""),
              onclick: () => {
                state.current.playId = play.id;
                state.current.playName = play.name;
                paint();
              },
            },
            play.name
          )
        )
      ),
    ]);
  }

  function buildTouchStrip() {
    const chips = state.current.touches.map((t) =>
      el("span", { class: "touch-chip" }, `#${t.playerNumber || "--"}`)
    );

    return el("div", { class: "card" }, [
      el("div", { class: "section-label" }, "This possession's paint touches"),
      state.current.touches.length === 0
        ? el("div", { class: "empty-state empty-state--tight" }, "None yet — tap a player below each time they touch the paint.")
        : el("div", { class: "touch-strip" }, chips),
      state.current.touches.length > 0
        ? el(
            "button",
            {
              class: "btn btn-sm link-btn",
              onclick: () => {
                state.current.touches.pop();
                paint();
              },
            },
            "Undo last touch"
          )
        : null,
    ]);
  }

  function buildPlayerGrid() {
    if (state.players.length === 0) {
      return el("div", { class: "empty-state" }, "No active players on your roster yet — add players on the Roster tab first.");
    }
    return el(
      "div",
      { class: "player-grid" },
      state.players.map((p) =>
        el(
          "button",
          {
            class: "player-tile",
            onclick: () => {
              state.current.touches.push({
                playerId: p.id,
                playerName: p.name,
                playerNumber: p.number,
                timestamp: Date.now(),
              });
              paint();
            },
          },
          [
            el("span", { class: "player-tile__number" }, `#${p.number || "--"}`),
            el("span", { class: "player-tile__name" }, p.name),
          ]
        )
      )
    );
  }

  function buildAndOnePrompt(outcome) {
    return el("div", { class: "card outcome-sheet" }, [
      el("div", { class: "section-label" }, "And-1 free throw?"),
      el("div", { class: "form-row" }, [
        el("button", { class: "btn", onclick: () => finalizePossession(outcome) }, "Skip"),
        el("button", {
          class: "btn btn-primary",
          onclick: () => finalizePossession(outcome, { andOne: { made: true } }),
        }, "Made"),
        el("button", {
          class: "btn btn-danger",
          onclick: () => finalizePossession(outcome, { andOne: { made: false } }),
        }, "Missed"),
      ]),
    ]);
  }

  function buildFtGrid() {
    return el("div", { class: "card outcome-sheet" }, [
      el("div", { class: "section-label" }, "Free throws — makes / attempts"),
      el(
        "div",
        { class: "ft-grid" },
        FT_COMBOS.map((combo) =>
          el(
            "button",
            {
              class: "btn",
              onclick: () => finalizePossession("FT", { ftAttempt: combo }),
            },
            `${combo.made}/${combo.attempts}`
          )
        )
      ),
      el("button", {
        class: "btn btn-sm link-btn",
        onclick: () => {
          state.subFlow = null;
          paint();
        },
      }, "Cancel"),
    ]);
  }

  function buildOutcomeRow() {
    if (state.subFlow?.outcome === "2PM" || state.subFlow?.outcome === "3PM") {
      return buildAndOnePrompt(state.subFlow.outcome);
    }
    if (state.subFlow?.outcome === "FT") {
      return buildFtGrid();
    }

    return el("div", { class: "outcome-row" }, [
      el("button", { class: "btn outcome-btn", onclick: () => { state.subFlow = { outcome: "2PM" }; paint(); } }, OUTCOME_LABELS["2PM"]),
      el("button", { class: "btn outcome-btn", onclick: () => finalizePossession("2PA") }, OUTCOME_LABELS["2PA"]),
      el("button", { class: "btn outcome-btn", onclick: () => { state.subFlow = { outcome: "3PM" }; paint(); } }, OUTCOME_LABELS["3PM"]),
      el("button", { class: "btn outcome-btn", onclick: () => finalizePossession("3PA") }, OUTCOME_LABELS["3PA"]),
      el("button", { class: "btn outcome-btn", onclick: () => { state.subFlow = { outcome: "FT" }; paint(); } }, OUTCOME_LABELS["FT"]),
      el("button", { class: "btn outcome-btn btn-danger", onclick: () => finalizePossession("TO") }, OUTCOME_LABELS["TO"]),
    ]);
  }

  async function endGame() {
    if (!confirm("End this game? You can still review it afterward from History.")) return;
    await Games.complete(state.game.id);
    const { render: renderGameTab } = await import("./game.js");
    renderGameTab(root);
  }

  function buildStatusRow() {
    const count = state.possessions.length;
    return el("div", { class: "list-toolbar" }, [
      el("div", { class: "pill" }, `${count} possession${count === 1 ? "" : "s"} logged`),
      el("button", {
        class: "btn btn-sm" + (state.showStats ? " btn-primary" : ""),
        onclick: () => {
          state.showStats = !state.showStats;
          paint();
        },
      }, state.showStats ? "Hide Stats" : "📊 Stats"),
    ]);
  }

  function paint() {
    setAppBarContext();

    if (state.showStats) {
      root.replaceChildren(
        el("div", { class: "screen live-tracking" }, [
          el("div", { class: "list-toolbar" }, [
            buildQuarterSelector(),
            el("button", { class: "btn btn-sm", onclick: endGame }, "End Game"),
          ]),
          buildStatusRow(),
          renderStatsPanel(state.possessions),
        ])
      );
      return;
    }

    root.replaceChildren(
      el("div", { class: "screen live-tracking" }, [
        el("div", { class: "list-toolbar" }, [
          buildQuarterSelector(),
          el("button", { class: "btn btn-sm", onclick: endGame }, "End Game"),
        ]),
        buildStatusRow(),
        buildPlayPicker(),
        buildTouchStrip(),
        buildPlayerGrid(),
        buildOutcomeRow(),
      ])
    );
  }

  paint();
}
