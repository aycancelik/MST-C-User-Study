"""Inspect pilot submissions sitting in Firebase, as a table -- no console digging.

Firebase stores each uploaded file as its own node under /submissions: {participant_id,
study, filename, data}, where `data` is the *entire* file's content as one opaque string
(CSV text, or a JSON blob for the .json file). That's fine for the app, painful to read by
hand in the console. This script pulls everything, parses each participant's *_participant.csv
(one flat row per participant: env_*, bg_*, post_*, sum_* columns) into a table, and prints
whichever columns you ask for.

Usage (from mstc_pilot_ui/):
  python scripts/check_firebase.py                                 # overview table
  python scripts/check_firebase.py --list-columns                  # see every available column name
  python scripts/check_firebase.py --columns post_strategy,post_comments   # auto-switches to --long
  python scripts/check_firebase.py --columns post_strategy --participant P-5MVBTD
  python scripts/check_firebase.py --trials --columns kind,chosen_method,rt_ms --participant P-5MVBTD
  python scripts/check_firebase.py --study pilot_study --csv-out /tmp/participants.csv
  python scripts/check_firebase.py --raw-json --participant P-5MVBTD   # the full .json, pretty-printed

A wide grid is unreadable once a freetext column (post_strategy, post_comments, ...) is in the
mix, so those auto-switch to --long: one wrapped "field: value" block per participant instead of
a grid row. Force one or the other with --long / --table.

Read-only: this never writes to Firebase.
"""
from __future__ import annotations

import argparse
import io
import json
import re
import shutil
import textwrap
import urllib.request
from pathlib import Path

import pandas as pd

LONG_TEXT_COLUMNS = {"post_strategy", "post_comments"}

CONFIG_JS = Path(__file__).resolve().parents[1] / "config.js"


def default_url() -> str:
    """Pull the Firebase URL straight out of config.js, so this stays in sync automatically
    (e.g. when it's repointed at a different project for the main study)."""
    text = CONFIG_JS.read_text()
    m = re.search(r'url:\s*"([^"]+)"', text)
    if not m:
        raise SystemExit(f"Couldn't find upload.url in {CONFIG_JS}; pass --url explicitly.")
    return m.group(1)


def fetch_submissions(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=30) as r:
        data = json.loads(r.read().decode("utf-8"))
    return data or {}


def load_tables(entries: dict) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """Split the raw Firebase entries into (participants_df, trials_df, json_by_participant)."""
    participant_rows, trial_rows, jsons = [], [], {}
    for push_id, e in entries.items():
        name = e.get("filename", "")
        pid = e.get("participant_id")
        try:
            if name.endswith("_participant.csv"):
                row = pd.read_csv(io.StringIO(e["data"])).iloc[0].to_dict()
                row["_push_id"], row["_study"] = push_id, e.get("study")
                participant_rows.append(row)
            elif name.endswith("_trials.csv"):
                df = pd.read_csv(io.StringIO(e["data"]))
                df["participant_id"], df["_push_id"] = pid, push_id
                trial_rows.append(df)
            elif name.endswith(".json"):
                jsons[pid] = json.loads(e["data"])
        except Exception as err:
            print(f"  (skipped {name}: {err})")
    participants = pd.DataFrame(participant_rows)
    trials = pd.concat(trial_rows, ignore_index=True) if trial_rows else pd.DataFrame()
    return participants, trials, jsons


def select_columns(df: pd.DataFrame, wanted: list[str] | None) -> pd.DataFrame:
    if not wanted:
        return df
    missing = [c for c in wanted if c not in df.columns]
    if missing:
        close = {c: [col for col in df.columns if c in col] for c in missing}
        hint = "; ".join(f"{c} -> did you mean {v}?" for c, v in close.items() if v)
        raise SystemExit(f"Unknown column(s): {missing}. {hint}\nUse --list-columns to see what's available.")
    return df[wanted]


