// Preseason and season, told apart by one date: the day the season started.
// Every game dated before it is preseason, every game on or after it is the
// season. Nothing is written onto a game — change the date and every game
// falls on the right side of it again, with no migration and nothing stored
// to go stale. (Chosen over a label on each game, Sep 2026: less to tap. The
// cost, accepted knowingly: a friendly played mid-season counts as a season
// game.)
//
// Like the sort settings, the date and the report switch live in
// localStorage: per-iPad, not inside a backup. Restoring onto another iPad
// means entering the date once more. With no date set there is no preseason
// at all, and every screen behaves exactly as it did before this existed.

const START_KEY = "paint-touches:season-start";
const SCOPE_KEY = "paint-touches:season-scope";

// What the Season screen and the coach report include. One switch for both,
// so the totals on screen and the report never quietly disagree.
export const SCOPES = [
  { key: "season", label: "Season only" },
  { key: "all", label: "Season + preseason" },
  { key: "compare", label: "Season vs preseason" },
];

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* the choice just won't outlive this session */
  }
}

// "YYYY-MM-DD", or null when the coach hasn't set one.
export function getSeasonStart() {
  const v = read(START_KEY);
  return /^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : null;
}

export function setSeasonStart(date) {
  write(START_KEY, date || null);
}

// Without a start date there is nothing to split, so the only honest answer
// is "everything".
export function getScope() {
  if (!getSeasonStart()) return "all";
  const v = read(SCOPE_KEY);
  return SCOPES.some((s) => s.key === v) ? v : "season";
}

export function setScope(key) {
  write(SCOPE_KEY, key);
}

// Dates are stored as "YYYY-MM-DD", so comparing the strings compares the days.
export function isPreseason(game, start = getSeasonStart()) {
  return Boolean(start && game && game.date && game.date < start);
}

// `pick` finds the game inside whatever is being split — a game itself, or a
// { game, possessions } entry.
export function splitByPhase(list, start = getSeasonStart(), pick = (x) => x.game || x) {
  const preseason = [], season = [];
  for (const item of list) (isPreseason(pick(item), start) ? preseason : season).push(item);
  return { preseason, season };
}

// What one game is measured against, given every game finished before it.
// A season game is set against earlier season games; the first one of the
// season has none, so it is set against the preseason instead, and the label
// says so. A preseason game is set against earlier preseason games only.
// With no start date, every earlier game, as it always was.
export function comparisonPool(game, earlier, start = getSeasonStart(), pick = (x) => x.game || x) {
  const n = (list) => `${list.length} game${list.length === 1 ? "" : "s"}`;
  if (!start) return { entries: earlier, label: `Previous ${n(earlier)}` };
  const { preseason, season } = splitByPhase(earlier, start, pick);
  if (isPreseason(game, start)) return { entries: preseason, label: `Previous ${n(preseason)} of preseason` };
  if (season.length) return { entries: season, label: `Previous ${n(season)} of the season` };
  return { entries: preseason, label: `Preseason, ${n(preseason)}` };
}
