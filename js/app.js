import * as roster from "./views/roster.js";
import * as playbook from "./views/playbook.js";
import * as game from "./views/game.js";
import * as history from "./views/history.js";
import * as season from "./views/season.js";
import { seedDefensiveDefaults } from "./models.js";

const views = { roster, playbook, game, history, season };

const viewRoot = document.getElementById("view-root");
const tabBar = document.getElementById("tab-bar");

function showView(name) {
  const view = views[name];
  if (!view) return;

  viewRoot.scrollTop = 0;
  document.getElementById("app-bar-context").textContent = "";
  view.render(viewRoot);

  for (const btn of tabBar.querySelectorAll(".tab-bar__btn")) {
    btn.classList.toggle("is-active", btn.dataset.view === name);
  }

  location.hash = name;
}

tabBar.addEventListener("click", (event) => {
  const btn = event.target.closest(".tab-bar__btn");
  if (btn) showView(btn.dataset.view);
});

// Seed the default coverages and mistakes before the first paint, so the
// Playbook screen never flashes an empty list on a fresh install. Seeding
// is a no-op on every launch after the first, and a failure here must not
// stop the app from opening.
seedDefensiveDefaults()
  .catch((err) => console.warn("Could not seed defensive defaults:", err))
  .then(() => {
    // Restore whichever tab was active if the page is reloaded (e.g. after
    // closing and reopening the app), falling back to Roster on first launch.
    const initial = location.hash.replace("#", "") || "roster";
    showView(views[initial] ? initial : "roster");
  });

// Register the offline service worker once it exists (added in Stage 6).
// Guarded so the app works fine locally before that file is added.
if ("serviceWorker" in navigator) {
  fetch("service-worker.js", { method: "HEAD" })
    .then((res) => {
      if (res.ok) navigator.serviceWorker.register("service-worker.js");
    })
    .catch(() => {
      /* offline or not deployed yet — fine, will register on next load */
    });
}
