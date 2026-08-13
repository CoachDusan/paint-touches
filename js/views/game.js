import { el } from "../utils.js";
import { Games } from "../models.js";
import { todayISO } from "../utils.js";
import { render as renderLiveTracking } from "./live-tracking.js";

export async function render(root) {
  const active = await Games.getActive();
  if (active) {
    renderLiveTracking(root, active);
    return;
  }
  renderNewGameForm(root);
}

function renderNewGameForm(root) {
  const form = el("form", { class: "card entity-form" }, [
    el("div", { class: "form-row" }, [
      el("div", { class: "field" }, [
        el("label", {}, "Date"),
        el("input", { type: "date", name: "date", value: todayISO() }),
      ]),
      el("div", { class: "field" }, [
        el("label", {}, "Opponent (optional)"),
        el("input", { type: "text", name: "opponent", placeholder: "Eastside HS" }),
      ]),
    ]),
    el("div", { class: "form-row" }, [
      el("button", { type: "submit", class: "btn btn-primary btn-block" }, "Start Game"),
    ]),
  ]);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const date = form.querySelector('[name="date"]').value || todayISO();
    const opponent = form.querySelector('[name="opponent"]').value.trim();
    const game = await Games.create({ date, opponent });
    renderLiveTracking(root, game);
  });

  root.replaceChildren(
    el("div", { class: "screen" }, [
      el("h1", { class: "screen-title" }, "New Game"),
      form,
    ])
  );
}
