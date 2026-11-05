"""Build the stimulus pool for the MST-C *pilot* (fatigue + expert run).

Pool = every complete image x model x method pair (10 pairs from 5 methods), each with
the real MST-C scores of both heatmaps, |delta MST-C| and its tercile bin (small/medium/large,
cut over the whole pool, like the study_assignment pipeline). The browser then draws a balanced
per-participant session from this pool (see app.js).

Also writes:
  * hidden attention-check stimuli: real Grad-CAM vs. the same map with its pixels shuffled
  * one intro / practice image that is NOT in the pool (so nobody is primed on a real trial)

Usage (from mstc_pilot_ui/):
  python scripts/build_pilot_trials.py \
      --src  ~/Documents/n03000134 \
      --mstc ~/Documents/Projects/mst_c_user_study/outputs/mstc_imagenet_val_results.csv
"""
from __future__ import annotations

import argparse
import csv
import itertools
import json
import random
import shutil
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image

MODELS = ["dino", "resnet34", "vgg16"]
METHODS = ["gradcam", "integrated_gradients", "lime", "lrp_epsilon", "lrp_epsilonplus"]
WNID, TARGET = "n03000134", 489
TARGET_DIR = f"label_target_{TARGET:04d}"


def complete_images(src: Path) -> list[str]:
    """Images with input.png and every model x method heatmap present."""
    out = []
    for d in sorted(p for p in src.iterdir() if p.is_dir()):
        if (d / "input.png").exists() and all(
            (d / m / TARGET_DIR / f"{x}.png").exists() for m in MODELS for x in METHODS
        ):
            out.append(d.name)
    return out


def load_mstc(path: Path) -> dict[tuple[str, str, str], float]:
    """(image, model, method) -> MST-C score, streamed from the (big) pipeline CSV."""
    scores = {}
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            if r.get("wnid") != WNID or r.get("status", "ok") != "ok":
                continue
            if int(float(r["target_label"])) != TARGET or not r["mstc_score"]:
                continue
            scores[(r["sample_name"], r["model"], r["method"])] = float(r["mstc_score"])
    return scores


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, required=True, help="heatmap folder, e.g. n03000134/")
    ap.add_argument("--mstc", type=Path, required=True, help="mstc_imagenet_val_results.csv")
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1])
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--catch-per-model", type=int, default=5)
    args = ap.parse_args()
    rng = random.Random(args.seed)

    src, out = args.src.expanduser(), args.out
    assets = out / "assets"
    images = complete_images(src)
    scores = load_mstc(args.mstc.expanduser())
    # keep images where every heatmap has an MST-C score
    images = [i for i in images if all((i, m, x) in scores for m in MODELS for x in METHODS)]
    print(f"{len(images)} complete images with MST-C scores")

    # intro/practice image: kept OUT of the pool
    example = rng.choice(images)
    images = [i for i in images if i != example]

    # ---- pool: image x model x method pair ----
    trials = []
    for img in images:
        for m in MODELS:
            for a, b in itertools.combinations(METHODS, 2):
                sa, sb = scores[(img, m, a)], scores[(img, m, b)]
                trials.append({"image": img, "model": m, "method_a": a, "method_b": b,
                               "mstc_a": round(sa, 4), "mstc_b": round(sb, 4),
                               "abs_delta_mstc": round(abs(sa - sb), 4)})
    q1, q2 = np.quantile([t["abs_delta_mstc"] for t in trials], [1 / 3, 2 / 3])
    for k, t in enumerate(trials):
        t["id"] = f"p{k:04d}"
        d = t["abs_delta_mstc"]
        t["bin"] = "small" if d <= q1 else "medium" if d <= q2 else "large"
    print(f"pool: {len(trials)} trials, tercile cuts |dMSTC| = {q1:.2f} / {q2:.2f}")
    print("bins:", Counter(t["bin"] for t in trials))
    # every (model, method pair) cell needs >=2 trials per bin for the per-participant quotas
    cell = Counter((t["model"], t["method_a"], t["method_b"], t["bin"]) for t in trials)
    thin = [(k, v) for k, v in cell.items() if v < 2]
    pairs = list(itertools.combinations(METHODS, 2))
    missing = [(m, a, b, bn) for m in MODELS for a, b in pairs for bn in ("small", "medium", "large")
               if cell[(m, a, b, bn)] < 2]
    if missing:
        print(f"note: {len(missing)} model x pair x bin cells have <2 candidates; "
              "the app falls back to the nearest bin there:", missing[:6], "...")

    # ---- copy assets ----
    if assets.exists():
        shutil.rmtree(assets)
    for img in images + [example]:
        (assets / img).mkdir(parents=True)
        shutil.copy2(src / img / "input.png", assets / img / "input.png")
        for m in MODELS:
            (assets / img / m).mkdir()
            for x in METHODS:
                shutil.copy2(src / img / m / TARGET_DIR / f"{x}.png", assets / img / m / f"{x}.png")

    # ---- hidden attention checks: real Grad-CAM vs. pixel-shuffled copy ----
    catch_dir = assets / "catch"
    catch_dir.mkdir()
    nprng = np.random.default_rng(args.seed)
    catch = []
    for m in MODELS:
        for img in rng.sample(images, args.catch_per_model):
            arr = np.array(Image.open(src / img / m / TARGET_DIR / "gradcam.png"))
            flat = arr.reshape(-1, arr.shape[-1])
            scr = flat[nprng.permutation(len(flat))].reshape(arr.shape)
            name = f"{img[-8:]}_{m}"
            Image.fromarray(arr).save(catch_dir / f"{name}_real.png")
            Image.fromarray(scr).save(catch_dir / f"{name}_scrambled.png")
            catch.append({"id": f"catch_{name}", "image": img, "model": m,
                          "real": f"assets/catch/{name}_real.png",
                          "scrambled": f"assets/catch/{name}_scrambled.png"})

    # ---- practice: example image, two method pairs (excluded from analysis) ----
    practice = [
        {"id": "practice_1", "image": example, "model": "resnet34", "method_a": "gradcam", "method_b": "lime"},
        {"id": "practice_2", "image": example, "model": "vgg16", "method_a": "lrp_epsilon", "method_b": "integrated_gradients"},
    ]

    data = {
        "meta": {"wnid": WNID, "class_name": "chain-link fence", "target_label": TARGET,
                 "seed": args.seed, "models": MODELS, "methods": METHODS,
                 "n_images": len(images), "n_pool": len(trials), "example_image": example,
                 "tercile_cuts": [round(float(q1), 4), round(float(q2), 4)],
                 "mstc_source": args.mstc.name},
        "trials": trials, "catch": catch, "practice": practice,
    }
    (out / "trials.json").write_text(json.dumps(data, separators=(",", ":")))
    print(f"wrote trials.json ({len(trials)} pool, {len(catch)} catch, example {example})")


if __name__ == "__main__":
    main()
