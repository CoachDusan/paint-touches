import { el } from "../utils.js";

export function render(root) {
  root.replaceChildren(
    el("div", { class: "screen" }, [
      el("h1", { class: "screen-title" }, "History"),
      el("div", { class: "empty-state" }, "Past game history is coming in Stage 5."),
    ])
  );
}
