#!/usr/bin/env python3
"""
Coach report: turns the app's season spreadsheet (Season -> Spreadsheet CSV)
into a printable PDF for the head coach.

    python3 tools/coach_report.py ~/Downloads/paint-touches-season.csv ~/Downloads [png_dir]

Not part of the app — nothing here is served to the iPad. It reads the same
rules the app uses, so its numbers match the Season tab:
- a FOUL is a trip, not a possession: counted, never divided into PPP
- a defensive trip with no mistake recorded counts as clean (isClean, stats.js)
- per-player offense means "possessions this player touched the paint in",
  never who shot or who turned it over

The findings are written from the numbers, but their wording was checked
against one season's data. Re-read them after every rebuild before handing
the report over.

Needs Playwright (pip3), the same as the test suite.
"""

import collections
import csv
import html
import json
import os
import pathlib
import re
import sys
from datetime import date

MIN_SAMPLE = 20   # under this a PPP is greyed out: one made three moves it 0.15+
LIST_FLOOR = 10   # plays and breakdowns under this are folded into one row

# This repo is public — GitHub Pages will not serve a private one on a free
# plan — so the club's own details stay out of it: the team name, and the fixes
# to what was tapped, live in private/report-config.json, which git ignores.
# Corrections belong here rather than on the iPad because every possession
# stores names as they were at the moment of the tap, so renaming a list entry
# in the app never reaches games already played.
CONFIG_PATH = pathlib.Path(__file__).resolve().parent.parent / "private" / "report-config.json"

TEAM = "Your team"   # both are replaced from the config file at run time
CORRECTIONS = []     # (column, tapped as, should be, game date — None = every game)


def load_config():
    """Without the config file the report still builds — it just carries no
    club name and fixes nothing, which is the right default for anyone else
    who finds this script."""
    global TEAM, CORRECTIONS
    if not CONFIG_PATH.exists():
        print(f"no {CONFIG_PATH.name} — building with no team name and no corrections")
        return
    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    TEAM = cfg.get("team", TEAM)
    CORRECTIONS = [(c["column"], c["from"], c["to"], c.get("game_date"))
                   for c in cfg.get("corrections", [])]

esc = html.escape
ORD = {"1": "1st", "2": "2nd", "3": "3rd", "4": "4th", "OT": "overtime"}
QUARTERS = ["1", "2", "3", "4", "OT"]
WORDS = {1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven",
         8: "Eight", 9: "Nine", 10: "Ten", 11: "Eleven", 12: "Twelve"}
OUTCOME = {"2PM": "2 made", "2PA": "2 missed", "3PM": "3 made", "3PA": "3 missed",
           "FT": "free throws", "FOUL": "foul", "TO": "turnover"}


# ---------------------------------------------------------------- the rules

def ends(r):
    return r["outcome"] != "FOUL"


def touched(r):
    return bool(r["paint_touches"].split())


def clean(r):
    return r["mistake"] in ("", "No mistake")


def pts(r):
    return int(r["points"] or 0)


def bucket(rs):
    closed = [r for r in rs if ends(r)]
    n = len(closed)
    p = sum(pts(r) for r in closed)
    c = collections.Counter(r["outcome"] for r in closed)
    return {
        "trips": len(rs), "poss": n, "pts": p, "ppp": p / n if n else None,
        "to": c["TO"], "m3": c["3PM"], "a3": c["3PM"] + c["3PA"],
        "m2": c["2PM"], "a2": c["2PM"] + c["2PA"], "ft": c["FT"],
        "fouls": len(rs) - n,
        "broken": sum(not clean(r) for r in rs),
        "clean": sum(clean(r) for r in rs),
        "ppp_no_to": p / (n - c["TO"]) if n - c["TO"] else None,
    }


def rate(x, y):
    return x / y if y else None


def f2(x):
    return "—" if x is None else f"{x:.2f}"


def pc(x, y=None):
    v = x if y is None else rate(x, y)
    return "—" if v is None else f"{round(v * 100)}%"


def shots(m, a):
    return f"{m}-{a}" if a else "—"


def short_date(iso):
    try:
        d = date.fromisoformat(iso)
    except ValueError:
        return iso
    return f"{d.day} {d.strftime('%b')}"


def to_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------- loading

def load(path):
    with open(os.path.expanduser(path), encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))
    for col, old, new, game_date in CORRECTIONS:
        hits = [r for r in rows if r.get(col) == old and game_date in (None, r["game_date"])]
        for r in hits:
            r[col] = new
        print(f"correction: {col} “{old}” → “{new}” ({game_date or 'all games'}): {len(hits)} rows")
    keys = sorted({(r["game_date"], r["opponent"]) for r in rows})
    per_opp = collections.Counter(k[1] for k in keys)
    nth = collections.Counter()
    games = []
    for d, opp in keys:
        nth[opp] += 1
        first = next(r for r in rows if (r["game_date"], r["opponent"]) == (d, opp))
        games.append({
            "key": (d, opp), "date": d, "opponent": opp,
            "label": opp + (" " + "I" * nth[opp] if per_opp[opp] > 1 else ""),
            "result": first["result"], "us": to_int(first["our_score"]), "them": to_int(first["their_score"]),
        })
    return rows, games


def key(r):
    return (r["game_date"], r["opponent"])


def player_names(rows):
    """Number -> surname, from the columns that carry names. Renamed players
    (e.g. 'Callison' then 'Charles Callison') collapse onto one number."""
    seen = collections.defaultdict(collections.Counter)
    for r in rows:
        for col in ("mistake_player", "tag_player"):
            num, _, name = (r.get(col) or "").partition(" ")
            if num.startswith("#") and num != "#--" and name:
                seen[num][name.split()[-1]] += 1
    return {num: c.most_common(1)[0][0] for num, c in seen.items()}


# ---------------------------------------------------------------- html bits

def tile(value, label, note=""):
    return f'<div class="tile"><div class="v">{value}</div><div class="k">{label}</div><div class="n">{note}</div></div>'


