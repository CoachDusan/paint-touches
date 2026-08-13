// Backup and restore. This is the only thing standing between a season and
// a lost iPad, so it lives on its own rather than beside the share buttons —
// it isn't for showing another coach, it's insurance.

import { el } from "../utils.js";
import { Backup } from "../models.js";
import { buildBackup, parseBackup, backupFilename, BACKUP_STORES } from "../export.js";
import { shareFile } from "../share.js";

export function renderBackupCard(onRestored) {
  const status = el("div", { class: "stat-note" }, "");

  async function onBackup() {
    const data = await Backup.readAll(BACKUP_STORES);
    const counts = BACKUP_STORES.map((s) => `${data[s].length} ${s}`).join(", ");
    const result = await shareFile(backupFilename(), "application/json", buildBackup(data), "Paint Touches backup");
    status.textContent = result.ok
      ? `Backed up ${counts}. Keep it somewhere off this iPad.`
      : "Couldn't create the backup file.";
  }

  const fileInput = el("input", {
    type: "file",
    accept: "application/json,.json",
    class: "visually-hidden",
    onchange: async (event) => {
      const file = event.target.files?.[0];
      // Clear immediately so picking the same file twice still fires.
      event.target.value = "";
      if (!file) return;

      const parsed = parseBackup(await file.text());
      if (!parsed.ok) {
        status.textContent = parsed.error;
        return;
      }

      const summary = BACKUP_STORES.filter((s) => parsed.counts[s])
        .map((s) => `${parsed.counts[s]} ${s}`)
        .join(", ");

      if (!confirm(
        `Restore this backup?\n\n${summary || "It contains no records"}.\n\n` +
        `This REPLACES everything currently in the app — every game, player and list. ` +
        `It cannot be undone. Back up first if you're not sure.`
      )) {
        status.textContent = "Restore cancelled — nothing changed.";
        return;
      }

      await Backup.replaceAll(BACKUP_STORES, parsed.data);
      status.textContent = "Restored. Reloading…";
      // A full reload is the honest way back: every screen is holding data
      // that no longer exists.
      setTimeout(() => window.location.reload(), 600);
      if (onRestored) onRestored();
    },
  });

  return el("div", { class: "card" }, [
    el("div", { class: "section-label" }, "Backup"),
    el("div", { class: "stat-note" },
      "Everything you've tracked lives only on this iPad. A backup file is the only copy that survives losing it, and it's how you'd move to a new device."),
    el("div", { class: "form-row" }, [
      el("button", { class: "btn btn-primary", onclick: onBackup }, "Back up everything"),
      el("button", { class: "btn btn-danger", onclick: () => fileInput.click() }, "Restore from file"),
    ]),
    fileInput,
    status,
  ]);
}
