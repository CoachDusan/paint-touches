import { el } from "../utils.js";

export function render(root) {
  root.replaceChildren(
    el("div", { class: "screen" }, [
      el("h1", { class: "screen-title" }, "Roster"),
      el("div", { class: "empty-state" }, "Roster management is coming in Stage 2."),
    ])
  );
}
