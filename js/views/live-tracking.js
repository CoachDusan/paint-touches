// The screen you'll actually use during a game: pick the play, tap every
// player who touches the paint, then tap the outcome. A live stats panel
// (Stage 4) can be toggled on any time to see PPP and every breakdown
// computed from this game's possessions so far.

import { el, formatDate } from "../utils.js";
import { Games, Players, Plays, Coverages, Mistakes, Possessions, TRANSITION_PLAY } from "../models.js";
import {
  pointsForOutcome,
  OUTCOME_LABELS,
  DEFENSE_OUTCOME_LABELS,
  FT_COMBOS,
  QUARTERS,
  SIDES,
  NO_MISTAKE,
} from "../possession.js";
import { renderStatsPanel } from "./stats-panel.js";

export async function render(root, game) {
  const [players, plays, coverages, mistakeTypes, existingPossessions] = await Promise.all([
    Players.list(),
    Plays.list(),
    Coverages.list(),
    Mistakes.list(),
    Possessions.listByGame(game.id),
  ]);

  const state = {
    game,
    players,
    plays: [TRANSITION_PLAY, ...plays],
    coverages,
    mistakeTypes,
    possessions: existingPossessions,
    side: SIDES.OFFENSE,
    current: { playId: undefined, playName: undefined, touches: [] },
    // The defensive possession being built. Coverage deliberately survives
    // between possessions — it's a game-plan call you hold for stretches,
    // not something you re-decide every trip down the floor.
    currentDef: { coverage: null, mistake: null, player: null },
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
    // Coverage is sticky; what broke down and who did it are not.
    state.currentDef = { coverage: state.currentDef.coverage, mistake: null, player: null };
    state.subFlow = null;
  }

  const isDefense = () => state.side === SIDES.DEFENSE;

  async function finalizePossession(outcome, extra = {}) {
    const points = pointsForOutcome(outcome, extra);
    const now = Date.now();

    const shared = {
      gameId: state.game.id,
      quarter: state.game.currentQuarter,
      sequenceNumber: state.possessions.length + 1,
      side: state.side,
      outcome,
      andOne: extra.andOne || null,
      ftAttempt: extra.ftAttempt || null,
      points,
      closedAt: now,
    };

    const record = await Possessions.add(
      isDefense()
        ? {
            ...shared,
            // On a defensive possession `points` is points *allowed*. Stats
            // must never mix these with offensive points — see computeStats.
            coverage: state.currentDef.coverage,
            mistake: state.currentDef.mistake || NO_MISTAKE,
            mistakePlayer: state.currentDef.player,
            play: null,
            touches: [],
            startedAt: now,
          }
        : {
            ...shared,
            play:
              state.current.playId !== undefined
                ? { playId: state.current.playId, playName: state.current.playName }
                : { playId: TRANSITION_PLAY.id, playName: TRANSITION_PLAY.name },
            touches: state.current.touches,
            startedAt: state.current.touches[0]?.timestamp || now,
          }
    );

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

    // A defensive possession can't be closed until you've said which
    // coverage you were in — every defensive stat is grouped by it.
    if (isDefense() && !state.currentDef.coverage) {
      return el("div", { class: "empty-state empty-state--tight" }, "Pick a coverage above to log this possession.");
    }

    const labels = isDefense() ? DEFENSE_OUTCOME_LABELS : OUTCOME_LABELS;
    // A forced turnover is a good result for the defense, so it shouldn't
    // wear the same red as one you committed.
    const toClass = isDefense() ? "btn outcome-btn btn-good" : "btn outcome-btn btn-danger";

    return el("div", { class: "outcome-row" }, [
      el("button", { class: "btn outcome-btn", onclick: () => { state.subFlow = { outcome: "2PM" }; paint(); } }, labels["2PM"]),
      el("button", { class: "btn outcome-btn", onclick: () => finalizePossession("2PA") }, labels["2PA"]),
      el("button", { class: "btn outcome-btn", onclick: () => { state.subFlow = { outcome: "3PM" }; paint(); } }, labels["3PM"]),
      el("button", { class: "btn outcome-btn", onclick: () => finalizePossession("3PA") }, labels["3PA"]),
      el("button", { class: "btn outcome-btn", onclick: () => { state.subFlow = { outcome: "FT" }; paint(); } }, labels["FT"]),
      el("button", { class: toClass, onclick: () => finalizePossession("TO") }, labels["TO"]),
    ]);
  }

  function buildSideToggle() {
    const sides = [
      { key: SIDES.OFFENSE, label: "OFFENSE" },
      { key: SIDES.DEFENSE, label: "DEFENSE" },
    ];
    return el(
      "div",
      { class: "segmented side-toggle" + (isDefense() ? " is-defense" : "") },
      sides.map((s) =>
        el(
          "button",
          {
            class: "segmented__btn" + (state.side === s.key ? " is-active" : ""),
            "data-side": s.key,
            onclick: () => {
              if (state.side === s.key) return;
              state.side = s.key;
              // Half-built possessions don't survive a side change — they
              // belong to whichever side you were on.
              resetPossession();
              paint();
            },
          },
          s.label
        )
      )
    );
  }

  function buildCoveragePicker() {
    if (state.coverages.length === 0) {
      return el("div", { class: "empty-state" }, "No coverages yet — add them under Playbook → Coverages first.");
    }
    return el("div", { class: "card" }, [
      el("div", { class: "section-label" }, "Coverage"),
      el(
        "div",
        { class: "chip-grid" },
        state.coverages.map((c) =>
          el(
            "button",
            {
              class: "chip" + (state.currentDef.coverage?.coverageId === c.id ? " is-active" : ""),
              onclick: () => {
                state.currentDef.coverage = { coverageId: c.id, coverageName: c.name };
                paint();
              },
            },
            c.name
          )
        )
      ),
    ]);
  }

  function buildMistakePicker() {
    const selectedId = state.currentDef.mistake?.mistakeId;
    const chip = (id, name, extraClass = "") =>
      el(
        "button",
        {
          class: "chip" + extraClass + (selectedId === id ? " is-active" : ""),
          onclick: () => {
            state.currentDef.mistake = { mistakeId: id, mistakeName: name };
            // "No mistake" can't have a culprit.
            if (id === NO_MISTAKE.id) state.currentDef.player = null;
            paint();
          },
        },
        name
      );

    return el("div", { class: "card" }, [
      el("div", { class: "section-label" }, "What broke down?"),
      el("div", { class: "chip-grid" }, [
        chip(NO_MISTAKE.id, NO_MISTAKE.name, " chip--good"),
        ...state.mistakeTypes.map((m) => chip(m.id, m.name)),
      ]),
    ]);
  }

  function buildMistakePlayerPicker() {
    const mistake = state.currentDef.mistake;
    if (!mistake || mistake.mistakeId === NO_MISTAKE.id) return null;

    if (state.players.length === 0) {
      return el("div", { class: "empty-state" }, "No active players on your roster yet — add players on the Roster tab first.");
    }

    const chosen = state.currentDef.player;
    return el("div", { class: "card" }, [
      el("div", { class: "section-label" }, "Who made it?"),
      chosen
        ? null
        : el("div", { class: "warn-note" }, "No player selected — you can still log the possession, and it'll count as unassigned."),
      el(
        "div",
        { class: "player-grid" },
        state.players.map((p) =>
          el(
            "button",
            {
              class: "player-tile" + (chosen?.playerId === p.id ? " is-active" : ""),
              onclick: () => {
                // Single choice, and tapping the same player again clears it.
                state.currentDef.player =
                  chosen?.playerId === p.id
                    ? null
                    : { playerId: p.id, playerName: p.name, playerNumber: p.number };
                paint();
              },
            },
            [
              el("span", { class: "player-tile__number" }, `#${p.number || "--"}`),
              el("span", { class: "player-tile__name" }, p.name),
            ]
          )
        )
      ),
    ]);
  }

  async function endGame() {
    if (!confirm("End this game? You can still review it afterward from History.")) return;
    await Games.complete(state.game.id);
    const { render: renderGameTab } = await import("./game.js");
    renderGameTab(root);
  }

  function buildStatusRow() {
    const def = state.possessions.filter((p) => p.side === SIDES.DEFENSE).length;
    const off = state.possessions.length - def;
    return el("div", { class: "list-toolbar" }, [
      el("div", { class: "pill" }, `${off} offense · ${def} defense`),
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

    const sideContent = isDefense()
      ? [buildCoveragePicker(), buildMistakePicker(), buildMistakePlayerPicker(), buildOutcomeRow()]
      : [buildPlayPicker(), buildTouchStrip(), buildPlayerGrid(), buildOutcomeRow()];

    root.replaceChildren(
      el("div", { class: "screen live-tracking" + (isDefense() ? " is-defense" : "") }, [
        el("div", { class: "list-toolbar" }, [
          buildQuarterSelector(),
          el("button", { class: "btn btn-sm", onclick: endGame }, "End Game"),
        ]),
        buildSideToggle(),
        buildStatusRow(),
        ...sideContent,
      ])
    );
  }

  paint();
}
