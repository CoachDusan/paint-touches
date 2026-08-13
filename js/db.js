// The IndexedDB connection — this is the on-device "filing cabinet" that
// makes offline storage possible. Every screen goes through here (via
// models.js) rather than touching IndexedDB directly.

import { openDB } from "../vendor/idb.js";

const DB_NAME = "paint-touches";
const DB_VERSION = 1;

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
      },
    });
  }
  return dbPromise;
}
