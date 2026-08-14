// Small shared helpers used across the app.

// Generate a unique id for a new record (player, play, game, possession...).
export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Round to 2 decimals for stat display, but don't show trailing zeros noise.
export function formatPPP(points, possessions) {
  if (!possessions) return "—";
  return (points / possessions).toFixed(2);
}

export function formatPct(made, attempts) {
  if (!attempts) return "—";
  return Math.round((made / attempts) * 100) + "%";
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value !== null && value !== undefined) {
      node.setAttribute(key, value);
    }
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

// Wall-clock time of a tap, e.g. "7:42 PM". The most reliable handle for
// finding a moment in video, since video files carry their own timestamps.
export function formatClock(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// How far into the game it happened, e.g. "14:20". Only meaningful against a
// known start, so callers without one should leave it out rather than guess.
export function formatElapsed(ms, startMs) {
  if (!ms || !startMs || ms < startMs) return null;
  const total = Math.round((ms - startMs) / 1000);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
