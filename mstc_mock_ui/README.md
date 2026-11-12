# MST-C heatmap comparison study (mock UI)

Static web app for the MST-C user study. Each participant compares pairs of explanation heatmaps
and clicks the one they find **more legible**. Aggregated, these choices tell us whether the MST-C score
predicts human perception. Stimuli: ImageNet `n03000134` (chain-link fence, label 489).

All task instructions live on 4 intro pages (what you'll see → reading a heatmap → your task →
attention checks). The trials themselves are wordless: photo on top, two heatmaps below. Only
nothing else is shown, not even on attention checks. The intro example uses a photo that is *not* in the trial
set (`assets/example/`).

One click per trial: the chosen card flashes for 250 ms, then the next pair loads. No confidence
rating, no Next button. Clicks are ignored until both heatmaps have loaded, and the response-time
clock starts at that moment.

* **pool:** 24 images × 3 models (DINO, ResNet34, VGG16) = 72 trials
* **per participant: 39 pairs + 3 hidden attention checks = 42 screens** (`nTrials`, `attentionChecks` in `config.js`).
  Each participant's 39 pairs are balanced: 13 per model (14 incl. its check), each of the 10 method pairs 3–4×,
  each method 15–16× (the best possible with 78 slots over 5 methods). Different participants get different
  subsets, so all 72 pool pairs are covered across people (greedy pick + swap repair, verified on 1000 simulated IDs)
* **hidden attention checks (catch trials):** a real Grad-CAM next to the *same* heatmap with its pixels
  shuffled (same colours, no structure, i.e. static). They look like normal trials and participants are never told
  about them. Correct = the real one. One per model, real side balanced, one at a random spot in each third
  of the session. Only `?demo=1` labels them (dashed outline + "HIDDEN ATTENTION CHECK" in the top bar)
* each trial = 2 of the 5 methods (Grad-CAM, Integrated Gradients, LIME, LRP-ε, LRP-ε+), same image + model
* all 10 method pairs appear 7–8× each; every image gets 3 different pairs (one per model)
* per participant (seeded by Prolific ID): shuffled order (no photo twice in a row),
  left/right placement 50/50, short break halfway
* progress is saved in the browser, so a reload resumes where the participant left off

## Try it locally

```bash
cd mstc-study
python -m http.server 8000
# participant view: http://localhost:8000
# researcher demo : http://localhost:8000/?demo=1
```

