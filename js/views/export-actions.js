// The export row that appears on a game and on the season. Takes builders
// rather than finished strings so nothing is generated until it's asked
// for — no point serialising a season every time the screen paints.

import { el } from "../utils.js";
import { shareText, shareFile, printCurrentView, fallbackTextBox } from "../share.js";

const HOW_MESSAGE = {
  share: "Opened the share sheet.",
  clipboard: "Copied to the clipboard — paste it wherever you like.",
  download: "Saved to your Files.",
  cancelled: "",
};

export function renderExportActions({ title, buildSummary, buildCsv, filenameBase }) {
  const status = el("div", { class: "stat-note export-status" }, "");
  const extra = el("div", {});

  function say(message) {
    status.textContent = message;
    extra.replaceChildren();
  }

  async function onSummary() {
    const text = buildSummary();
    const result = await shareText(text, title);
    if (result.ok) {
      say(HOW_MESSAGE[result.how] ?? "");
      return;
    }
    // Neither the share sheet nor the clipboard would take it — put the
    // text on screen so it can still be copied by hand.
    say("Couldn't open the share sheet. Copy the text below:");
    extra.replaceChildren(fallbackTextBox(text));
  }

  async function onCsv() {
    const result = await shareFile(`${filenameBase}.csv`, "text/csv", buildCsv(), title);
    say(result.ok ? HOW_MESSAGE[result.how] ?? "" : "Couldn't save the file.");
  }

  return el("div", { class: "card export-actions" }, [
    el("div", { class: "section-label" }, "Share & export"),
    el("div", { class: "form-row" }, [
      el("button", { class: "btn btn-primary", onclick: onSummary }, "Share summary"),
      el("button", { class: "btn", onclick: onCsv }, "Spreadsheet (CSV)"),
      el("button", { class: "btn", onclick: printCurrentView }, "Print / PDF"),
    ]),
    el("div", { class: "stat-note" },
      "Print / PDF prints this screen — on the iPad, choose Save to Files in the print dialog to get a PDF."),
    status,
    extra,
  ]);
}
