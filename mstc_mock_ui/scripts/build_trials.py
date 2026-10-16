"""Build the trial list + asset folder for the MST-C study web app.

Usage:
    python scripts/build_trials.py --src /path/to/n03000134 --n-images 24 --seed 42

Design (one ImageNet class, here n03000134 = chain-link fence):
  * keep only images where ALL models have ALL method heatmaps (no error.txt)
  * sample n_images of them with a fixed seed
  * every (image, model) combination becomes one trial  -> n_images * n_models trials
  * each trial shows TWO heatmaps (two XAI methods) for the same image + model
  * method pairs are assigned by a rotating Latin-square-style schedule:
        pair_index = (image_index + model_offset) mod n_pairs
    so every image sees a different pair under each model, and over all trials
    every one of the C(5,2)=10 pairs shows up (near-)equally often.
  Left/right side, trial order and attention checks are handled per participant
  in the browser (app.js), seeded from the participant ID.
"""
from __future__ import annotations

import argparse
import itertools
import json
import random
import shutil

import numpy as np
from PIL import Image
from collections import Counter
from pathlib import Path

MODELS = ["dino", "resnet34", "vgg16"]
METHODS = ["gradcam", "integrated_gradients", "lime", "lrp_epsilon", "lrp_epsilonplus"]
TARGET_DIR = "label_target_0489"


def complete_images(src: Path) -> list[str]:
    """Images with input.png and every model x method heatmap present."""
    ok = []
    for img_dir in sorted(p for p in src.iterdir() if p.is_dir() and p.name.startswith("ILSVRC")):
        if not (img_dir / "input.png").exists():
            continue
        if all((img_dir / m / TARGET_DIR / f"{x}.png").exists() for m in MODELS for x in METHODS):
            ok.append(img_dir.name)
    return ok


def build(src: Path, out: Path, n_images: int, seed: int) -> dict:
    rng = random.Random(seed)
    pool = complete_images(src)
    if len(pool) < n_images:
        raise SystemExit(f"only {len(pool)} complete images, need {n_images}")
    images = sorted(rng.sample(pool, n_images))

    pairs = list(itertools.combinations(METHODS, 2))  # 10 pairs
    random.Random(seed + 1).shuffle(pairs)  # own RNG: schedule doesn't depend on pool size
    offsets = {m: 4 * k for k, m in enumerate(MODELS)}  # 0, 4, 8 -> 3 distinct pairs per image

    trials = []
    for i, img in enumerate(images):
        for m in MODELS:
            a, b = pairs[(i + offsets[m]) % len(pairs)]
            trials.append({"id": f"t{len(trials):03d}", "image": img, "model": m, "method_a": a, "method_b": b})

    # copy only what is used
    assets = out / "assets"
    for img in images:
        (assets / img).mkdir(parents=True, exist_ok=True)
        shutil.copy2(src / img / "input.png", assets / img / "input.png")
        for m in MODELS:
            (assets / img / m).mkdir(exist_ok=True)
            for x in METHODS:
                shutil.copy2(src / img / m / TARGET_DIR / f"{x}.png", assets / img / m / f"{x}.png")

    # intro-page example: a photo that is NOT in the trial set, so participants aren't primed
    ex_model, ex_methods = "resnet34", ("gradcam", "integrated_gradients")
    for img_dir in sorted(p for p in src.iterdir() if p.is_dir() and p.name.startswith("ILSVRC")):
        if img_dir.name in images:
            continue
        hm = [img_dir / ex_model / TARGET_DIR / f"{x}.png" for x in ex_methods]
        if (img_dir / "input.png").exists() and all(h.exists() for h in hm):
            (assets / "example").mkdir(exist_ok=True)
            shutil.copy2(img_dir / "input.png", assets / "example" / "input.png")
            for k, h in enumerate(hm, 1):
                shutil.copy2(h, assets / "example" / f"heatmap_{k}.png")
            print("intro example image:", img_dir.name)
            break

    catch = make_catch_trials(src, assets, images, seed)

    pair_counts = Counter(tuple(sorted((t["method_a"], t["method_b"]))) for t in trials)
    method_counts = Counter(x for t in trials for x in (t["method_a"], t["method_b"]))
    data = {
        "meta": {
            "wnid": "n03000134",
            "class_name": "chain-link fence",
            "target_label": 489,
            "seed": seed,
            "models": MODELS,
            "methods": METHODS,
            "n_images": n_images,
            "n_trials": len(trials),
            "complete_images_available": len(pool),
        },
        "trials": trials,
        "catch": catch,
    }
    (out / "trials.json").write_text(json.dumps(data, indent=1))

    print(f"{len(pool)} complete images -> sampled {n_images} -> {len(trials)} trials")
    print("pair counts:", {f"{a} vs {b}": c for (a, b), c in sorted(pair_counts.items())})
    print("method counts:", dict(method_counts))
    return data


def make_catch_trials(src: Path, assets: Path, images: list[str], seed: int, per_model: int = 2) -> list[dict]:
    """Hidden attention checks: a real Grad-CAM vs. the SAME heatmap with its pixels shuffled.

    Same colours, zero spatial structure, so the scrambled one is unambiguously the less legible.
    Participants aren't told these exist; choosing the scrambled map = not paying attention.
    """
    rng = np.random.default_rng(seed + 2)
    out_dir = assets / "catch"
    out_dir.mkdir(parents=True, exist_ok=True)
    catch = []
    for m in MODELS:
        for img in rng.choice(images, size=per_model, replace=False):
            real = src / img / m / TARGET_DIR / "gradcam.png"
            arr = np.asarray(Image.open(real).convert("RGB"))
            flat = arr.reshape(-1, 3)
            scrambled = flat[rng.permutation(len(flat))].reshape(arr.shape)
            name = f"{img[-8:]}_{m}"
            shutil.copy2(real, out_dir / f"{name}_real.png")
            Image.fromarray(scrambled).save(out_dir / f"{name}_scrambled.png")
            catch.append({"id": f"catch_{name}", "image": img, "model": m,
                          "real": f"assets/catch/{name}_real.png",
                          "scrambled": f"assets/catch/{name}_scrambled.png"})
    print(f"{len(catch)} catch stimuli (hidden attention checks)")
    return catch


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, required=True, help="class folder, e.g. .../n03000134")
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1])
    ap.add_argument("--n-images", type=int, default=24)
    ap.add_argument("--seed", type=int, default=42)
    a = ap.parse_args()
    build(a.src, a.out, a.n_images, a.seed)