def table(headers, rows):
    head = "".join(f'<th class="{c}">{h}</th>' for h, c in headers)
    body = "".join(
        f'<tr class="{cls}">' + "".join(
            f'<td class="{headers[i][1]}">{cell}</td>' for i, cell in enumerate(cells)
        ) + "</tr>"
        for cells, cls in rows
    )
    return f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"


def kv(label, value):
    return f'<div class="kv"><span>{label}</span><b>{value}</b></div>'


def result_cell(g):
    if g["us"] is None or g["them"] is None:
        return "—"
    cls = {"W": "good", "L": "bad"}.get(g["result"], "")
    return f'<span class="{cls}">{esc(g["result"])}</span> {g["us"]}–{g["them"]}'


def game_cell(g):
    return f'{esc(g["label"])} <span class="dim">{short_date(g["date"])}</span>'


def ppp_cell(b, baseline, lower_is_better=False):
    """Grey when the sample is thin; green/red only when it's big enough to mean something."""
    if b["ppp"] is None:
        return "—"
    text = f2(b["ppp"])
    if b["poss"] < MIN_SAMPLE or baseline is None:
        return text
    diff = b["ppp"] - baseline
    if lower_is_better:
        diff = -diff
    if diff >= 0.15:
        return f'<span class="good">{text}</span>'
    if diff <= -0.15:
        return f'<span class="bad">{text}</span>'
    return text


def thin(b):
    return "thin" if b["poss"] < MIN_SAMPLE else ""


def page(n, total, body):
    return (
        f'<section class="page">{body}'
        f'<footer><span>{TEAM} · internal scouting document · from Paint Touches tracking</span>'
        f'<span>Compiled {short_date(date.today().isoformat())} {date.today().year} · page {n} of {total}</span></footer>'
        f"</section>"
    )


def section(title):
    return f"<h2>{title}</h2>"


# ---------------------------------------------------------------- analysis

def analyse(rows, games):
    poss = [r for r in rows if r["record_type"] == "possession"]
    off = [r for r in poss if r["side"] != "defense"]
    dfn = [r for r in poss if r["side"] == "defense"]
    tags = [r for r in rows if r["record_type"] == "tag"]
    names = player_names(rows)
    A = {
        "rows": rows, "games": games, "G": len(games), "names": names, "tags": tags,
        "off": off, "dfn": dfn,
        "o": bucket(off),
        "t": bucket([r for r in off if touched(r)]),
        "n": bucket([r for r in off if not touched(r)]),
        "d": bucket(dfn),
        "dc": bucket([r for r in dfn if clean(r)]),
        "db": bucket([r for r in dfn if not clean(r)]),
    }

    # Per game, both sides.
    A["per_game"] = []
    for g in games:
        go = [r for r in off if key(r) == g["key"]]
        gd = [r for r in dfn if key(r) == g["key"]]
        A["per_game"].append({
            "g": g,
            "o": bucket(go), "t": bucket([r for r in go if touched(r)]), "n": bucket([r for r in go if not touched(r)]),
            "d": bucket(gd), "dc": bucket([r for r in gd if clean(r)]), "db": bucket([r for r in gd if not clean(r)]),
        })

    # Breakdowns: which, where, who.
    broken = [r for r in dfn if not clean(r)]
    A["broken_rows"] = broken
    A["mistakes"] = sorted(
        ((m, bucket([r for r in broken if r["mistake"] == m])) for m in {r["mistake"] for r in broken}),
        key=lambda x: -x[1]["trips"],
    )
    return A


def surname(A, tagged):
    num, _, name = tagged.partition(" ")
    return A["names"].get(num) or (name.split()[-1] if name else num)


def top_players(A, rs, k=2):
    c = collections.Counter(surname(A, r["mistake_player"]) for r in rs if r["mistake_player"])
    return " · ".join(f"{esc(n)} {v}" for n, v in c.most_common(k))


# ---------------------------------------------------------------- page 1

def aside_turnovers(t, n):
    """What is left of the paint-touch gap with turnovers out of both sides.
    It usually shrinks; in a small slice it can vanish or flip. Same wording
    as asideTurnovers() in js/report.js."""
    tn, nn = t["ppp_no_to"], n["ppp_no_to"]
    if tn is None or nn is None:
        return ""
    pair = f"{f2(tn)} vs {f2(nn)}"
    if tn <= nn:
        return f"With turnovers set aside the gap is gone — {pair}. The difference was the turnovers."
    if tn - nn >= t["ppp"] - n["ppp"]:
        return f"With turnovers set aside the gap holds — {pair}."
    return f"With turnovers set aside the gap shrinks to {pair} — real, but smaller."


