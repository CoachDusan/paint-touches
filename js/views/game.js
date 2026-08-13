import { el } from "../utils.js";
import { Games, VENUES } from "../models.js";
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
  // Venue is asked for now rather than at the end, because it's the one
  // detail you already know before tip-off and will have stopped thinking
  // about by the final buzzer.
  let venue = "home";

  const venuePicker = el(
    "div",
    { class: "segmented" },
    VENUES.map((v) =>
      el(
        "button",
        {
          type: "button",
          class: "segmented__btn" + (venue === v.key ? " is-active" : ""),
          "data-venue": v.key,
          onclick: (event) => {
            venue = v.key;
            for (const btn of venuePicker.querySelectorAll(".segmented__btn")) {
              btn.classList.toggle("is-active", btn.dataset.venue === venue);
            }
            event.preventDefault();
          },
        },
        v.label
      )
    )
  );

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
    el("div", { class: "field" }, [el("label", {}, "Where"), venuePicker]),
    el("div", { class: "form-row" }, [
      el("button", { type: "submit", class: "btn btn-primary btn-block" }, "Start Game"),
    ]),
  ]);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const date = form.querySelector('[name="date"]').value || todayISO();
    const opponent = form.querySelector('[name="opponent"]').value.trim();
    const game = await Games.create({ date, opponent, venue });
    renderLiveTracking(root, game);
  });

  root.replaceChildren(
    el("div", { class: "screen" }, [
      el("h1", { class: "screen-title" }, "New Game"),
      form,
    ])
  );
}
