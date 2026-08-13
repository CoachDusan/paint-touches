// Data access for every stored entity. Screens call these functions —
// nothing outside this file talks to IndexedDB directly.

import { getDB } from "./db.js";
import { uid } from "./utils.js";

// ---------------------------------------------------------------------
// Players and Plays are the same *shape*: a simple named record you can
// add, edit, and archive (never hard-delete, so old games never break —
// see the plan's "Roster" section). This factory builds the CRUD API
// once and both `Players` and `Plays` below just point it at their own
// IndexedDB store.
// ---------------------------------------------------------------------
function archivableList(storeName) {
  return {
    async list() {
      const db = await getDB();
      const all = await db.getAll(storeName);
      return all.filter((item) => !item.archived);
    },

    async listArchived() {
      const db = await getDB();
      const all = await db.getAll(storeName);
      return all.filter((item) => item.archived);
    },

    async add(fields) {
      const db = await getDB();
      const record = {
        id: uid(),
        ...fields,
        archived: false,
        createdAt: Date.now(),
        archivedAt: null,
      };
      await db.put(storeName, record);
      return record;
    },

    async update(id, fields) {
      const db = await getDB();
      const existing = await db.get(storeName, id);
      if (!existing) return null;
      const updated = { ...existing, ...fields };
      await db.put(storeName, updated);
      return updated;
    },

    async archive(id) {
      return this.update(id, { archived: true, archivedAt: Date.now() });
    },

    async unarchive(id) {
      return this.update(id, { archived: false, archivedAt: null });
    },

    async get(id) {
      const db = await getDB();
      return db.get(storeName, id);
    },
  };
}

export const Players = archivableList("players");
export const Plays = archivableList("plays");

// Always-available option in the live tracking play picker. Deliberately
// NOT a stored record — it can never be edited or archived away by
// accident, and the playbook screen never shows it as something to manage.
export const TRANSITION_PLAY = { id: null, name: "Transition / No Play" };

// ---------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------
export const Games = {
  async create({ date, opponent }) {
    const db = await getDB();
    const game = {
      id: uid(),
      date,
      opponent: opponent || null,
      status: "in_progress",
      currentQuarter: "1", // one of QUARTERS in possession.js: "1","2","3","4","OT"
      createdAt: Date.now(),
      completedAt: null,
    };
    await db.put("games", game);
    return game;
  },

  async get(id) {
    const db = await getDB();
    return db.get("games", id);
  },

  async update(id, fields) {
    const db = await getDB();
    const existing = await db.get("games", id);
    if (!existing) return null;
    const updated = { ...existing, ...fields };
    await db.put("games", updated);
    return updated;
  },

  // Only one game should ever be "in progress" at a time. If somehow more
  // than one exists, the most recently created wins.
  async getActive() {
    const db = await getDB();
    const all = await db.getAll("games");
    const inProgress = all.filter((g) => g.status === "in_progress");
    inProgress.sort((a, b) => b.createdAt - a.createdAt);
    return inProgress[0] || null;
  },

  async listCompleted() {
    const db = await getDB();
    const all = await db.getAll("games");
    return all
      .filter((g) => g.status === "completed")
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  },

  async complete(id) {
    return this.update(id, { status: "completed", completedAt: Date.now() });
  },
};

// ---------------------------------------------------------------------
// Possessions — the core record. Each one is written once it's closed and
// is never edited afterwards (see points-calc rule in possession.js), so
// live and historical stats always read the exact same frozen numbers.
// ---------------------------------------------------------------------
export const Possessions = {
  async add(possession) {
    const db = await getDB();
    const record = { id: uid(), ...possession };
    await db.put("possessions", record);
    return record;
  },

  async listByGame(gameId) {
    const db = await getDB();
    const all = await db.getAllFromIndex("possessions", "by-game", gameId);
    return all.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  },
};