def findings(A):
    o, t, n, d, dc, db, G = A["o"], A["t"], A["n"], A["d"], A["dc"], A["db"], A["G"]
    out = []

    gap_games = sum(1 for pg in A["per_game"] if pg["t"]["ppp"] is not None and pg["n"]["ppp"] is not None
                    and pg["t"]["ppp"] > pg["n"]["ppp"])
    share = f"{pc(t['poss'], o['poss'])} of possessions get there."
    if t["ppp"] <= n["ppp"]:
        out.append(f"<b>Reaching the paint did not pay here.</b> {f2(t['ppp'])} with a paint touch, "
                   f"{f2(n['ppp'])} without. {share}")
    else:
        held = "" if G == 1 else f", and the gap held in {gap_games} of {G} games"
        out.append(
            f"<b>Reaching the paint is worth {f2(t['ppp'] - n['ppp'])} points a possession.</b> "
            f"{f2(t['ppp'])} with a paint touch, {f2(n['ppp'])} without{held}. {share}"
        )
    out.append(
        f"<b>Possessions that never reach the paint are lost to turnovers.</b> "
        f"{n['to']} of {o['to']} turnovers came on them ({pc(n['to'], n['poss'])} of those possessions, "
        f"against {pc(t['to'], t['poss'])} after a touch). " + aside_turnovers(t, n)
    )
    t3, n3 = rate(t["m3"], t["a3"]), rate(n["m3"], n["a3"])
    if t3 is not None and n3 is not None and min(t["a3"], n["a3"]) >= MIN_SAMPLE:
        if t3 < n3:
            out.append(
                f"<b>Threes are not better after a touch — yet.</b> {pc(t3)} on {t['a3']} kick-out threes "
                f"against {pc(n3)} on {n['a3']} without a touch. {pc(n['a3'], o['a3'])} of all threes come "
                f"without one."
            )
        else:
            out.append(
                f"<b>Threes are better after a touch.</b> {pc(t3)} on {t['a3']} attempts against {pc(n3)} on "
                f"{n['a3']} without — yet {pc(n['a3'], o['a3'])} of all threes still come without a touch."
            )

    qs = [(q, bucket([r for r in A["off"] if r["quarter"] == q])) for q in QUARTERS[:4]]
    qs = [x for x in qs if x[1]["poss"] >= MIN_SAMPLE]
    # Only name a quarter when it actually stands apart — with one more game the
    # "worst" quarter can end up 0.02 behind the next one, which is no finding.
    ranked = sorted(qs, key=lambda x: x[1]["ppp"])
    if len(ranked) >= 3:
        (wq, wb), (_, nb) = ranked[0], ranked[1]
        (bq, bb), (_, sb) = ranked[-1], ranked[-2]
        if nb["ppp"] - wb["ppp"] >= 0.08:
            out.append(
                f"<b>The {ORD[wq]} quarter is the offensive dip.</b> {f2(wb['ppp'])} PPP against {f2(o['ppp'])} "
                f"for the game, with threes at {shots(wb['m3'], wb['a3'])}."
            )
        elif bb["ppp"] - sb["ppp"] >= 0.15:
            out.append(
                f"<b>The {ORD[bq]} quarter is the offense's best by far:</b> {f2(bb['ppp'])} PPP, threes "
                f"{shots(bb['m3'], bb['a3'])}. The other quarters sit between {f2(wb['ppp'])} and {f2(sb['ppp'])}."
            )

    cost = (db["ppp"] - dc["ppp"]) * db["poss"] / G if db["ppp"] is not None and dc["ppp"] is not None else None
    # Same floor as every other claim, and a gap wide enough to be a sentence.
    if (cost is not None and db["poss"] >= MIN_SAMPLE and dc["poss"] >= MIN_SAMPLE
            and db["ppp"] - dc["ppp"] >= 0.10):
        out.append(
            f"<b>A pick-and-roll breakdown costs {f2(db['ppp'] - dc['ppp'])} points.</b> "
            f"{f2(dc['ppp'])} allowed when the coverage is run right, {f2(db['ppp'])} when it breaks. "
            f"{pc(d['broken'], d['trips'])} of trips break down — about {d['broken'] / G:.0f} a game, "
            f"roughly {cost:.0f} points a game."
        )

    big = [(m, b) for m, b in A["mistakes"] if b["trips"] >= LIST_FLOOR]
    if big:
        common_m, common_b = big[0]
        rs = [r for r in A["broken_rows"] if r["mistake"] == common_m]
        cov, in_cov = collections.Counter(r["coverage"] for r in rs).most_common(1)[0]
        where = "all" if in_cov == len(rs) else pc(in_cov, len(rs))
        text = (f"<b>{esc(common_m)} is the most common breakdown</b> ({common_b['trips']}, {where} in "
                f"{esc(cov)}; {f2(common_b['ppp'])} allowed).")
        costly_m, costly_b = max(big, key=lambda x: x[1]["ppp"] or 0)
        if costly_m != common_m:
            text += (f" <b>{esc(costly_m)} is the most expensive:</b> {f2(costly_b['ppp'])} allowed, "
                     f"threes {shots(costly_b['m3'], costly_b['a3'])}.")
        out.append(text)

    dq = [(q, bucket([r for r in A["dfn"] if r["quarter"] == q])) for q in QUARTERS[:4]]
    dq = [x for x in dq if x[1]["trips"] >= MIN_SAMPLE]
    worst = max(dq, key=lambda x: rate(x[1]["broken"], x[1]["trips"])) if len(dq) >= 2 else None
    best = min(dq, key=lambda x: rate(x[1]["broken"], x[1]["trips"])) if len(dq) >= 2 else None
    if worst and rate(worst[1]["broken"], worst[1]["trips"]) - rate(best[1]["broken"], best[1]["trips"]) >= 0.05:
        out.append(
            f"<b>The defense is sharpest late, loosest early.</b> {pc(worst[1]['broken'], worst[1]['trips'])} of "
            f"trips break down in the {ORD[worst[0]]} quarter, {pc(best[1]['broken'], best[1]['trips'])} in the "
            f"{ORD[best[0]]}."
            if QUARTERS.index(worst[0]) < QUARTERS.index(best[0]) else
            f"<b>Breakdowns peak in the {ORD[worst[0]]} quarter</b> ({pc(worst[1]['broken'], worst[1]['trips'])} "
            f"of trips) and are rarest in the {ORD[best[0]]} ({pc(best[1]['broken'], best[1]['trips'])})."
        )

    covs = [(c, bucket([r for r in A["dfn"] if r["coverage"] == c])) for c in {r["coverage"] for r in A["dfn"]} if c]
    covs = [x for x in covs if x[1]["poss"] >= MIN_SAMPLE]
    if len(covs) >= 2:
        c, b = min(covs, key=lambda x: x[1]["ppp"])
        if b["ppp"] <= d["ppp"] - 0.2:
            rs = [r for r in A["dfn"] if r["coverage"] == c]
            per_game = collections.Counter(key(r) for r in rs)
            gk, in_game = per_game.most_common(1)[0]
            text = f"<b>{esc(c)} has allowed the fewest points</b> — {f2(b['ppp'])} on {b['poss']} possessions."
            if in_game / len(rs) >= 0.5:
                opp = next(g["label"] for g in A["games"] if g["key"] == gk)
                if in_game == len(rs):
                    text += (f" But all {in_game} of its trips came against {esc(opp)}, so it says more about "
                             f"one game plan than about the coverage.")
                elif len(per_game) < G:
                    text += (f" But it has been used in only {len(per_game)} of {G} games, and {in_game} of its "
                             f"{len(rs)} trips came against {esc(opp)} — too few games to call it better yet.")
                else:
                    text += (f" But {in_game} of its {len(rs)} trips came against {esc(opp)} — too few games to "
                             f"call it better yet.")
            else:
                text += " A small sample, and it may be called in easier spots, but worth testing more."
            out.append(text)
    return out


