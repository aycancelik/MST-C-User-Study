# MST-C pilot: expert view + fatigue test drive

Static web app (GitHub Pages friendly) for the in-house pilot with XAI colleagues. Same look and task as
`mstc_mock_ui/`: photo on top, two heatmaps, click the **more legible** one. It answers two questions:

1. **How do experts judge the heatmaps?** Every choice is stored with both methods and both real MST-C scores
   (from `mst_c_user_study/outputs/mstc_imagenet_val_results.csv`), plus a background questionnaire (role, ML years,
   XAI use, self-rated expertise, colour vision) and a debrief (which cues made a map legible, method familiarity,
   whether they recognised methods).
2. **When does fatigue start?** One deliberately long session; quality is tracked against screen position.

| per person | count | what it measures |
|---|---|---|
| main pairs | 150 | the data: 5 per model × method-pair cell, |ΔMST-C| bins 50/50/50, photo spread 4–5× each |
| repeated pairs | 12 | same pair again, **sides swapped**, 30–60 trials later → self-consistency vs. position ⭐ |
| hidden attention checks | 10 | real Grad-CAM vs. pixel-shuffled copy, one per tenth of the session, real side 5/5 |
| focus check-ins | 4 | "how focused are you?" 1–5, after screens 43 / 86 / 129 / 172 |
| practice | 2 | example image that is not in the pool, excluded from analysis |
| **total** | **172 screens** | ≈ 20–25 min |

Per trial we log: response time (from the moment photo + both heatmaps are decoded), mouse vs. keyboard, image load
time, time the tab was hidden, window blurs, viewport. Order is shuffled per person (seeded by the participant code),
no photo twice in a row, left/right balanced within each third. **No break by default**, because a break resets
fatigue (`breakAt` in `config.js` if you want one anyway; its duration is logged).

## Files

```
index.html  style.css  app.js     UI + logging + export
session.js                        per-participant session builder (also runs in Node)
config.js                         all knobs: counts, upload, Prolific
trials.json  assets/              stimulus pool (built by scripts/build_pilot_trials.py)
scripts/build_pilot_trials.py     rebuild the pool from the real study's selected_scores.csv + heatmap folders
scripts/simulate_balance.js       check balance over many simulated participants
analysis/analyze_pilot.py         fatigue curve + method win rates + MST-C agreement
```

## Try it

```bash
cd mstc_pilot_ui
python -m http.server 8000
# participant view : http://localhost:8000
# researcher view  : http://localhost:8000/?demo=1   (shows method/model/MST-C, marks checks + repeats,
#                                                     auto-fill forms, auto-answer, summary at the end)
```

`?pid=ANNA` pre-fills a participant code; without one, a random code (`P-XXXXXX`) is generated and shown at the end.
`?reset=1` throws away saved progress for that code. Progress is saved after every click, so a reload resumes.

## Running the pilot with colleagues

After pushing, the pilot lives at `https://aycancelik.github.io/MST-C-User-Study/mstc_pilot_ui/`.

**Getting the data back** (pick one in `config.js`):

* **No setup (default):** at the end the browser downloads 3 files. Colleagues send them to you, or you run the
  sessions on your own laptop. The download buttons stay on the end screen as a fallback.