def print_long(df: pd.DataFrame, id_col: str = "participant_id") -> None:
    """One block per row: wrapped 'field: value' lines, instead of an unreadable wide grid."""
    width = min(shutil.get_terminal_size(fallback=(100, 24)).columns, 100)
    label_width = max((len(c) for c in df.columns), default=10) + 2
    for _, row in df.iterrows():
        header = str(row.get(id_col, "")) if id_col in df.columns else ""
        print(f"=== {header} ===" if header else "===")
        for col in df.columns:
            if col == id_col:
                continue
            val = row[col]
            val = "" if pd.isna(val) else str(val)
            wrapped = textwrap.fill(val, width=width - label_width, subsequent_indent=" " * label_width) or "(empty)"
            print(f"{col + ':':<{label_width}}{wrapped}")
        print()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default=None, help="Firebase submissions.json URL (default: read from config.js)")
    ap.add_argument("--trials", action="store_true", help="show the per-trial table instead of per-participant")
    ap.add_argument("--columns", default=None, help="comma-separated column names to show (default: a short overview)")
    ap.add_argument("--list-columns", action="store_true", help="print every available column name and exit")
    ap.add_argument("--participant", default=None, help="only this participant_id")
    ap.add_argument("--study", default=None, help="only rows with this study tag (e.g. pilot_study)")
    ap.add_argument("--csv-out", type=Path, default=None, help="write the result to this CSV instead of printing")
    ap.add_argument("--raw-json", action="store_true", help="dump the full .json for --participant, pretty-printed")
    ap.add_argument("--max-width", type=int, default=40, help="truncate each cell to this many characters in --table mode (0 = no truncation)")
    fmt = ap.add_mutually_exclusive_group()
    fmt.add_argument("--long", action="store_true", help="one wrapped field: value block per row (auto-on for freetext columns)")
    fmt.add_argument("--table", action="store_true", help="force the wide grid even for freetext columns")
    args = ap.parse_args()

    url = args.url or default_url()
    entries = fetch_submissions(url)
    if not entries:
        print(f"No submissions found at {url}")
        return
    participants, trials, jsons = load_tables(entries)

    if args.raw_json:
        if not args.participant:
            raise SystemExit("--raw-json needs --participant <id>")
        if args.participant not in jsons:
            raise SystemExit(f"No .json entry for participant {args.participant}. Have: {sorted(jsons)}")
        print(json.dumps(jsons[args.participant], indent=2))
        return

    df = trials if args.trials else participants
    if df.empty:
        print("Nothing to show (no matching _trials.csv / _participant.csv entries yet).")
        return

    if args.participant:
        df = df[df["participant_id"] == args.participant]
    if args.study:
        study_col = "_study" if "_study" in df.columns else "study"
        df = df[df.get(study_col) == args.study]

    if args.list_columns:
        for c in df.columns:
            print(c)
        return

    wanted = args.columns.split(",") if args.columns else None
    if wanted is None and not args.trials:
        # a sane default overview, not every bg_/env_/sum_ column
        default_cols = ["participant_id", "_study", "mode", "started", "finished",
                         "sum_valid", "sum_attention_passed", "sum_attention_total",
                         "sum_check1_attempts", "sum_check1_passed", "post_strategy"]
        wanted = [c for c in default_cols if c in df.columns]

    use_long = args.long or (not args.table and wanted is not None and any(c in LONG_TEXT_COLUMNS for c in wanted))
    id_col = "participant_id" if "participant_id" in df.columns else None
    if use_long and id_col and wanted and id_col not in wanted:
        wanted = [id_col] + wanted
    out = select_columns(df, wanted)

    if args.csv_out:
        out.to_csv(args.csv_out, index=False)
        print(f"Wrote {len(out)} row(s) to {args.csv_out}")
        return

    if use_long:
        print_long(out, id_col=id_col or out.columns[0])
        return

    with pd.option_context("display.max_rows", None, "display.max_columns", None,
                             "display.width", 200, "display.max_colwidth", args.max_width or None):
        print(out.to_string(index=False))


if __name__ == "__main__":
    main()