(Opening `index.html` straight from disk won't work, because the browser blocks `fetch("trials.json")` on `file://`.)

**Demo mode** (`?demo=1`) adds a top bar that shows the model/method behind each heatmap, an
"overlay on photo" toggle, auto-answer buttons to skip ahead, and a win-rate summary at the end.
It's the view to use when showing this to colleagues.

## Put it on GitHub Pages (your personal account)

```bash
cd mstc-study
git init && git add . && git commit -m "MST-C study mock UI"
git branch -M main
git remote add origin https://github.com/<your-username>/mstc-study.git   # create the empty repo on github.com first
git push -u origin main
```

Then on GitHub, go to **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `(root)`**.
After a minute it's live at `https://<your-username>.github.io/mstc-study/`
(send colleagues `…/mstc-study/?demo=1`).

⚠️ A public repo means the heatmaps and the code are public. For unpublished results, use a private repo
(Pages on private repos needs GitHub Pro / Education, which is free for students).

## Prolific later

In `config.js`:
* `completionCode` / `prolificReturnUrl`: shown on the end screen
* `showPhoto`: show the original photo above the pair as context (`false` = heatmaps only)
* `submitUrl`: the end screen POSTs the full session JSON here. GitHub Pages can't store data, so
  you'll need an endpoint (e.g. [DataPipe](https://pipe.jspsych.org/) → OSF, a Google Apps Script web app, or your own server).
  Without it, responses only live in the participant's browser (fine for the mock).
* Prolific study URL: `https://<you>.github.io/mstc-study/?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}`

## Regenerating trials

```bash
python scripts/build_trials.py --src /path/to/n03000134 --n-images 24 --seed 42
```

It keeps only images where every model has every heatmap (38 of 50 in this class), samples 24 with
the seed, writes `trials.json` and copies just the needed PNGs into `assets/`.

## Output columns (one row per trial)

`pid, study_id, session_id, position, trial_id, kind (main|attention), image, model, left_method,
right_method, chosen_side, chosen_method, other_method, image_duration_s, shown_at, overlay, attention_target, attention_pass, timestamp` (+ the per-participant summary columns below)

## Relation to the `study_assignment` pipeline

Right now the two are **not connected**. `scripts/build_trials.py` is a stand-in that only balances
method pairs; it doesn't use MST-C scores. The intended hand-off:

```
study_assignment/ (data_loading → pair_enumeration → sampling → assignment → validation)
        │  per-participant trial list: image, model, method_a, method_b, side, abs_delta_mstc bin, attention checks
        ▼
trials.json  ──►  this app (shows pairs, records clicks)  ──►  responses CSV  ──►  analysis vs. MST-C
```

What to align before wiring:
* **Methods:** pipeline = gradcam, lrp_epsilon, lrp_epsilonplusflat, lrp_epsilongammabox, lime, integrated_gradient (6);
  heatmap folder = gradcam, integrated_gradients, lime, lrp_epsilon, lrp_epsilonplus (5)
* **Models:** pipeline = resnet34, vgg16; heatmap folder also has dino
* **Who decides sides/attention checks:** the pipeline already does counterbalanced sides + attention-check
  injection, so when it supplies the list, the app should just display it as given (skip its own shuffling).

## Comprehension check (Prolific-compliant)

Flow: welcome → **check 1** (instructions + questions on one page) → 5 pairs → **check 2** (identical page) →
remaining pairs (break halfway) → **demographics** → end.

* **Framing:** participants are told it's about how people perceive images. Nothing on any participant screen
  mentions AI or models (checked automatically on every screen). Heatmaps are introduced as "coloured maps of the photo".
* **Start = gate.** Short instructions and 5 multiple-choice questions on the same page (as Prolific asks): what to click,
  what "more legible" means (clearer and easier to read), no right answer, how long to spend (a few seconds), judge repeated photos independently. Option order is shuffled
  per participant. 2 attempts; after a wrong first attempt the wrong questions are marked (answers not revealed) and
  the instructions stay right above. Wrong again → screen-out page asking them to return the study on Prolific
  ("Cancel participation"), or a redirect to `prolificScreenOutUrl` if you set up a screen-out code.
  Prolific's rules: checks at the start, ≥2 attempts, failures return/screen out, **never rejected**.
* **Check 2 = data-quality flag only** (`secondCheckAfter: 5` in `config.js`). Right after the 5th screen the **identical
  page** comes again (same instructions, questions and rules: two chances, wrong answers marked). Nobody is screened out
  here, since they've already started the task. A question answered wrong on the **first** try in both check 1 and
  check 2 sets `exclude_comprehension = true`. Exclusion from the **analysis** only; payment is not affected.
* Correct answers are never marked on screen (also not in demo mode).
* **Demographics** (last page): age (18–100, required), gender (male / female / non-binary / prefer not to say, optional),
  nationality (required, country suggestions), occupation or field of study (required). Mentioned in the consent text.
* Saved per participant (JSON `summary` + repeated on every CSV row): `check1_attempts`, `check1_passed`,
  `check1_screened_out`, `check1_first_try_wrong`, `check2_attempts`, `check2_first_try_wrong`, `comp_wrong_both_times`, `exclude_comprehension`,
  `age`, `gender`, `nationality`, `occupation`. Full answers per attempt are in the JSON (`comp`, `compEnd`, `demographics`).
* Switch parts off with `comprehension: false` / `demographics: false` in `config.js`. Demo view (`?demo=1`) ticks the
  correct options and has "fill correct / fill 1 wrong" buttons to show both paths.

## Timing data (all in seconds)

Per pair (every CSV row): `image_duration_s` = how long that image pair was on screen (both heatmaps visible → click),
with 3 decimals (e.g. `1.284`); `shown_at` / `timestamp` = when the pair appeared / was clicked (ISO time).

Per participant (JSON `summary` + repeated on every CSV row):

| column | from → to |
|---|---|
| `duration_total_s` | study page opened → end screen |
| `duration_instructions_check_s` | check 1 page shown → passed (reading + all attempts) |
| `duration_trials_s` | first pair → last click (incl. break and check 2) |
| `duration_break_s` | break screen shown → "Continue" |
| `duration_check2_s` | check 2 page shown → done |
| `duration_trials_only_s` | pure time on the pairs (trials minus break and check 2) |
| `duration_demographics_s` | demographics shown → submitted |
| `image_duration_median_s`, `_mean_s`, `_min_s`, `_max_s` | over the 39 real pairs |

All based on timestamps, so they stay correct if someone reloads mid-study.