def priorities(A):
    o, n, G = A["o"], A["n"], A["G"]
    out = [
        f"<b>Protect the ball before the paint.</b> About {n['to'] / G:.0f} turnovers a game come on possessions "
        f"that never touch it. The biggest single leak on offense."
    ]
    big = [(m, b) for m, b in A["mistakes"] if b["trips"] >= LIST_FLOOR]
    if big:
        m, b = big[0]
        rs = [r for r in A["broken_rows"] if r["mistake"] == m]
        out.append(f"<b>{esc(m)} defense.</b> {b['trips']} breakdowns in {G} games — {top_players(A, rs)} "
                   f"account for the most. Every one has a clip time in the app.")
        costly_m, costly_b = max(big, key=lambda x: x[1]["ppp"] or 0)
        if costly_m != m:
            rs = [r for r in A["broken_rows"] if r["mistake"] == costly_m]
            out.append(f"<b>{esc(costly_m)}.</b> Fewer of them, but each one costs {f2(costly_b['ppp'])} — "
                       f"the most expensive of the common breakdowns. Most often: {top_players(A, rs)}.")
    plays = collections.defaultdict(list)
    for r in A["off"]:
        if r["play"] and r["play"] != "Transition / No Play":
            plays[r["play"]].append(r)
    weak = [(p, bucket(rs)) for p, rs in plays.items()]
    weak = [x for x in weak if x[1]["poss"] >= MIN_SAMPLE and x[1]["ppp"] <= o["ppp"] - 0.3]
    for p, b in sorted(weak, key=lambda x: x[1]["ppp"]):
        out.append(f"<b>Film check on “{esc(p)}”.</b> {f2(b['ppp'])} PPP and {pc(b['to'], b['poss'])} turnovers "
                   f"on {b['poss']} possessions — worst of the sets run 20+ times.")
    return out


def wins_losses(A):
    def side(res):
        pgs = [pg for pg in A["per_game"] if pg["g"]["result"] == res]
        off = [r for r in A["off"] if r["result"] == res]
        dfn = [r for r in A["dfn"] if r["result"] == res]
        return len(pgs), bucket(off), bucket([r for r in off if touched(r)]), bucket(dfn), \
            bucket([r for r in dfn if not clean(r)])

    wn, wo, wt, wd, wb = side("W")
    ln, lo, lt, ld, lb = side("L")
    if not wn or not ln:
        return ""

    def panel(title, cls, n_, o_, t_, d_, b_):
        return (
            f'<div class="panel {cls}"><h3>{n_} {title}</h3>'
            + kv("Offense PPP", f2(o_["ppp"]))
            + kv("Possessions reaching the paint", pc(t_["poss"], o_["poss"]))
            + kv("Turnover rate", pc(o_["to"], o_["poss"]))
            + kv("PnR PPP allowed", f2(d_["ppp"]))
            + kv("PnR trips that break down", pc(d_["broken"], d_["trips"]))
            + kv("PPP allowed on a breakdown", f2(b_["ppp"]))
            + kv("PnR free-throw trips allowed / game", f"{d_['ft'] / n_:.1f}")
            + "</div>"
        )

    read = []
    if abs(wo["ppp"] - lo["ppp"]) < 0.08:
        read.append(f"The tracked offense is <b>about the same</b> in wins and losses "
                    f"({f2(wo['ppp'])} vs {f2(lo['ppp'])} PPP).")
    else:
        read.append(f"The tracked offense scores {f2(wo['ppp'])} PPP in wins and {f2(lo['ppp'])} in losses.")
    read.append(f"Pick-and-roll defense allows {f2(wd['ppp'])} in wins and {f2(ld['ppp'])} in losses.")
    wr, lr = rate(wd["broken"], wd["trips"]), rate(ld["broken"], ld["trips"])
    if abs(wr - lr) < 0.05:
        read.append(f"Breakdowns happen <b>just as often</b> ({pc(wr)} vs {pc(lr)}); what changes is their "
                    f"cost — {f2(wb['ppp'])} vs {f2(lb['ppp'])} per broken possession.")
    else:
        read.append(f"Breakdowns: {pc(wr)} of trips in wins, {pc(lr)} in losses.")
    # Checked against the box-score report (27.0 vs 16.7 team fouls): a handful
    # of PnR free-throw trips can't be where that gap comes from. Re-check it.
    read.append(f"Pick-and-roll free-throw trips allowed double in losses ({ld['ft']} vs {wd['ft']}) — but that "
                f"is a handful, so most of the box score's foul gap comes from outside the pick-and-roll."
                if ld["ft"] >= 2 * wd["ft"] else "")
    return (
        '<div class="panels">'
        + panel("wins", "green", wn, wo, wt, wd, wb)
        + panel("losses", "red", ln, lo, lt, ld, lb)
        + f'<div class="panel"><h3>The read</h3><p>{" ".join(x for x in read if x)}</p></div>'
        + "</div>"
    )


