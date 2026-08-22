// Sorting, in one place — both halves of it.
//
// 1. LIST SORT: the order of the *tap targets* — the roster, the plays,
//    the coverages. Chosen on the Roster / Playbook screens and remembered
//    between sessions. Deliberately never changes on its own: buttons that
//    move under your thumb mid-possession cause mis-taps, so a new sort
//    only takes effect when you ask for one.
//
// 2. TABLE SORT: the order of rows in a stats table. Tap a column header.
//    This one *is* meant to survive new data — the live panel rebuilds
//    itself after every possession, so the chosen column is stored here
//    and re-applied on each rebuild rather than resetting to default.
//
// Preferences live in localStorage, not IndexedDB: they're per-iPad
// display settings, not season data, and they have no business travelling
// inside a backup file.

const STORE_KEY = "paint-touches:sort-prefs";

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
  } catch {
    // Private browsing, or storage turned off. Sorting is a convenience —
    // it must never be the reason the app fails to open.
    return {};
  }
}

function writePrefs(prefs) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
  } catch {
    /* nothing to do — the choice just won't outlive this session */
  }
}

// ---------------------------------------------------------------------
// 1. List sort
// ---------------------------------------------------------------------

// A missing or non-numeric jersey number sorts last rather than as zero:
// a player you haven't given a number yet belongs at the bottom of the
// roster, not above #4.
function jerseyOf(item) {
  const n = parseInt(item.number, 10);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

function byName(a, b) {
  return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
}

function byCreatedAt(a, b) {
  return (a.createdAt || 0) - (b.createdAt || 0);
}

export const LIST_SORTS = {
  number: { key: "number", label: "#", compare: (a, b) => jerseyOf(a) - jerseyOf(b) || byName(a, b) },
  name: { key: "name", label: "A–Z", compare: (a, b) => byName(a, b) || byCreatedAt(a, b) },
  added: { key: "added", label: "Added", compare: byCreatedAt },
};

// The roster reads like a scorebook by default. Everything else keeps the
// order it was typed in, because those lists are short, hand-ordered by the
// coach, and their button positions are already muscle memory.
const DEFAULT_LIST_SORT = {
  players: "number",
  plays: "added",
  coverages: "added",
  mistakes: "added",
  quickTags: "added",
};

export function getListSort(listKey) {
  const chosen = readPrefs().lists?.[listKey];
  return LIST_SORTS[chosen] ? chosen : DEFAULT_LIST_SORT[listKey] || "added";
}

export function setListSort(listKey, sortKey) {
  if (!LIST_SORTS[sortKey]) return;
  const prefs = readPrefs();
  prefs.lists = { ...(prefs.lists || {}), [listKey]: sortKey };
  writePrefs(prefs);
}

// Always returns a new array — callers hand us the result of a database
// read and shouldn't have to care whether it was sorted in place.
export function sortEntities(listKey, items) {
  return [...items].sort(LIST_SORTS[getListSort(listKey)].compare);
}

// ---------------------------------------------------------------------
// 2. Table sort
// ---------------------------------------------------------------------

// "—" and blanks always sink to the bottom, whichever direction you sort.
// A column of dashes at the top answers no question worth asking.
function isBlank(text) {
  return text === "" || text === "—";
}

// Only a cell that is *entirely* a number counts as one. That keeps
// "#23 Jordan Smith" a name rather than the number 23, so the Player
// column sorts alphabetically like a name should.
function asNumber(text) {
  const cleaned = text.replace(/[%,]/g, "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return parseFloat(cleaned);
}

function cellText(row, index) {
  const cell = row.children[index];
  return cell ? cell.textContent.trim() : "";
}

export function getTableSort(tableId) {
  return readPrefs().tables?.[tableId] || null;
}

function setTableSort(tableId, value) {
  const prefs = readPrefs();
  const tables = { ...(prefs.tables || {}) };
  if (value) tables[tableId] = value;
  else delete tables[tableId];
  prefs.tables = tables;
  writePrefs(prefs);
}

/**
 * Tapping a header cycles that column: sort → reverse → back to the
 * table's own default order. Three states rather than two so there's
 * always a way back to how the app ordered it, which for "By quarter"
 * (Q1, Q2, Q3, Q4) is the only order that makes sense.
 */
export function cycleTableSort(tableId, columnIndex, numeric) {
  const current = getTableSort(tableId);
  if (!current || current.column !== columnIndex) {
    // Numbers open biggest-first — you tap "Touches" to see who leads it,
    // not who trails it. Text opens A–Z.
    setTableSort(tableId, { column: columnIndex, dir: numeric ? "desc" : "asc" });
  } else if (current.dir === (numeric ? "desc" : "asc")) {
    setTableSort(tableId, { column: columnIndex, dir: numeric ? "asc" : "desc" });
  } else {
    setTableSort(tableId, null);
  }
  return getTableSort(tableId);
}

// True when the column holds numbers, judged from the first row that has
// anything in it at all.
export function columnIsNumeric(rows, columnIndex) {
  for (const row of rows) {
    const text = cellText(row, columnIndex);
    if (!isBlank(text)) return asNumber(text) !== null;
  }
  return false;
}

export function sortRows(rows, columnIndex, dir) {
  const decorated = rows.map((row, position) => {
    const text = cellText(row, columnIndex);
    return { row, position, text, number: asNumber(text), blank: isBlank(text) };
  });

  decorated.sort((a, b) => {
    if (a.blank !== b.blank) return a.blank ? 1 : -1;
    let cmp;
    if (a.number !== null && b.number !== null) cmp = a.number - b.number;
    else cmp = a.text.localeCompare(b.text, undefined, { numeric: true, sensitivity: "base" });
    // Ties keep the order the stats code produced, so a re-sort after a new
    // possession never shuffles rows that are genuinely level.
    if (cmp === 0) return a.position - b.position;
    return dir === "asc" ? cmp : -cmp;
  });

  return decorated.map((d) => d.row);
}
