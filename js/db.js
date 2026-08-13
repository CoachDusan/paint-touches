// The IndexedDB connection — this is the on-device "filing cabinet" that
// makes offline storage possible. Every screen goes through here (via
// models.js) rather than touching IndexedDB directly.

import { openDB } from "../vendor/idb.js";

const DB_NAME = "paint-touches";
// v2 added the two defensive lists (coverages, mistakes). Bumping this is
// what triggers upgrade() on a device that already has the old database —
// existing games and roster are untouched, the new stores are just added
// alongside them.
const DB_VERSION = 2;

let dbPromise;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("players")) {
          db.createObjectStore("players", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("plays")) {
          db.createObjectStore("plays", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("games")) {
          db.createObjectStore("games", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("possessions")) {
          const store = db.createObjectStore("possessions", { keyPath: "id" });
          store.createIndex("by-game", "gameId");
        }
        // Defensive side: the pick-and-roll coverages we call, and the
        // breakdowns we log against them. Same shape as plays.
        if (!db.objectStoreNames.contains("coverages")) {
          db.createObjectStore("coverages", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("mistakes")) {
          db.createObjectStore("mistakes", { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}