def page_summary(A, total):
    o, t, n, d, dc, db, G, games = A["o"], A["t"], A["n"], A["d"], A["dc"], A["db"], A["G"], A["games"]
    w = sum(g["result"] == "W" for g in games)
    l_ = sum(g["result"] == "L" for g in games)
    us = sum(g["us"] or 0 for g in games)
    them = sum(g["them"] or 0 for g in games)
    cost = (db["ppp"] - dc["ppp"]) * db["poss"] / G
    f = findings(A)
    half = (len(f) + 1) // 2
    wl = wins_losses(A)
    body = f"""
    <header class="top">
      <div><h1>{TEAM} — Paint Touches &amp; PnR Defense</h1>
        <div class="sub">{WORDS.get(G, G)}-game tracking report · {short_date(games[0]['date'])} – {short_date(games[-1]['date'])} {games[-1]['date'][:4]}</div></div>
      <div><div class="big">{w} – {l_}</div><div class="bigsub">won – lost</div></div>
    </header>
    <div class="tiles">
      {tile(f2(o['ppp']), "Offense PPP", f"{o['poss']} possessions")}
      {tile(f"{f2(t['ppp'])} <small>/ {f2(n['ppp'])}</small>", "PPP with / without paint touch", f"{t['poss']} and {n['poss']} poss")}
      {tile(pc(t['poss'], o['poss']), "Possessions reaching the paint", f"{t['poss']} of {o['poss']}")}
      {tile(f2(d['ppp']), "PnR PPP allowed", f"{d['poss']} pick-and-roll poss")}
      {tile(f"≈{cost:.0f}", "Points a game lost to PnR breakdowns", f"{d['broken']} breakdowns in {G} games")}
    </div>
    {section("Wins vs losses — what the tracking adds") + wl if wl else ""}
    {section(f"What the {WORDS.get(G, G).lower()} games say")}
    <div class="cols2"><ul class="find">{"".join(f"<li>{x}</li>" for x in f[:half])}</ul>
      <ul class="find">{"".join(f"<li>{x}</li>" for x in f[half:])}</ul></div>
    {section("Priorities")}
    <ol class="find prio">{"".join(f"<li>{x}</li>" for x in priorities(A))}</ol>
    <div class="caveats"><b>How to read these numbers.</b>
      PPP = points per possession. These are <b>tracked possessions, not the box score</b>: offense logged {o['pts']} of {us} points ({pc(o['pts'], us)});
      defense tracks <b>pick-and-roll possessions only</b> — {d['pts']} of {them} points allowed — so it cannot explain fouls or scoring outside the pick-and-roll.
      A foul that doesn't end a possession is counted but kept out of PPP ({o['fouls']} on offense, {d['fouls']} on defense).
      Player numbers on offense mean <b>possessions that player touched the paint in</b> — the app does not record who shot or who turned it over.
      <span class="dim">Grey</span> numbers rest on fewer than {MIN_SAMPLE} possessions: too early to tell.
    </div>
    """
    return page(1, total, body)


# ---------------------------------------------------------------- page 2

def page_offense(A, total):
    o, t, n = A["o"], A["t"], A["n"]
    log = table(
        [("Game", ""), ("Result", ""), ("Poss", "num"), ("PPP", "num"), ("Touch", "num"),
         ("PPP touch", "num"), ("PPP no touch", "num"), ("TO rate", "num"), ("Pts logged", "num")],
        [([game_cell(pg["g"]), result_cell(pg["g"]), pg["o"]["poss"], f2(pg["o"]["ppp"]),
           pc(pg["t"]["poss"], pg["o"]["poss"]), f2(pg["t"]["ppp"]), f2(pg["n"]["ppp"]),
           pc(pg["o"]["to"], pg["o"]["poss"]),
           f'{pg["o"]["pts"]} of {pg["g"]["us"]}' if pg["g"]["us"] is not None else pg["o"]["pts"]], "")
         for pg in A["per_game"]]
        + [([f"<b>{A['G']} games</b>", "", f"<b>{o['poss']}</b>", f"<b>{f2(o['ppp'])}</b>",
             f"<b>{pc(t['poss'], o['poss'])}</b>", f"<b>{f2(t['ppp'])}</b>", f"<b>{f2(n['ppp'])}</b>",
             f"<b>{pc(o['to'], o['poss'])}</b>", ""], "total")],
    )

    def split_panel(title, cls, b):
        return (f'<div class="panel {cls}"><h3>{title}</h3>'
                + kv("Possessions", b["poss"]) + kv("PPP", f2(b["ppp"]))
                + kv("Turnover rate", pc(b["to"], b["poss"]))
                + kv("2PT", f"{shots(b['m2'], b['a2'])} · {pc(b['m2'], b['a2'])}")
                + kv("3PT", f"{shots(b['m3'], b['a3'])} · {pc(b['m3'], b['a3'])}")
                + kv("Free-throw trips", f"{b['ft']} · {pc(b['ft'], b['poss'])}")
                + kv("PPP leaving turnovers out", f2(b["ppp_no_to"]))
                + "</div>")

    read = (
        f"Without a touch the offense lives on threes ({n['a3']} of its {n['poss']} possessions end in one) "
        f"and turnovers ({n['to']}). Two-pointers without a touch are rare and poor "
        f"({shots(n['m2'], n['a2'])}). <b>Part of the gap is built in:</b> a possession lost in the backcourt "
        f"never had the chance to reach the paint — so the lesson is as much “don't lose it on the way” as "
        f"“get there more.”"
    )

    plays = collections.defaultdict(list)
    for r in A["off"]:
        plays[r["play"] or "Transition / No Play"].append(r)
    listed = sorted(((p, bucket(rs), rs) for p, rs in plays.items()), key=lambda x: -x[1]["poss"])
    shown = [x for x in listed if x[1]["poss"] >= LIST_FLOOR]
    folded = [x for x in listed if x[1]["poss"] < LIST_FLOOR]
    play_rows = [([esc(p), b["poss"], ppp_cell(b, o["ppp"]), pc(sum(touched(r) for r in rs if ends(r)), b["poss"]),
                   pc(b["to"], b["poss"]), shots(b["m3"], b["a3"])], thin(b)) for p, b, rs in shown]
    if folded:
        rs = [r for _, _, x in folded for r in x]
        b = bucket(rs)
        play_rows.append(([f"{len(folded)} other plays, under {LIST_FLOOR} each", b["poss"], f2(b["ppp"]),
                           pc(sum(touched(r) for r in rs if ends(r)), b["poss"]), pc(b["to"], b["poss"]),
                           shots(b["m3"], b["a3"])], "thin"))
    plays_t = table([("Play", ""), ("Poss", "num"), ("PPP", "num"), ("Touch", "num"), ("TO", "num"), ("3PT", "num")],
                    play_rows)

    q_rows = []
    for q in QUARTERS:
        rs = [r for r in A["off"] if r["quarter"] == q]
        if not rs:
            continue
        b = bucket(rs)
        q_rows.append(([ORD[q], b["poss"], ppp_cell(b, o["ppp"]), pc(sum(touched(r) for r in rs if ends(r)), b["poss"]),
                        pc(b["to"], b["poss"]), shots(b["m3"], b["a3"])], thin(b)))
    q_t = table([("Quarter", ""), ("Poss", "num"), ("PPP", "num"), ("Touch", "num"), ("TO", "num"), ("3PT", "num")], q_rows)

    by_player = collections.defaultdict(list)
    for r in A["off"]:
        if ends(r):
            for num in set(r["paint_touches"].split()):
                if num != "#--":
                    by_player[num].append(r)
    p_rows = []
    for num, rs in sorted(by_player.items(), key=lambda kv_: -len(kv_[1])):
        b = bucket(rs)
        p_rows.append(([f'{num} {esc(A["names"].get(num, ""))}', b["poss"], pc(b["poss"], t["poss"]),
                        ppp_cell(b, t["ppp"]), pc(b["to"], b["poss"])], thin(b)))
    p_t = table([("Player", ""), ("Poss touched", "num"), ("Share", "num"), ("PPP", "num"), ("TO", "num")], p_rows)

    body = f"""
    <header class="top slim"><div><h1>Offense — paint touches</h1>
      <div class="sub">{o['poss']} possessions · {o['pts']} points · {o['fouls']} non-shooting fouls drawn (not in PPP)</div></div></header>
    {section("Game log")}
    {log}
    {section("With a paint touch vs without")}
    <div class="panels">{split_panel("With a paint touch", "green", t)}{split_panel("Without", "red", n)}
      <div class="panel"><h3>The read</h3><p>{read}</p></div></div>
    <div class="cols2">
      <div>{section("By play")}{plays_t}
        <div class="note">Green/red = at least 0.15 above/below the team's {f2(o['ppp'])}, on {MIN_SAMPLE}+ possessions. “Off Reb” is logged as its own trip.</div></div>
      <div>{section("By quarter")}{q_t}
        {section("Who gets us to the paint")}{p_t}
        <div class="note">Possessions this player touched the paint in, and what those possessions produced — <b>not</b> the player's own shots or turnovers. Share = of all {t['poss']} touch possessions.</div></div>
    </div>
    """
    return page(2, total, body)


