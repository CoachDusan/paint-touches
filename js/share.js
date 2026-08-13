// Getting things off the iPad. The app runs in standalone mode with no
// Safari toolbar, so there's no browser share or print button to fall back
// on — every route out has to be opened from in here.
//
// Each function tries the best available option and quietly steps down:
// iOS share sheet → clipboard → a selectable box on screen. Something
// always works, even if it's the coach reading it off the display.

export async function shareText(text, title) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return { ok: true, how: "share" };
    } catch (err) {
      // Dismissing the share sheet throws AbortError. That's a decision,
      // not a failure — don't fall through and paste it somewhere else.
      if (err && err.name === "AbortError") return { ok: true, how: "cancelled" };
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    return { ok: true, how: "clipboard" };
  } catch {
    return { ok: false, how: "manual" };
  }
}

export async function shareFile(filename, mime, contents, title) {
  const file = new File([contents], filename, { type: mime });

  if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title });
      return { ok: true, how: "share" };
    } catch (err) {
      if (err && err.name === "AbortError") return { ok: true, how: "cancelled" };
    }
  }

  // Fallback: a normal download. Works on desktop; on iOS it lands in Files.
  try {
    const url = URL.createObjectURL(new Blob([contents], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked on a delay because Safari reads the blob after the click
    // returns; revoking immediately gives an empty file.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return { ok: true, how: "download" };
  } catch {
    return { ok: false, how: "failed" };
  }
}

// Prints whatever is on screen. A print stylesheet strips the app chrome so
// what comes out is the stats, not the tab bar — and iOS's print dialog is
// where "Save as PDF" lives.
export function printCurrentView() {
  window.print();
}

// Last resort for text: show it in a selectable box so it can be copied by
// hand. Only reached when both the share sheet and the clipboard refused.
export function fallbackTextBox(text) {
  const area = document.createElement("textarea");
  area.className = "share-fallback";
  area.value = text;
  area.readOnly = true;
  area.rows = 12;
  return area;
}
