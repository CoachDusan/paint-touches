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
function byCreatedAt(a, b) {
  return (a.createdAt || 0) - (b.createdAt || 0);
}

function archivableList(storeName) {
  return {
    // Sorted oldest-first. IDs are random UUIDs and IndexedDB hands records
    // back in key order, so without this every list would appear in a
    // meaningless, shuffled order.
    async list() {
      const db = await getDB();
      const all = await db.getAll(storeName);
      return all.filter((item) => !item.archived).sort(byCreatedAt);
    },

    async listArchived() {
      const db = await getDB();
      const all = await db.getAll(storeName);
      return all.filter((item) => item.archived).sort(byCreatedAt);
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

// The defensive side of the system: which pick-and-roll coverage we called,
// and the breakdowns we log against it. Same archivable shape as plays, so
// renaming or retiring a coverage mid-season never rewrites a past game.
export const Coverages = archivableList("coverages");
export const Mistakes = archivableList("mistakes");

// Starting points only — every one of these can be renamed or archived on
// the Playbook screen. An empty screen is a worse first experience than a
// list you have to prune.
const DEFAULT_COVERAGES = ["Drop", "Hedge (Show)", "Switch", "Blitz (Trap)", "Ice (Down)", "Flat"];

const DEFAULT_MISTAKES = [
  "Guard went under the screen",
  "Guard caught on the screen",
  "Big not at level of screen",
  "Big recovered late to the roller",
  "Blown switch / miscommunication",
  "No tag on the roller",
  "Let ball handler go middle",
  "Late closeout on the pop",
  "Foul",
];

// Seeds a list only if it has never held anything — archived records count,
// so a coach who deliberately archives every default never gets them back
// on the next app open.
async function seedList(storeName, names) {
  const db = await getDB();
  if ((await db.count(storeName)) > 0) return false;

  const base = Date.now();
  const tx = db.transaction(storeName, "readwrite");
  names.forEach((name, i) => {
    // Staggered createdAt so the seeded order is the order shown.
    tx.store.put({ id: uid(), name, archived: false, createdAt: base + i, archivedAt: null });
  });
  await tx.done;
  return true;
}

export async function seedDefensiveDefaults() {
  await seedList("coverages", DEFAULT_COVERAGES);
  await seedList("mistakes", DEFAULT_MISTAKES);
}

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