# ---------------------------------------------------------------- page 3

def page_defense(A, total):
    d, dc, db, G = A["d"], A["dc"], A["db"], A["G"]
    log = table(
        [("Game", ""), ("Result", ""), ("PnR trips", "num"), ("PPP allowed", "num"), ("Clean", "num"),
         ("PPP clean", "num"), ("PPP broken", "num"), ("Forced TO", "num"), ("FT trips", "num")],
        [([game_cell(pg["g"]), result_cell(pg["g"]), pg["d"]["trips"], f2(pg["d"]["ppp"]),
           pc(pg["d"]["clean"], pg["d"]["trips"]), f2(pg["dc"]["ppp"]), f2(pg["db"]["ppp"]),
           pc(pg["d"]["to"], pg["d"]["poss"]), pg["d"]["ft"]], "")
         for pg in A["per_game"]]
        + [([f"<b>{G} games</b>", "", f"<b>{d['trips']}</b>", f"<b>{f2(d['ppp'])}</b>",
             f"<b>{pc(d['clean'], d['trips'])}</b>", f"<b>{f2(dc['ppp'])}</b>", f"<b>{f2(db['ppp'])}</b>",
             f"<b>{pc(d['to'], d['poss'])}</b>", f"<b>{d['ft']}</b>"], "total")],
    )

    cov_rows = []
    covs = collections.defaultdict(list)
    for r in A["dfn"]:
        covs[r["coverage"] or "Unrecorded"].append(r)
    for c, rs in sorted(covs.items(), key=lambda x: -len(x[1])):
        b, bc, bb = bucket(rs), bucket([r for r in rs if clean(r)]), bucket([r for r in rs if not clean(r)])
        cov_rows.append(([f"<b>{esc(c)}</b>", f"<b>{b['trips']}</b>", f"<b>{ppp_cell(b, d['ppp'], True)}</b>",
                          f"clean {pc(b['clean'], b['trips'])}", f"{f2(bc['ppp'])} / {f2(bb['ppp'])}",
                          shots(b["m3"], b["a3"])], "group " + thin(b)))
        ms = collections.defaultdict(list)
        for r in rs:
            if not clean(r):
                ms[r["mistake"]].append(r)
        for m, mrs in sorted(ms.items(), key=lambda x: -len(x[1])):
            mb = bucket(mrs)
            cov_rows.append(([f'<span class="indent">{esc(m)}</span>', mb["trips"], ppp_cell(mb, dc["ppp"], True),
                              f"{pc(mb['trips'], b['trips'])} of trips", top_players(A, mrs, 3),
                              shots(mb["m3"], mb["a3"])], thin(mb)))
    cov_t = table([("Coverage / breakdown", ""), ("Trips", "num"), ("PPP allowed", "num"), ("", "num"),
                   ("Clean / broken PPP · who", ""), ("3PT allowed", "num")], cov_rows)

    pl = collections.defaultdict(list)
    for r in A["broken_rows"]:
        if r["mistake_player"]:
            pl[r["mistake_player"].split()[0]].append(r)
    unassigned = sum(1 for r in A["broken_rows"] if not r["mistake_player"])
    p_rows = []
    for num, rs in sorted(pl.items(), key=lambda x: -len(x[1])):
        c = collections.Counter(r["mistake"] for r in rs)
        p_rows.append(([f'<span class="nw">{num} {esc(A["names"].get(num, ""))}</span>', len(rs),
                        " · ".join(f'<span class="nw">{esc(m)} {v}</span>' for m, v in c.most_common(2)),
                        len({key(r) for r in rs})], ""))
    p_t = table([("Player", ""), ("Breakdowns", "num"), ("Which", ""), ("Games", "num")], p_rows)

    q_rows = []
    for q in QUARTERS:
        rs = [r for r in A["dfn"] if r["quarter"] == q]
        if rs:
            b = bucket(rs)
            q_rows.append(([ORD[q], b["trips"], ppp_cell(b, d["ppp"], True), pc(b["broken"], b["trips"])], thin(b)))
    q_t = table([("Quarter", ""), ("Trips", "num"), ("PPP allowed", "num"), ("Broken", "num")], q_rows)

    tag_html = ""
    if A["tags"]:
        tc = collections.defaultdict(list)
        for r in A["tags"]:
            tc[r["tag"]].append(r)
        first = short_date(min(r["game_date"] for r in A["tags"]))
        t_rows = []
        for tg, rs in sorted(tc.items(), key=lambda x: -len(x[1])):
            c = collections.Counter(surname(A, r["tag_player"]) for r in rs)
            t_rows.append(([esc(tg), len(rs), " · ".join(f"{esc(n)} {v}" for n, v in c.most_common(4))], ""))
        tag_html = (section("Quick tags") + table([("Tag", ""), ("Times", "num"), ("Most often", "")], t_rows)
                    + f'<div class="note">Observations, not possessions — no PPP. Tracked since {first}.</div>')

    body = f"""
    <header class="top slim"><div><h1>Defense — pick-and-roll</h1>
      <div class="sub">{d['trips']} pick-and-roll trips · {d['pts']} points allowed · {d['broken']} breakdowns ({pc(d['broken'], d['trips'])}) · only pick-and-roll possessions are tracked</div></div></header>
    {section("Game log")}
    {log}
    {section("Coverages and their breakdowns")}
    {cov_t}
    <div class="note">Clean / broken PPP = points allowed when that coverage was run right vs when it broke down. Breakdown rows: green/red against the {f2(dc['ppp'])} a clean possession allows.</div>
    <div class="cols2 wide-left">
      <div>{section("Breakdowns by player")}{p_t}
        <div class="note">Counts, not rates: more minutes means more chances. {unassigned} breakdown{'s' if unassigned != 1 else ''} had no player tagged. Every one has a video clip time in the app's defense stats.</div></div>
      <div>{section("By quarter")}{q_t}{tag_html}</div>
    </div>
    """
    return page(3, total, body)


