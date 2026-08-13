import subprocess, time, urllib.request
from playwright.sync_api import sync_playwright

import os, sys, tempfile

# Repo root is the parent of tests/, so these run from anywhere.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Screenshots and scratch files go to a temp dir, never into the repo.
OUT = os.path.join(tempfile.gettempdir(), "paint-touches-tests") + os.sep
os.makedirs(OUT, exist_ok=True)


PORT = 8785
results = []

def check(label, got, want):
    ok = got == want
    results.append(ok)
    print(("PASS  " if ok else "FAIL  ") + f"{label}: got {got!r}, want {want!r}")

srv = subprocess.Popen(["python3","-m","http.server",str(PORT)], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(40):
    try: urllib.request.urlopen(f"http://localhost:{PORT}/index.html", timeout=1); break
    except Exception: time.sleep(0.25)

with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width":1024,"height":768})
    page = ctx.new_page()
    errs = []
    page.on("console", lambda m: errs.append(m.text) if m.type=="error" else None)

    page.goto(f"http://localhost:{PORT}/index.html", wait_until="networkidle")
    page.wait_for_timeout(2500)  # let the service worker install and precache
    check("service worker controlling", page.evaluate("!!navigator.serviceWorker.controller"), True)

    # Sever the network for real.
    ctx.set_offline(True)
    page.reload(wait_until="load")
    page.wait_for_timeout(1200)
    check("app still boots offline", page.evaluate("!!document.querySelector('.tab-bar')"), True)

    # Add a player, start a game, log an offensive AND a defensive possession
    # entirely without a connection.
    page.click('.tab-bar button[data-view="roster"]')
    page.click('.list-toolbar button'); page.fill('.entity-form [name="number"]', "9")
    page.fill('.entity-form [name="name"]', "Offline Guy")
    page.click('.entity-form button[type="submit"]'); page.wait_for_timeout(400)
    check("roster works offline", "Offline Guy" in page.text_content(".entity-list"), True)

    page.click('.tab-bar button[data-view="playbook"]'); page.wait_for_timeout(300)
    page.click('.segmented__btn:has-text("Coverages")'); page.wait_for_timeout(400)
    check("coverages load offline", "Drop" in page.text_content(".entity-list"), True)

    page.click('.tab-bar button[data-view="game"]'); page.wait_for_timeout(300)
    page.fill('[name="opponent"]', "Offline HS")
    page.click('button:has-text("Start Game")'); page.wait_for_timeout(600)
    page.click('.side-toggle .segmented__btn[data-side=defense]'); page.wait_for_timeout(400)
    page.click('.chip:has-text("Drop")'); page.wait_for_timeout(200)
    page.click('.chip:has-text("No mistake")'); page.wait_for_timeout(200)
    page.click('.outcome-row button:has-text("2PT Missed")'); page.wait_for_timeout(500)
    check("defensive possession logged offline", page.text_content(".pill"), "0 offense · 1 defense")

    # The two new modules are the real risk — they're only reachable via the
    # stats screen, and only work offline if they were precached.
    page.click('button:has-text("Stats")'); page.wait_for_timeout(600)
    page.click('.stats-toggle .segmented__btn[data-stats-side=defense]'); page.wait_for_timeout(600)
    check("defense stats panel loads offline",
          "PPP ALLOWED" in page.text_content(".stats-panel").upper(), True)

    real = [e for e in errs if "ERR_INTERNET_DISCONNECTED" not in e and "Failed to load resource" not in e]
    check("no unexpected console errors offline", real, [])
    b.close()
srv.terminate()
print("\n" + ("ALL PASS" if all(results) else f"{results.count(False)} FAILED"))
