#!/usr/bin/env python3
"""Runs every suite and reports a single pass/fail.

    python3 tests/run_all.py            # everything
    python3 tests/run_all.py season      # just suites matching "season"

Each suite starts its own local server on its own port and drives a real
Chromium, so they can be run individually too — `python3 tests/test_season.py`.
"""

import os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))

# Fast, broad suites first so an obvious break surfaces early. test_offline
# is last because it waits on a service worker install.
ORDER = [
    "test_turnovers.py",
    "test_stage1.py",
    "test_stage2.py",
    "test_stage3.py",
    "test_sorting.py",
    "test_breakdowns.py",
    "test_tags.py",
    "test_stage5.py",
    "test_cleanup.py",
    "test_season.py",
    "test_export.py",
    "test_offline.py",
]


def main():
    pattern = sys.argv[1] if len(sys.argv) > 1 else None
    suites = [s for s in ORDER if os.path.exists(os.path.join(HERE, s))]
    if pattern:
        suites = [s for s in suites if pattern in s]
    if not suites:
        print(f"No suites matching {pattern!r}")
        return 1

    failed = []
    started = time.time()

    for suite in suites:
        print(f"\n{'=' * 60}\n{suite}\n{'=' * 60}")
        proc = subprocess.run([sys.executable, os.path.join(HERE, suite)],
                              capture_output=True, text=True)
        print(proc.stdout.rstrip())
        if proc.returncode != 0 or "ALL PASS" not in proc.stdout:
            failed.append(suite)
            if proc.stderr.strip():
                print(proc.stderr.rstrip())

    elapsed = round(time.time() - started)
    print(f"\n{'=' * 60}")
    if failed:
        print(f"{len(failed)} of {len(suites)} suites FAILED in {elapsed}s:")
        for suite in failed:
            print(f"  - {suite}")
        return 1

    print(f"All {len(suites)} suites passed in {elapsed}s.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
