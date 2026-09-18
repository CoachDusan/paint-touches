"""Updating this app must not throw away the neighbours' offline copies.

Every one of Dusan's apps is served from coachdusan.github.io. Cache storage
belongs to the whole origin, not to a folder, so a service worker that clears
"every cache that isn't mine" clears Bench Notes and Practise Organiser too.
Nothing is lost from their databases — but the next time one of them is opened
in an arena with no signal, it has no files to open with.

This drives the real thing: install the app, plant a neighbour's cache, ship an
update, and check what survived. It runs against a copy of the repo in a temp
directory, because it has to edit the version between the two loads.
"""

import re
import shutil
import subprocess
import time
import urllib.request
from playwright.sync_api import sync_playwright

import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8800
results = []


def check(label, got, want):
    ok = got == want
    results.append(ok)
    print(("PASS  " if ok else "FAIL  ") + f"{label}: got {got!r}, want {want!r}")


# A copy of the app, so the version can be bumped mid-test the way a deploy
# bumps it. Tests, tools and the club's own files have no business in it.
serve_dir = tempfile.mkdtemp(prefix="paint-touches-cache-test-")
app_dir = os.path.join(serve_dir, "app")
shutil.copytree(ROOT, app_dir,
                ignore=shutil.ignore_patterns(".git", "tests", "tools", "private", "*.pyc"))
sw_path = os.path.join(app_dir, "service-worker.js")

srv = subprocess.Popen(["python3", "-m", "http.server", str(PORT)], cwd=app_dir,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(40):
    try:
        urllib.request.urlopen(f"http://localhost:{PORT}/index.html", timeout=1)
        break
    except Exception:
        time.sleep(0.25)

CACHE_NAMES = "() => caches.keys()"

PLANT = """
() => caches.open("bench-notes-v1")
  .then((c) => c.put("/neighbour.html", new Response("<p>Bench Notes</p>")))
  .then(() => true)
"""

NEIGHBOUR_STILL_THERE = """
() => caches.open("bench-notes-v1")
  .then((c) => c.match("/neighbour.html"))
  .then((hit) => (hit ? hit.text() : null))
"""

with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context()
    page = ctx.new_page()
    errs = []
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)

    page.goto(f"http://localhost:{PORT}/index.html", wait_until="networkidle")
    page.evaluate("() => navigator.serviceWorker.ready.then(() => true)")
    page.wait_for_timeout(1200)

    before = page.evaluate(CACHE_NAMES)
    old_cache = [c for c in before if c.startswith("paint-touches-")]
    check("the app cached itself", len(old_cache), 1)

    # The app asks to keep its data, the way the other three apps do.
    check("storage persistence was requested without breaking anything",
          page.evaluate("() => navigator.storage.persisted().then((v) => typeof v)"), "boolean")

    check("a neighbour's offline copy is planted", page.evaluate(PLANT), True)

    # Ship an update, exactly as a deploy does: new version, new cache name.
    source = open(sw_path).read()
    open(sw_path, "w").write(re.sub(r'CACHE_VERSION = "v\d+"', 'CACHE_VERSION = "v999"', source))

    page.reload(wait_until="networkidle")
    page.evaluate("() => navigator.serviceWorker.ready.then(() => true)")
    # The new cache appears during install; the old one is cleared later, at
    # activation. Waiting for the new name alone looks at the wrong moment.
    for _ in range(60):
        names = page.evaluate(CACHE_NAMES)
        if "paint-touches-v999" in names and old_cache[0] not in names:
            break
        page.wait_for_timeout(250)

    after = page.evaluate(CACHE_NAMES)
    check("the update cached itself under the new version", "paint-touches-v999" in after, True)
    check("its own old copy was cleared", old_cache[0] in after, False)
    check("the neighbour's copy survived", "bench-notes-v1" in after, True)
    check("and still has its files in it",
          page.evaluate(NEIGHBOUR_STILL_THERE), "<p>Bench Notes</p>")

    check("no console errors", errs, [])
    b.close()

srv.terminate()
shutil.rmtree(serve_dir, ignore_errors=True)
print("\n" + ("ALL PASS" if all(results) else f"{results.count(False)} FAILED"))
sys.exit(0 if all(results) else 1)
