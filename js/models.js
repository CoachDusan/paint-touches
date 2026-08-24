// Data access for every stored entity. Screens call these functions —
// nothing outside this file talks to IndexedDB directly.

import { getDB } from "./db.js";
import { uid } from "./utils.js";
import { sortEntities, listSortNeeds } from "./sort.js";

// ---------------------------------------------------------------------
// Players and Plays are the same *shape*: a simple named record you can
// add, edit, and archive (never hard-delete, so old games never break —
// see the plan's "Roster" section). This factory builds the CRUD API
// once and both `Players` and `Plays` below just point it at their own
// IndexedDB store.
// ---------------------------------------------------------------------
function archivableList(storeName) {
  // Most sorts read everything they need off the record itself. "Coverage"
  // doesn't — a breakdown stores coverage *ids*, and only the coverage list
  // says what order those go in. So we fetch it, but only when that sort is
  // actually the one turned on: the other four lists never pay for it.
  async function sortContext() {
    if (listSortNeeds(storeName) !== "coverages") return null;
    const db = await getDB();
    const coverages = await db.getAll("coverages");
    return {
      coverageOrder: new Map(
        sortEntities("coverages", coverages.filter((c) => !c.archived)).map((c, i) => [c.id, i])
      ),
    };
  }

  return {
    // IDs are random UUIDs and IndexedDB hands records back in key order,
    // so without sorting every list would appear shuffled. Which order is
    // the coach's choice, kept in js/sort.js — the roster reads by jersey
    // number, the rest keep the order they were typed in.
    async list() {
      const db = await getDB();
      const all = await db.getAll(storeName);
      return sortEntities(storeName, all.filter((item) => !item.archived), await sortContext());
    },

    async listArchived() {
      const db = await getDB();
      const all = await db.getAll(storeName);
      return sortEntities(storeName, all.filter((item) => item.archived), await sortContext());
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

    // Permanently removes every archived record. Safe for past games:
    // possessions store player/play *names* copied in at write time, never
    // links back to these records, so a finished game reads the same
    // afterwards. Archiving remains the normal path — this is the "clear
    // out the clutter" escape hatch, and it does not come back.
    async deleteArchived() {
      const db = await getDB();
      const all = await db.getAll(storeName);
      const doomed = all.filter((item) => item.archived).map((item) => item.id);
      if (doomed.length === 0) return 0;

      const tx = db.transaction(storeName, "readwrite");
      doomed.forEach((id) => tx.store.delete(id));
      await tx.done;
      return doomed.length;
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

// Quick tags: things you spot and want counted, with no possession attached.
export const QuickTags = archivableList("quickTags");

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

const DEFAULT_QUICK_TAGS = ["Lazy box-out"];

export async function seedDefensiveDefaults() {
  await seedList("coverages", DEFAULT_COVERAGES);
  await seedList("mistakes", DEFAULT_MISTAKES);
  await seedList("quickTags", DEFAULT_QUICK_TAGS);
}

// Always-available option in the live tracking play picker. Deliberately
// NOT a stored record — it can never be edited or archived away by
// accident, and the playbook screen never shows it as something to manage.
export const TRANSITION_PLAY = { id: null, name: "Transition / No Play" };

// ---------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------
export const VENUES = [
  { key: "home", label: "Home" },
  { key: "away", label: "Away" },
  { key: "neutral", label: "Neutral" },
];

// Win/loss is derived, never stored — asking for the score and the result
// separately invites them to disagree. Null when either score is missing,
// which is allowed: the score is optional.
export function gameResult(game) {
  if (game.ourScore == null || game.theirScore == null) return null;
  if (game.ourScore > game.theirScore) return "W";
  if (game.ourScore < game.theirScore) return "L";
  return "T";
}

export const Games = {
  async create({ date, opponent, venue }) {
    const db = await getDB();
    const game = {
      id: uid(),
      date,
      opponent: opponent || null,
      venue: venue || null,
      // The real scoreboard, entered when the game ends. Deliberately
      // separate from the points in `possessions`, which only counts trips
      // that were actually logged.
      ourScore: null,
      theirScore: null,
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

  async complete(id, { ourScore = null, theirScore = null } = {}) {
    return this.update(id, {
      status: "completed",
      completedAt: Date.now(),
      ourScore,
      theirScore,
    });
  },

  // Wipes every finished game and all of its possessions. A game still in
  // progress is deliberately left alone — "clear history" should never
  // delete the game you're in the middle of tracking.
  async clearCompleted() {
    const db = await getDB();
    const games = await db.getAll("games");
    const doomedGames = games.filter((g) => g.status === "completed").map((g) => g.id);
    if (doomedGames.length === 0) return 0;

    const doomed = new Set(doomedGames);
    const possessions = await db.getAll("possessions");
    const doomedPossessions = possessions.filter((p) => doomed.has(p.gameId)).map((p) => p.id);
    const events = await db.getAll("tagEvents");
    const doomedEvents = events.filter((e) => doomed.has(e.gameId)).map((e) => e.id);

    // All three stores in one transaction, so it can't half-succeed and
    // leave possessions or tag events pointing at a game that's gone.
    const tx = db.transaction(["games", "possessions", "tagEvents"], "readwrite");
    doomedGames.forEach((id) => tx.objectStore("games").delete(id));
    doomedPossessions.forEach((id) => tx.objectStore("possessions").delete(id));
    doomedEvents.forEach((id) => tx.objectStore("tagEvents").delete(id));
    await tx.done;
    return doomedGames.length;
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

// ---------------------------------------------------------------------
// Tag events — one record per player per occurrence. A lazy box-out by two
// players on the same shot is two records, which is exactly what a "count
// per player" stat needs and keeps logging to a single tap each.
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// Whole-database read and replace, for backup and restore. Restore wipes
// what's there — it reproduces a backup exactly rather than merging, since
// merging two copies of a season would silently double every stat.
// ---------------------------------------------------------------------
export const Backup = {
  async readAll(stores) {
    const db = await getDB();
    const entries = await Promise.all(stores.map(async (name) => [name, await db.getAll(name)]));
    return Object.fromEntries(entries);
  },

  async replaceAll(stores, data) {
    const db = await getDB();
    // One transaction across every store: a restore that half-applied would
    // leave possessions pointing at games that no longer exist.
    const tx = db.transaction(stores, "readwrite");
    for (const name of stores) {
      const store = tx.objectStore(name);
      store.clear();
      for (const record of data[name] || []) store.put(record);
    }
    await tx.done;
  },
};

export const TagEvents = {
  async add(event) {
    const db = await getDB();
    const record = { id: uid(), loggedAt: Date.now(), ...event };
    await db.put("tagEvents", record);
    return record;
  },

  async listByGame(gameId) {
    const db = await getDB();
    const all = await db.getAllFromIndex("tagEvents", "by-game", gameId);
    return all.sort((a, b) => a.loggedAt - b.loggedAt);
  },

  async remove(id) {
    const db = await getDB();
    await db.delete("tagEvents", id);
  },
};
