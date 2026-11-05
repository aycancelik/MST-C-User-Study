"""Analyse MST-C pilot exports: fatigue curve + how experts judged the heatmaps.

Put every participant's *_trials.csv and *_participant.csv into one folder, then:

    python analysis/analyze_pilot.py path/to/data_folder [--window 25] [--keep-simulated]

Writes into <folder>/analysis/:
    participants.csv      one row per person (validity, consistency, RT, probes, background)
    fatigue_by_window.csv quality metrics per window of main-trial positions
    methods.csv           win rate per XAI method (overall and by model)
    mstc_agreement.csv    how often people picked the higher-MST-C heatmap, per |dMSTC| bin
    fatigue_curve.png     (if matplotlib is installed)

Reading the fatigue curve: practice makes people faster too, so a falling RT alone is not fatigue.
Look for the window where RT keeps dropping AND quality drops (repeat consistency, attention checks,
side bias, focus probes). That position, minus a safety margin, is the session length for the main study.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd


def load(folder: Path, keep_sim: bool):
    trials = pd.concat([pd.read_csv(f) for f in sorted(folder.glob("*_trials.csv"))], ignore_index=True)
    parts = pd.concat([pd.read_csv(f) for f in sorted(folder.glob("*_participant.csv"))], ignore_index=True)
    trials = trials[trials["kind"] != "practice"]
    if not keep_sim:
        trials = trials[trials["simulated"].astype(str).str.lower() != "true"]
        parts = parts[parts["sum_simulated"].astype(str).str.lower() != "true"]
    for c in ["attention_pass", "repeat_consistent", "chose_higher_mstc"]:
        trials[c] = trials[c].map({True: 1.0, False: 0.0, "true": 1.0, "false": 0.0, "True": 1.0, "False": 0.0})
    return trials, parts


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("folder", type=Path)
    ap.add_argument("--window", type=int, default=25, help="screens per window on the position axis")
    ap.add_argument("--keep-simulated", action="store_true", help="include demo auto-answered sessions")
    args = ap.parse_args()
    trials, parts = load(args.folder, args.keep_simulated)
    out = args.folder / "analysis"
    out.mkdir(exist_ok=True)
    n_people = trials["participant_id"].nunique()
    print(f"{n_people} participants, {len(trials)} answered screens")

    # ---- per participant ----
    keep = [c for c in parts.columns if c.startswith(("participant_id", "bg_", "sum_", "probe", "post_fatigue", "post_length", "post_difficulty"))]
    parts[keep].to_csv(out / "participants.csv", index=False)
    cols = ["participant_id", "sum_valid", "sum_attention_passed", "sum_repeat_consistency", "sum_left_choice_rate",
            "sum_median_rt_ms_third1", "sum_median_rt_ms_third2", "sum_median_rt_ms_third3", "sum_focus_probe_values", "sum_duration_main_s"]
    print(parts[[c for c in cols if c in parts]].to_string(index=False))

    # ---- fatigue curve over screen position ----
    t = trials.copy()
    t["rt_ms"] = pd.to_numeric(t["rt_ms"], errors="coerce")
    # RT relative to each person's own median, so fast and slow people are comparable
    t["rt_rel"] = t["rt_ms"] / t.groupby("participant_id")["rt_ms"].transform("median")
    t["window"] = ((t["screen"] - 1) // args.window) * args.window + 1
    main_t = t[t["kind"] == "main"]
    side = main_t.assign(left=(main_t["chosen_side"] == "L").astype(float)).groupby(["participant_id", "window"])["left"].mean()
    side_bias = (side - 0.5).abs().groupby("window").mean()
    fast = main_t.assign(fast=(main_t["rt_ms"] < 800).astype(float)).groupby("window")["fast"].mean()
    fw = pd.DataFrame({
        "median_rt_ms": main_t.groupby("window")["rt_ms"].median(),
        "median_rt_rel": main_t.groupby("window")["rt_rel"].median(),
        "share_rt_under_800ms": fast,
        "side_bias": side_bias,
        "attention_pass_rate": t[t["kind"] == "attention"].groupby("window")["attention_pass"].mean(),
        "n_attention": t[t["kind"] == "attention"].groupby("window").size(),
        "repeat_consistency": t[t["kind"] == "repeat"].groupby("window")["repeat_consistent"].mean(),
        "n_repeats": t[t["kind"] == "repeat"].groupby("window").size(),
    })
    # focus probes from the participant table (probeK_after_screen / probeK_value)
    probes = []
    for k in range(1, 20):
        a, v = f"probe{k}_after_screen", f"probe{k}_value"
        if a in parts:
            probes.append(parts[[a, v]].rename(columns={a: "after_screen", v: "focus"}))
    if probes:
        pr = pd.concat(probes).dropna()
        pr["window"] = ((pr["after_screen"] - 1) // args.window) * args.window + 1
        fw["focus_probe_mean"] = pr.groupby("window")["focus"].mean()
    fw.index.name = "window_start_screen"
    fw.round(3).to_csv(out / "fatigue_by_window.csv")
    print("\nfatigue by window (screen position):\n", fw.round(2).to_string())

    # ---- expert view: methods + MST-C agreement ----
    shown = pd.concat([main_t["method_left"], main_t["method_right"]]).value_counts()
    wins = main_t["chosen_method"].value_counts()
    meth = pd.DataFrame({"shown": shown, "chosen": wins}).fillna(0)
    meth["win_rate"] = meth["chosen"] / meth["shown"]
    by_model = {}
    for m, g in main_t.groupby("model"):
        s = pd.concat([g["method_left"], g["method_right"]]).value_counts()
        by_model[f"win_rate_{m}"] = g["chosen_method"].value_counts().reindex(s.index).fillna(0) / s
    meth = meth.join(pd.DataFrame(by_model)).sort_values("win_rate", ascending=False)
    meth.round(3).to_csv(out / "methods.csv")
    print("\nmethod win rates:\n", meth.round(2).to_string())

    agree = main_t.dropna(subset=["chose_higher_mstc"]).groupby("bin")["chose_higher_mstc"].agg(["mean", "size"])
    agree = agree.reindex(["small", "medium", "large"])
    agree.loc["all"] = [main_t["chose_higher_mstc"].mean(), main_t["chose_higher_mstc"].notna().sum()]
    agree.columns = ["chose_higher_mstc_rate", "n"]
    agree.round(3).to_csv(out / "mstc_agreement.csv")
    print("\npicked the higher-MST-C heatmap (0.5 = chance; direction depends on how MST-C is oriented):\n", agree.round(3).to_string())

    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots(2, 1, figsize=(8, 6), sharex=True)
        x = fw.index
        ax[0].plot(x, fw["median_rt_rel"], marker="o", label="median RT (relative to own median)")
        ax[0].axhline(1, color="grey", lw=0.5)
        ax[0].set_ylabel("RT / own median"); ax[0].legend(loc="upper right", fontsize=8)
        for c, lab in [("repeat_consistency", "repeat consistency"), ("attention_pass_rate", "attention pass rate"), ("side_bias", "side bias |left − 0.5|")]:
            ax[1].plot(x, fw[c], marker="o", label=lab)
        if "focus_probe_mean" in fw:
            ax[1].plot(x, fw["focus_probe_mean"] / 5, marker="s", ls="--", label="focus probe / 5")
        ax[1].set_ylim(0, 1.05); ax[1].set_xlabel("screen position (window start)"); ax[1].legend(fontsize=8)
        fig.suptitle(f"MST-C pilot fatigue curve (n = {n_people})")
        fig.tight_layout(); fig.savefig(out / "fatigue_curve.png", dpi=150)
        print(f"\nplot: {out / 'fatigue_curve.png'}")
    except ImportError:
        print("\n(matplotlib not installed, skipped the plot)")
    print(f"tables in {out}")


if __name__ == "__main__":
    main()
