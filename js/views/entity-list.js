// A generic "editable named list" screen: add / edit / archive / unarchive
// a record. The Roster (players) and Playbook (plays) are structurally
// identical, so both just configure this once instead of duplicating it.

import { el } from "../utils.js";
import { LIST_SORTS, getListSort, setListSort } from "../sort.js";

/**
 * @param {HTMLElement} root
 * @param {object} config
 * @param {string} config.title
 * @param {string} config.itemNoun            e.g. "Player" / "Play"
 * @param {string} config.emptyText
 * @param {{key:string,label:string,placeholder?:string,maxlength?:number,widthClass?:string,
 *          type?:"text"|"multiselect",optionsKey?:string,anyLabel?:string}[]} config.fields
 * @param {(item:object) => (string|Node|Array)} config.renderRowLabel
 * @param {string} [config.sortListKey]      Store name this list sorts under, e.g. "players"
 * @param {string[]} [config.sortOptions]    Keys from LIST_SORTS to offer, in display order
 * @param {() => Promise<Record<string,{id:string,name:string}[]>>} [config.loadOptions]
 *        Choices for any `multiselect` field, keyed by the field's optionsKey.
 *        Loaded alongside the list, since the form is built synchronously.
 * @param {{list,listArchived,add,update,archive,unarchive}} config.api
 */
