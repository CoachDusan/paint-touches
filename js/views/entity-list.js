// A generic "editable named list" screen: add / edit / archive / unarchive
// a record. The Roster (players) and Playbook (plays) are structurally
// identical, so both just configure this once instead of duplicating it.

import { el } from "../utils.js";

/**
 * @param {HTMLElement} root
 * @param {object} config
 * @param {string} config.title
 * @param {string} config.itemNoun            e.g. "Player" / "Play"
 * @param {string} config.emptyText
 * @param {{key:string,label:string,placeholder?:string,maxlength?:number,widthClass?:string}[]} config.fields
 * @param {(item:object) => string} config.renderRowLabel
 * @param {{list,listArchived,add,update,archive,unarchive}} config.api
 */
export function renderEntityList(root, config) {
  const state = {
    items: [],
    archivedItems: [],
    showArchived: false,
    formMode: null, // null | "add" | { edit: id }
  };

  async function load() {
    state.items = await config.api.list();
    state.archivedItems = await config.api.listArchived();
    paint();
  }

  function readForm(formEl) {
    const values = {};
    for (const field of config.fields) {
      const input = formEl.querySelector(`[name="${field.key}"]`);
      values[field.key] = input.value.trim();
    }
    return values;
  }

  function buildFieldsForm(existing) {
    const inputs = config.fields.map((field) =>
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

    const form = el("form", { class: "card entity-form" }, [
      el("div", { class: "form-row" }, inputs),
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
      el("span", { class: "list-row__main" }, config.renderRowLabel(item)),
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
