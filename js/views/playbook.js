// Four editable lists that together describe "our system": the sets we run
// on offense, the pick-and-roll coverages we call on defense, the breakdowns
// we log against those coverages, and the quick tags we count on their own.
// They share one tab rather than four, because they're the same kind of
// thing and the bottom bar has no room to spare.

import { el } from "../utils.js";
import { renderEntityList } from "./entity-list.js";
import { Plays, Coverages, Mistakes, QuickTags } from "../models.js";

const SECTIONS = [
  {
    key: "plays",
    // Store name, which is also the key its sort order is remembered under.
    storeName: "plays",
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
    // Store name, which is also the key its sort order is remembered under.
    storeName: "coverages",
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
    // Store name, which is also the key its sort order is remembered under.
    storeName: "mistakes",
    tab: "Mistakes",
    config: {
      title: "PnR Mistakes",
      itemNoun: "Mistake",
      emptyText:
        "No mistake types yet. Add the breakdowns you want to track — during a game you'll tap one of these, or 'No mistake' when the coverage was executed well.",
      fields: [
        { key: "name", label: "Mistake", placeholder: "Guard went under the screen" },
        {
          key: "coverageIds",
          label: "Only shown for these coverages",
          type: "multiselect",
          optionsKey: "coverages",
          anyLabel: "Any coverage",
        },
      ],
      loadOptions: async () => ({ coverages: await Coverages.list() }),
      api: Mistakes,
    },
  },
  {
    key: "tags",
    // Store name, which is also the key its sort order is remembered under.
    storeName: "quickTags",
    tab: "Tags",
    config: {
      title: "Quick Tags",
      itemNoun: "Tag",
      emptyText:
        "No quick tags yet. These are things you spot and want counted — tap one during a game, then tap the players. They aren't tied to a possession.",
      fields: [{ key: "name", label: "Tag", placeholder: "Lazy box-out" }],
      api: QuickTags,
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
      // No jersey numbers here, so it's alphabetical or the order you
      // typed them in — and typed order is the default, because these
      // buttons' positions are already muscle memory on the sideline.
      sortListKey: section.storeName,
      sortOptions: ["added", "name"],
      renderRowLabel: (item, options) => {
        const assigned = item.coverageIds || [];
        if (!assigned.length) {
          // No assignment means it shows up under every coverage, which is
          // worth saying out loud rather than leaving the row bare.
          return section.key === "mistakes"
            ? [el("span", {}, item.name), el("span", { class: "pill" }, "Any coverage")]
            : item.name;
        }
        const names = (options.coverages || [])
          .filter((c) => assigned.includes(c.id))
          .map((c) => c.name);
        return [
          el("span", {}, item.name),
          ...names.map((n) => el("span", { class: "pill" }, n)),
        ];
      },
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