export function renderEntityList(root, config) {
  const state = {
    items: [],
    archivedItems: [],
    showArchived: false,
    formMode: null, // null | "add" | { edit: id }
    options: {},
  };

  const textFields = () => config.fields.filter((f) => (f.type || "text") === "text");
  const multiFields = () => config.fields.filter((f) => f.type === "multiselect");

  async function load() {
    const [items, archivedItems, options] = await Promise.all([
      config.api.list(),
      config.api.listArchived(),
      config.loadOptions ? config.loadOptions() : Promise.resolve({}),
    ]);
    state.items = items;
    state.archivedItems = archivedItems;
    state.options = options;
    paint();
  }

  function buildFieldsForm(existing) {
    // Chips aren't form inputs, so a multiselect's value is held here for the
    // lifetime of this form and read back on submit.
    const chosen = {};
    for (const field of multiFields()) {
      chosen[field.key] = [...(existing?.[field.key] || [])];
    }

    function readForm(formEl) {
      const values = {};
      for (const field of textFields()) {
        values[field.key] = formEl.querySelector(`[name="${field.key}"]`).value.trim();
      }
      for (const field of multiFields()) {
        values[field.key] = [...chosen[field.key]];
      }
      return values;
    }

    const inputs = textFields().map((field) =>
      el("div", { class: "field" + (field.widthClass ? " " + field.widthClass : "") }, [
        el("label", {}, field.label),
        el("input", {
          type: "text",
          name: field.key,
          placeholder: field.placeholder || "",
          maxlength: field.maxlength || null,
          value: existing ? existing[field.key] || "" : "",
        }),
      ])
    );

    // An empty selection means "applies to all", which is the sane default:
    // a mistake nobody has assigned yet should still be offered, not hidden.
    const multiInputs = multiFields().map((field) => {
      const options = state.options[field.optionsKey] || [];
      const chipGrid = el("div", { class: "chip-grid" });

      const repaintChips = () => {
        chipGrid.replaceChildren(
          el("button", {
            type: "button",
            class: "chip" + (chosen[field.key].length === 0 ? " is-active" : ""),
            onclick: () => {
              chosen[field.key] = [];
              repaintChips();
            },
          }, field.anyLabel || "Any"),
          ...options.map((option) =>
            el("button", {
              type: "button",
              class: "chip" + (chosen[field.key].includes(option.id) ? " is-active" : ""),
              onclick: () => {
                const list = chosen[field.key];
                const at = list.indexOf(option.id);
                if (at === -1) list.push(option.id);
                else list.splice(at, 1);
                repaintChips();
              },
            }, option.name)
          )
        );
      };
      repaintChips();

      return el("div", { class: "field" }, [el("label", {}, field.label), chipGrid]);
    });

    const form = el("form", { class: "card entity-form" }, [
      el("div", { class: "form-row" }, inputs),
      ...multiInputs,
      el("div", { class: "form-row" }, [
        el("button", { type: "submit", class: "btn btn-primary" }, existing ? "Save" : "Add"),
        el("button", {
          type: "button",
          class: "btn",
          onclick: () => {
            state.formMode = null;
            paint();
          },
        }, "Cancel"),
      ]),
    ]);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = readForm(form);
      if (!values.name) return; // name is always required, whatever the entity
      if (existing) {
        await config.api.update(existing.id, values);
      } else {
        await config.api.add(values);
      }
      state.formMode = null;
      await load();
    });

    return form;
  }

  function buildRow(item, { archived }) {
    if (!archived && state.formMode && state.formMode.edit === item.id) {
      return el("li", {}, buildFieldsForm(item));
    }

    return el("li", { class: "list-row" }, [
      el("span", { class: "list-row__main" }, config.renderRowLabel(item, state.options)),
      el("span", { class: "list-row__actions" }, [
        archived
          ? el("button", {
              class: "btn btn-sm",
              onclick: async () => {
                await config.api.unarchive(item.id);
                await load();
              },
            }, "Unarchive")
          : el("button", {
              class: "btn btn-sm",
              onclick: () => {
                state.formMode = { edit: item.id };
                paint();
              },
            }, "Edit"),
        archived
          ? null
          : el("button", {
              class: "btn btn-sm btn-danger",
              onclick: async () => {
                if (!confirm(`Archive this ${config.itemNoun.toLowerCase()}? Past games keep their data — this just removes them from new games.`)) return;
                await config.api.archive(item.id);
                await load();
              },
            }, "Archive"),
      ]),
    ]);
  }

  // The order chosen here is the order the tap buttons appear in during a
  // game — that's the whole point of it, so it says so out loud.
  function buildSortBar() {
    if (!config.sortListKey || !config.sortOptions?.length) return null;
    const active = getListSort(config.sortListKey);
    return el("div", { class: "sort-bar" }, [
      el("span", { class: "sort-bar__label" }, "Sort by"),
      el("div", { class: "segmented segmented--inline" },
        config.sortOptions.map((key) =>
          el("button", {
            class: "segmented__btn" + (key === active ? " is-active" : ""),
            "data-sort": key,
            onclick: async () => {
              if (getListSort(config.sortListKey) === key) return;
              setListSort(config.sortListKey, key);
              await load();
            },
          }, LIST_SORTS[key].label)
        )
      ),
    ]);
  }

  function paint() {
    const children = [
      el("div", { class: "list-toolbar" }, [
        el("h1", { class: "screen-title" }, config.title),
        el("button", {
          class: "btn btn-primary btn-sm",
          onclick: () => {
            state.formMode = "add";
            paint();
          },
        }, `+ Add ${config.itemNoun}`),
      ]),
    ];

    const sortBar = buildSortBar();
    if (sortBar) children.push(sortBar);

    if (state.formMode === "add") {
      children.push(buildFieldsForm(null));
    }

    if (state.items.length === 0 && state.formMode !== "add") {
      children.push(el("div", { class: "empty-state" }, config.emptyText));
    } else {
      children.push(
        el("ul", { class: "entity-list" }, state.items.map((item) => buildRow(item, { archived: false })))
      );
    }

    if (state.archivedItems.length > 0) {
      children.push(
        el("button", {
          class: "btn btn-sm link-btn",
          onclick: () => {
            state.showArchived = !state.showArchived;
            paint();
          },
        }, state.showArchived ? "Hide archived" : `Show archived (${state.archivedItems.length})`)
      );

      if (state.showArchived) {
        children.push(
          el("ul", { class: "entity-list" }, state.archivedItems.map((item) => buildRow(item, { archived: true })))
        );
        children.push(
          el("button", {
            class: "btn btn-sm btn-danger",
            onclick: async () => {
              const n = state.archivedItems.length;
              if (!confirm(
                `Permanently delete ${n} archived ${config.itemNoun.toLowerCase()}${n === 1 ? "" : "s"}?\n\n` +
                `This cannot be undone. Past games are not affected — they keep their own copy of every name.`
              )) return;
              await config.api.deleteArchived();
              state.showArchived = false;
              await load();
            },
          }, `Delete all ${state.archivedItems.length} archived permanently`)
        );
      }
    }

    root.replaceChildren(el("div", { class: "screen" }, children));
  }

  paint();
  load();
}
