import { renderEntityList } from "./entity-list.js";
import { Players } from "../models.js";

export function render(root) {
  renderEntityList(root, {
    title: "Roster",
    itemNoun: "Player",
    emptyText: "No players yet. Add your first player to get started — you can add or change players anytime, including mid-season.",
    fields: [
      { key: "number", label: "#", placeholder: "23", maxlength: 3, widthClass: "field-short" },
      { key: "name", label: "Name", placeholder: "Jordan Smith" },
    ],
    renderRowLabel: (player) => `#${player.number || "--"}  ${player.name}`,
    // This order is also the order of the player buttons during a game.
    sortListKey: "players",
    sortOptions: ["number", "name", "added", "custom"],
    api: Players,
  });
}
