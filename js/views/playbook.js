// Three editable lists that together describe "our system": the sets we run
// on offense, the pick-and-roll coverages we call on defense, and the
// breakdowns we log against those coverages. They share one tab rather than
// three, because they're the same kind of thing and the bottom bar has no
// room to spare.

import { el } from "../utils.js";
import { renderEntityList } from "./entity-list.js";
import { Plays, Coverages, Mistakes } from "../models.js";

const SECTIONS = [
  {
    key: "plays",
    tab: "Plays",
    config: {
      title: "Playbook",
      itemNoun: "Play",
      emptyText:
        "No plays yet. Add the sets from your playbook — during a game you'll tap one of these to tag each possession.",
      fields: [{ key: "name", label: "Play name", placeholder: "Horns" }],
      api: Plays,
    },
  },
  {
    key: "coverages",
    tab: "Coverages",
    config: {
      title: "PnR Coverages",
      itemNoun: "Coverage",
      emptyText:
        "No coverages yet. Add the pick-and-roll coverages you call — during a game you'll tap one of these before logging the possession.",
      fields: [{ key: "name", label: "Coverage name", placeholder: "Drop" }],
      api: Coverages,
    },
  },
  {
    key: "mistakes",
    tab: "Mistakes",
    config: {
      title: "PnR Mistakes",
      itemNoun: "Mistake",
      emptyText:
        "No mistake types yet. Add the breakdowns you want to track — during a game you'll tap one of these, or 'No mistake' when the coverage was executed well.",
      fields: [{ key: "name", label: "Mistake", placeholder: "Guard went under the screen" }],
      api: Mistakes,
    },
  },
];

// Remembered across tab switches within a session — flipping to Game and
// back shouldn't dump you out of the section you were editing.
let activeKey = "plays";

export function render(root) {
  const sectionRoot = el("div", {});

  function paintSection() {
    const section = SECTIONS.find((s) => s.key === activeKey) || SECTIONS[0];
    renderEntityList(sectionRoot, {
      ...section.config,
      renderRowLabel: (item) => item.name,
    });
  }

  const nav = el(
    "div",
    { class: "segmented" },
    SECTIONS.map((section) =>
      el(
        "button",
        {
          class: "segmented__btn" + (section.key === activeKey ? " is-active" : ""),
          "data-section": section.key,
          onclick: () => {
            if (activeKey === section.key) return;
            activeKey = section.key;
            render(root);
          },
        },
        section.tab
      )
    )
  );

  root.replaceChildren(el("div", { class: "section-stack" }, [nav, sectionRoot]));
  paintSection();
}
