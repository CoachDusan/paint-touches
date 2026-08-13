import { renderEntityList } from "./entity-list.js";
import { Plays } from "../models.js";

export function render(root) {
  renderEntityList(root, {
    title: "Playbook",
    itemNoun: "Play",
    emptyText: "No plays yet. Add the sets from your playbook — during a game you'll tap one of these to tag each possession.",
    fields: [{ key: "name", label: "Play name", placeholder: "Horns" }],
    renderRowLabel: (play) => play.name,
    api: Plays,
  });
}
