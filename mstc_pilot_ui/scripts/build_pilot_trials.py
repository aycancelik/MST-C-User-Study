"""Build the stimulus pool for the MST-C *pilot* (fatigue + expert run).

Pool = every complete image x model x method pair (10 pairs from 5 methods), each with
the real MST-C scores of both heatmaps, |delta MST-C| and its tercile bin (small/medium/large,
cut over the whole pool, like the study_assignment pipeline). The browser then draws a balanced
per-participant session from this pool (see app.js).

Images come from the real study selection (scripts/positive_study.py's `select_images()`,
one image per class), not a single ImageNet class: pass its `selected_scores.csv` with
--selected. Each image has its own true_label, so the on-disk heatmap folder for image X is
<src>/<class_id>/<image_id>/<model>/label_target_{true_label:04d}/<method>.png -- <src> is the
root you download class folders into (e.g. one per class under ~/Downloads).

Also writes:
  * hidden attention-check stimuli: real Grad-CAM vs. the same map with its pixels shuffled
  * one intro / practice trial, drawn from the same 24 images and excluded from the real pool
    (so nobody is primed on a real trial) unless --practice-image overrides it

Usage (from mstc_pilot_ui/):
  python scripts/build_pilot_trials.py \
      --selected ../outputs/positive_study/selected_scores.csv \
      --src ~/Downloads
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


def load_selected(path: Path) -> dict[str, dict]:
    """selected_scores.csv -> {image_id: {class_id, true_label, scores: {(model, method): mstc}}}."""
    images: dict[str, dict] = {}
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            img = r["image_id"]
            entry = images.setdefault(img, {
                "class_id": r["class_id"],
                "true_label": int(float(r["true_label"])),
                "scores": {},
            })
            entry["scores"][(r["model_id"], r["method_id"])] = float(r["mstc_score"])
    return images


def target_dir(true_label: int) -> str:
    return f"label_target_{true_label:04d}"


def heatmap_path(src: Path, info: dict, image_id: str, model: str, method: str) -> Path:
    return src / info["class_id"] / image_id / model / target_dir(info["true_label"]) / f"{method}.png"


def check_available(src: Path, images: dict[str, dict]) -> tuple[list[str], list[str]]:
    """Split image_ids into (complete, missing) based on what's actually on disk."""
    complete, missing = [], []
    for img, info in images.items():
        img_dir = src / info["class_id"] / img
        ok = (img_dir / "input.png").exists() and all(
            heatmap_path(src, info, img, m, x).exists() for m in MODELS for x in METHODS
        )
        (complete if ok else missing).append(img)
    return complete, missing


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--selected", type=Path, required=True,
                     help="selected_scores.csv from scripts/positive_study.py's prepare_study()")
    ap.add_argument("--src", type=Path, required=True,
                     help="root folder holding one subfolder per class_id, e.g. ~/Downloads")
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1])
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--catch-per-model", type=int, default=5)
    ap.add_argument("--practice-image", default=None,
                     help="image_id to use for the practice trial instead of picking one of the "
                          "24 automatically (that image is then excluded from the real pool)")
    ap.add_argument("--allow-partial", action="store_true",
                     help="proceed with whichever of the 24 images are available on disk, "
                          "instead of stopping if any are missing")
    args = ap.parse_args()
    rng = random.Random(args.seed)

    src, out = args.src.expanduser(), args.out
    assets = out / "assets"

    selected = load_selected(args.selected)
    print(f"{len(selected)} images in {args.selected.name}")

    complete, missing = check_available(src, selected)
    if missing:
        print(f"{len(missing)} of {len(selected)} images not found under {src}:")
        for img in missing:
            print(f"  {selected[img]['class_id']}/{img}")
        if not args.allow_partial:
            raise SystemExit(
                "Download the missing class folders under --src, or pass --allow-partial "
                "to build the pool from the images you already have."
            )
    images = complete
    print(f"using {len(images)} images with all {len(MODELS)}x{len(METHODS)} heatmaps on disk")

    if len(images) < 2:
        raise SystemExit(
            f"only {len(images)} image(s) available, need at least 2 (one for practice, "
            "one for the real pool). Download more class folders under --src."
        )

    # intro/practice image: kept OUT of the real pool
    if args.practice_image:
        if args.practice_image not in images:
            raise SystemExit(f"--practice-image {args.practice_image} is not one of the available images")
        example = args.practice_image
    else:
        example = rng.choice(images)
    images = [i for i in images if i != example]

    # ---- pool: image x model x method pair ----
    trials = []
    for img in images:
        info = selected[img]
        for m in MODELS:
            for a, b in itertools.combinations(METHODS, 2):
                sa, sb = info["scores"][(m, a)], info["scores"][(m, b)]
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
    pairs = list(itertools.combinations(METHODS, 2))
    missing_cells = [(m, a, b, bn) for m in MODELS for a, b in pairs for bn in ("small", "medium", "large")
                      if cell[(m, a, b, bn)] < 2]
    if missing_cells:
        print(f"note: {len(missing_cells)} model x pair x bin cells have <2 candidates; "
              "the app falls back to the nearest bin there:", missing_cells[:6], "...")

    # ---- copy assets ----
    if assets.exists():
        shutil.rmtree(assets)
    for img in images + [example]:
        info = selected[img]
        (assets / img).mkdir(parents=True)
        shutil.copy2(src / info["class_id"] / img / "input.png", assets / img / "input.png")
        for m in MODELS:
            (assets / img / m).mkdir()
            for x in METHODS:
                shutil.copy2(heatmap_path(src, info, img, m, x), assets / img / m / f"{x}.png")

    # ---- hidden attention checks: real Grad-CAM vs. pixel-shuffled copy ----
    catch_dir = assets / "catch"
    catch_dir.mkdir()
    nprng = np.random.default_rng(args.seed)
    catch = []
    for m in MODELS:
        for img in rng.sample(images, args.catch_per_model):
            info = selected[img]
            arr = np.array(Image.open(heatmap_path(src, info, img, m, "gradcam")))
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
        "meta": {"seed": args.seed, "models": MODELS, "methods": METHODS,
                 "n_images": len(images), "n_pool": len(trials), "example_image": example,
                 "classes": sorted({selected[i]["class_id"] for i in images}),
                 "tercile_cuts": [round(float(q1), 4), round(float(q2), 4)],
                 "selected_source": args.selected.name},
        "trials": trials, "catch": catch, "practice": practice,
    }
    (out / "trials.json").write_text(json.dumps(data, separators=(",", ":")))
    print(f"wrote trials.json ({len(trials)} pool, {len(catch)} catch, example {example})")


if __name__ == "__main__":
    main()
