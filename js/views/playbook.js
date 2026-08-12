import { el } from "../utils.js";

export function render(root) {
  root.replaceChildren(
    el("div", { class: "screen" }, [
      el("h1", { class: "screen-title" }, "Playbook"),
      el("div", { class: "empty-state" }, "Playbook management is coming in Stage 2."),
    ])
  );
}