# ---------------------------------------------------------------- page 4

def page_last_game(A, total):
    games = A["games"]
    last = games[-1]
    prev_keys = {g["key"] for g in games[:-1]}
    lo = [r for r in A["off"] if key(r) == last["key"]]
    ld = [r for r in A["dfn"] if key(r) == last["key"]]
    po = [r for r in A["off"] if key(r) in prev_keys]
    pd = [r for r in A["dfn"] if key(r) in prev_keys]

    def metrics(o_rows, d_rows):
        o, d = bucket(o_rows), bucket(d_rows)
        return {
            "Offense PPP": (o["ppp"], "ppp", 1),
            "Possessions reaching the paint": (rate(bucket([r for r in o_rows if touched(r)])["poss"], o["poss"]), "rate", 1),
            "PPP with a paint touch": (bucket([r for r in o_rows if touched(r)])["ppp"], "ppp", 1),
            "PPP without": (bucket([r for r in o_rows if not touched(r)])["ppp"], "ppp", 1),
            "Turnover rate": (rate(o["to"], o["poss"]), "rate", -1),
            "PnR PPP allowed": (d["ppp"], "ppp", -1),
            "PnR trips run clean": (rate(d["clean"], d["trips"]), "rate", 1),
            "PPP allowed on a breakdown": (bucket([r for r in d_rows if not clean(r)])["ppp"], "ppp", -1),
        }

    before, now = metrics(po, pd), metrics(lo, ld)
    rows = []
    for name, (b_val, kind, better) in before.items():
        n_val = now[name][0]
        fmt = f2 if kind == "ppp" else pc
        if b_val is None or n_val is None:
            change = "—"
        else:
            diff = n_val - b_val
            shown = f"{diff:+.2f}" if kind == "ppp" else f"{round(diff * 100):+d} pts"
            big = abs(diff) >= (0.10 if kind == "ppp" else 0.05)
            cls = ("good" if diff * better > 0 else "bad") if big else ""
            change = f'<span class="{cls}">{shown}</span>'
        rows.append(([name, fmt(b_val), f"<b>{fmt(n_val)}</b>", change], ""))
    cmp_t = table([("", ""), (f"Previous {len(games) - 1} game{'s' if len(games) != 2 else ''}", "num"), (esc(last["label"]), "num"), ("Change", "num")], rows)

    br = [r for r in ld if not clean(r)]
    br_rows = [([ORD.get(r["quarter"], r["quarter"]), r["clock_time"], esc(r["coverage"]), esc(r["mistake"]),
                 esc(surname(A, r["mistake_player"])) if r["mistake_player"] else '<span class="dim">no player</span>',
                 f'<span class="nw">{OUTCOME.get(r["outcome"], r["outcome"])} · {r["points"]}</span>'], "") for r in br]
    br_t = table([("Q", ""), ("Tapped", ""), ("Coverage", ""), ("Breakdown", ""), ("Player", ""), ("Result", "")], br_rows)

    tos = [r for r in lo if r["outcome"] == "TO"]
    to_rows = [([ORD.get(r["quarter"], r["quarter"]), r["clock_time"], esc(r["play"] or "Transition / No Play"),
                 "yes" if touched(r) else '<span class="bad">no</span>'], "") for r in tos]
    to_t = table([("Q", ""), ("Tapped", ""), ("Play", ""), ("Touch", "")], to_rows)

    lb = bucket(lo)
    body = f"""
    <header class="top slim"><div><h1>Last game — {esc(last['label'])}</h1>
      <div class="sub">{short_date(last['date'])} · {result_cell(last)} · {lb['poss']} offensive possessions · {len(ld)} pick-and-roll trips</div></div></header>
    {section("Against the season so far")}
    {cmp_t}
    <div class="note">One game is a small sample — about {lb['poss']} possessions on offense and {len(ld)} pick-and-roll trips. Coloured changes are at least 0.10 PPP or 5 percentage points; read them as “worth a look,” not as a trend.</div>
    <div class="cols2">
      <div>{section(f"Breakdowns to find on video ({len(br)})")}{br_t}</div>
      <div>{section(f"Turnovers ({len(tos)})")}{to_t}</div>
    </div>
    <div class="note">“Tapped” is the iPad clock when the possession was logged. If the game was logged from video, go by quarter and order instead.</div>
    """
    return page(4, total, body)


