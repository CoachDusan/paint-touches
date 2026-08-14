// Both halves of a game's stats behind one switch. The live screen and
// History both render this, so the numbers you watch during a game and the
// ones you review afterwards can never drift apart.

import { el } from "../utils.js";
import { SIDES, sideOf } from "../possession.js";
import { renderStatsPanel } from "./stats-panel.js";
import { renderDefenseStatsPanel } from "./defense-stats-panel.js";

export function renderGameStats(possessions, tagEvents = [], { gameStart = null } = {}) {
  const container = el("div", { class: "game-stats" });
  const defenseCount = possessions.filter((p) => sideOf(p) === SIDES.DEFENSE).length;
  let side = SIDES.OFFENSE;

  function toggle() {
    const sides = [
      { key: SIDES.OFFENSE, label: `Offense (${possessions.length - defenseCount})` },
      { key: SIDES.DEFENSE, label: `Defense (${defenseCount})` },
    ];
    return el(
      "div",
      { class: "segmented stats-toggle" + (side === SIDES.DEFENSE ? " is-defense" : "") },
      sides.map((s) =>
        el(
          "button",
          {
            class: "segmented__btn" + (side === s.key ? " is-active" : ""),
            "data-stats-side": s.key,
            onclick: () => {
              if (side === s.key) return;
              side = s.key;
              paint();
            },
          },
          s.label
        )
      )
    );
  }

  function paint() {
    container.replaceChildren(
      toggle(),
      side === SIDES.OFFENSE ? renderStatsPanel(possessions) : renderDefenseStatsPanel(possessions, tagEvents, { gameStart })
    );
  }

  paint();
  return container;
}
