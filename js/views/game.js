import { el } from "../utils.js";

export function render(root) {
  root.replaceChildren(
    el("div", { class: "screen" }, [
      el("h1", { class: "screen-title" }, "Game"),
      el("div", { class: "empty-state" }, "Starting and tracking a live game is coming in Stage 3."),
    ])
  );
}