# ---------------------------------------------------------------- document

CSS = """
@page { size: A4; margin: 12mm 13mm; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #fff; }
body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #1b1f24; font-size: 8.6pt; line-height: 1.33; }
.page { width: 184mm; height: 272mm; position: relative; overflow: hidden; padding-bottom: 9mm; page-break-after: always; break-after: page; }
.page:last-child { page-break-after: auto; break-after: auto; }
header.top { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2.5px solid #1b1f24; padding-bottom: 2.5mm; margin-bottom: 3.5mm; gap: 4mm; }
header.slim { margin-bottom: 1mm; }
h1 { font-size: 17pt; margin: 0; line-height: 1.15; }
.sub { color: #5b6570; font-size: 9pt; margin-top: 1mm; }
.big { font-size: 22pt; font-weight: 700; text-align: right; white-space: nowrap; }
.bigsub { white-space: nowrap; font-size: 6.5pt; letter-spacing: .1em; color: #5b6570; text-align: right; text-transform: uppercase; }
.tiles { display: grid; grid-template-columns: repeat(5, 1fr); gap: 2.2mm; margin-bottom: 1mm; }
.tile { border: 1px solid #d5dbe2; border-top: 3px solid #1d4f91; padding: 2mm 2.4mm; }
.tile .v { font-size: 15pt; font-weight: 700; line-height: 1.1; }
.tile .v small { font-size: 10pt; color: #5b6570; }
.tile .k { font-size: 6.3pt; letter-spacing: .09em; text-transform: uppercase; color: #5b6570; margin-top: .8mm; }
.tile .n { font-size: 6.8pt; color: #7a848e; }
h2 { color: #1d4f91; font-size: 9.6pt; letter-spacing: .12em; text-transform: uppercase; border-bottom: 1px solid #1d4f91; padding-bottom: 1mm; margin: 3.6mm 0 1.8mm; }
table { width: 100%; border-collapse: collapse; font-size: 7.9pt; }
th { text-align: left; font-size: 6.3pt; letter-spacing: .08em; text-transform: uppercase; color: #5b6570; font-weight: 600; border-bottom: 1px solid #c9d0d8; padding: .8mm 1mm; }
td { padding: .5mm 1mm; border-bottom: 1px solid #eceff2; vertical-align: top; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
tr.thin td { color: #9aa3ac; }
tr.thin td .good, tr.thin td .bad { color: inherit; font-weight: inherit; }
tr.total td { border-top: 1px solid #c9d0d8; }
tr.group td { background: #f4f6f9; }
.indent { padding-left: 3mm; }
.good { color: #1e7b3c; font-weight: 700; }
.bad { color: #c0392b; font-weight: 700; }
.dim { color: #8a939c; }
.nw { white-space: nowrap; }
.panels { display: grid; grid-template-columns: 1fr 1fr 1.3fr; gap: 2.6mm; }
.panel { border: 1px solid #d5dbe2; border-left: 3px solid #1d4f91; padding: 1.8mm 2.6mm; }
.panel.green { border-left-color: #1e7b3c; }
.panel.red { border-left-color: #c0392b; }
.panel h3 { font-size: 6.5pt; letter-spacing: .12em; text-transform: uppercase; color: #5b6570; margin: 0 0 1.2mm; }
.panel p { margin: 0; }
.kv { display: flex; justify-content: space-between; gap: 2mm; padding: .25mm 0; }
.cols2 { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; }
.cols2.wide-left { grid-template-columns: 1.3fr 1fr; }
ul.find, ol.find { margin: 0; padding-left: 4mm; }
.find li { margin-bottom: 1.3mm; }
ol.prio { columns: 2; column-gap: 5mm; padding-left: 5mm; }
ol.prio li { break-inside: avoid; }
.caveats { margin-top: 3mm; border-top: 1px solid #d5dbe2; padding-top: 2mm; font-size: 7.2pt; color: #4d565f; }
.note { font-size: 6.9pt; color: #6b747d; margin-top: 1.2mm; }
footer { position: absolute; bottom: 0; left: 0; right: 0; border-top: 1px solid #d5dbe2; padding-top: 1.3mm; font-size: 6.6pt; color: #7a848e; display: flex; justify-content: space-between; }
"""


def build_html(A):
    total = 4
    pages = [page_summary(A, total), page_offense(A, total), page_defense(A, total), page_last_game(A, total)]
    return f'<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body>{"".join(pages)}</body></html>'


def render(doc, pdf_path, png_dir=None):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch()
        pg = browser.new_page(viewport={"width": 760, "height": 1100}, device_scale_factor=1.6)
        pg.set_content(doc, wait_until="load")
        # A page whose content is taller than the sheet would be silently cut off.
        overflow = pg.evaluate(
            "() => [...document.querySelectorAll('.page')].map(el => el.scrollHeight - el.clientHeight)"
        )
        if png_dir:
            png_dir.mkdir(parents=True, exist_ok=True)
            for i, el in enumerate(pg.query_selector_all(".page"), 1):
                el.screenshot(path=str(png_dir / f"page{i}.png"))
        pg.emulate_media(media="print")
        pg.pdf(path=str(pdf_path), prefer_css_page_size=True, print_background=True)
        browser.close()
    return overflow


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "~/Downloads/paint-touches-season.csv"
    out_dir = pathlib.Path(os.path.expanduser(sys.argv[2] if len(sys.argv) > 2 else "."))
    png_dir = pathlib.Path(os.path.expanduser(sys.argv[3])) if len(sys.argv) > 3 else None
    load_config()
    rows, games = load(src)
    A = analyse(rows, games)
    slug = re.sub(r"[^a-z0-9]+", "_", TEAM.lower()).strip("_") or "team"
    pdf = out_dir / f"{slug}_paint_touch_report_{A['G']}_games.pdf"
    overflow = render(build_html(A), pdf, png_dir)
    print(f"wrote {pdf}")
    for i, px in enumerate(overflow, 1):
        print(f"page {i}: " + ("fits" if px <= 0 else f"OVERFLOWS by {px}px — content is cut off"))


if __name__ == "__main__":
    main()