* **Automatic (recommended, and required for Prolific):** [DataPipe](https://pipe.jspsych.org/) is free and stores
  files in an OSF project. Create an OSF project + token, connect it in DataPipe, create an experiment, enable data
  collection, and paste its ID into `upload.datapipeExperimentId`. Each session then posts its 3 files there.
  (Check DataPipe's current docs while setting up; I wrote the request format from memory.)

## Later on Prolific

The same app works there. In `config.js` fill `prolific.completionUrl` (and `completionCode`), set the DataPipe ID,
and give Prolific this study URL:

```
https://aycancelik.github.io/MST-C-User-Study/mstc_pilot_ui/?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}
```

With `PROLIFIC_PID` in the URL the ID field is locked, no files are downloaded, and after saving the person is
redirected to the completion URL. Optional `failedChecksUrl` = a second completion path for sessions that fail
≥ `failThreshold` (2) checks. Run Prolific's preview once and confirm the files arrive in OSF.
For the main study, lower `nMain` / `nRepeats` / `attentionChecks` to what the pilot says is sustainable.

## Output

Per session: `mstc_pilot_<code>_<start>.json`, `…_trials.csv`, `…_participant.csv`.

**trials.csv**, one row per answered screen (`kind` = practice | main | repeat | attention):
`screen` (position in the session), `main_index`, `trial_id`, `repeat_of`, `repeat_lag`, `image`, `model`,
`method_a/b`, `method_left/right`, `mstc_left/right`, `abs_delta_mstc`, `bin`, `chosen_side`, `chosen_method`,
`chosen_mstc`, `chose_higher_mstc`, `attention_target`, `attention_pass`, `original_chosen_method`,
`repeat_consistent`, `rt_ms`, `input`, `onset_iso`, `response_iso`, `t_since_main_start_s`, `stim_load_ms`,
`hidden_ms`, `blur_count`, `viewport`, `simulated`.

**participant.csv**, one row: IDs, timings, device (`env_*`), background (`bg_*`), debrief (`post_*`),
focus probes (`probeK_after_screen/value/rt_ms`) and a summary (`sum_*`: attention passed/failed, `valid`,
repeat consistency, left-choice rate, median RT per third, tab-hidden count, durations).

**.json** has everything above plus the planned sequence, all interaction events, the balance report and the config.

## Analysis

```bash
python analysis/analyze_pilot.py path/to/folder_with_all_csvs
```

Writes `participants.csv`, `fatigue_by_window.csv` (median RT, RT relative to own median, share of < 800 ms clicks,
side bias, attention pass rate, repeat consistency and focus per 25-screen window), `methods.csv`,
`mstc_agreement.csv` and `fatigue_curve.png`. Practice also makes people faster, so look for the window where RT
keeps falling **and** consistency / checks / focus drop. Put the main-study length a safe margin before that:
paid Prolific participants will tire earlier than motivated colleagues.

## Rebuilding the stimuli

```bash
python scripts/build_pilot_trials.py \
  --selected ../outputs/positive_study/selected_scores.csv \
  --src ~/Downloads
node scripts/simulate_balance.js 300
```

`--selected` is the `selected_scores.csv` that `scripts/positive_study.py`'s `prepare_study()` writes for the
real study (one image per class, 24 by default). `--src` is a folder with one subfolder per class_id, each
holding that class's downloaded heatmaps (same layout as a single ImageNet class folder, just one level up).
If you don't have all the classes downloaded yet, add `--allow-partial` to build the pool from whichever ones
are already there; the script prints which are missing.

Pool size = (images - 1 held out for practice) × 3 models × 10 method pairs, all with real MST-C scores from
the study's own cleaning pipeline. Current pool (all 24 selected images, none missing): 23 images × 3 models
× 10 method pairs = 690 pairs; tercile cuts |ΔMST-C| = 43.8 / 131.4. All 24 images now have their original
photo too (`input.png`), so `showPhoto: true` in `config.js`.

Heatmap dumps that name files `gradcam_relu.png` etc. (not plain `gradcam.png`) need `--method-suffix _relu`,
which is already the default; pass `--method-suffix ""` if yours are unsuffixed. If a dump has no `input.png`
(the original photo) for some or all images, the script still builds the pool -- it just prints how many
are missing a photo and reminds you to set `showPhoto: false` in `config.js`.

## Notes

* |ΔMST-C| bins are strongly tied to the method pair (e.g. LRP-ε vs LRP-ε+ is almost always "small"), so the bins
  are balanced over the whole session, not inside each model × pair cell.
* Each photo appears 4–5 times (with different heatmap pairs); the instructions say so.
* The pilot now sources its images straight from the real study's `selected_scores.csv`, so its 5 methods and
  3 models already match the `study_assignment` pipeline (the 6 methods / 2 models in some older docs describe
  the original hand-picked dataset, not this one).
* The repo is public, so heatmaps and code are public too.
