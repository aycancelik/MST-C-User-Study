/* MST-C pilot: static front end (GitHub Pages friendly).
 *
 * Flow: welcome/consent -> background (expertise) -> instructions -> 2 practice pairs
 *       -> main sequence (150 pairs + 12 repeats + 10 hidden checks, focus check-ins) -> debrief -> save
 *
 * Session content comes from session.js (seeded by participant ID, so a reload rebuilds the same session).
 * Progress is autosaved to localStorage after every click; a reload resumes where the person left off.
 * At the end the data are uploaded (if configured) and/or downloaded as .json + trials .csv + participant .csv.
 *
 * URL params: ?PROLIFIC_PID=..&STUDY_ID=..&SESSION_ID=..   ?pid=CODE (pre-set pilot code)
 *             ?demo=1 (researcher view)   ?reset=1 (discard saved progress for this ID)
 */
(() => {
  "use strict";
  const CFG = window.STUDY_CONFIG || {};
  const VERSION = CFG.appVersion || "pilot";
  const Q = new URLSearchParams(location.search);
  const DEMO = Q.get("demo") === "1";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  const KEY = (pid) => `mstc-pilot:${VERSION}:${pid}`, LAST = `mstc-pilot:${VERSION}:last`;
  const nowIso = () => new Date().toISOString();
  const viewport = () => `${innerWidth}x${innerHeight}`;
  const photo = (img) => `assets/${img}/input.png`;

  let DATA, SESS, S; // trials.json, built session, persisted state
  const save = () => S && store.set(KEY(S.pid), S);
  const N = () => SESS.seq.length;

  function show(id) {
    document.body.classList.add("ready");
    $$(".screen").forEach((s) => (s.hidden = s.id !== id));
    window.scrollTo(0, 0);
    renderDemoBar();
  }
  function setPhase(p) { S.phase = p; S.timings[p + "_at"] = S.timings[p + "_at"] || nowIso(); save(); }

  // ---------- interaction events (tab hidden, window blur, resize) ----------
  let cur = null; // active trial
  function logEvent(type, extra = {}) {
    if (!S) return;
    S.events.push({ type, at: nowIso(), phase: S.phase, screen: S.phase === "main" ? S.idx + 1 : null, ...extra });
    save();
  }
  document.addEventListener("visibilitychange", () => {
    if (cur) {
      if (document.hidden) cur.hiddenAt = performance.now();
      else if (cur.hiddenAt != null) { cur.hiddenMs += performance.now() - cur.hiddenAt; cur.hiddenAt = null; }
    }
    logEvent(document.hidden ? "tab_hidden" : "tab_visible");
  });
  window.addEventListener("blur", () => { if (cur) cur.blurs++; logEvent("window_blur"); });
  window.addEventListener("focus", () => logEvent("window_focus"));
  let rT; window.addEventListener("resize", () => { clearTimeout(rT); rT = setTimeout(() => logEvent("resize", { viewport: viewport() }), 400); });
  window.addEventListener("beforeunload", (e) => {
    if (S && ["main", "probe", "practice"].includes(S.phase) && !DEMO) { e.preventDefault(); e.returnValue = ""; }
  });

  // ---------- form widgets ----------
  const METHODS_FAM = [["gradcam", "Grad-CAM"], ["integrated_gradients", "Integrated Gradients"], ["lime", "LIME"], ["lrp", "LRP (any variant)"]];
  function initForms() {
    $$(".opts").forEach((box) => {
      const multi = box.classList.contains("multi"), name = box.dataset.name;
      box.innerHTML = box.dataset.options.split("|").map((o) =>
        `<label><input type="${multi ? "checkbox" : "radio"}" name="${name}" value="${o.replace(/"/g, "&quot;")}">${o}</label>`).join("");
    });
    $$(".likert").forEach((box) => {
      const name = box.dataset.name;
      box.innerHTML = `<span class="end">${box.dataset.lo}</span>` +
        [1, 2, 3, 4, 5].map((v) => `<label><input type="radio" name="${name}" value="${v}">${v}</label>`).join("") +
        `<span class="end">${box.dataset.hi}</span>`;
    });
    $("#familiarity").innerHTML = `<span></span>` +
      ["never heard of it", "", "", "", "use it regularly"].map((h, i) => `<span class="h">${i + 1}${h ? "<br>" + h : ""}</span>`).join("") +
      METHODS_FAM.map(([k, label]) => `<span>${label}</span>` +
        [1, 2, 3, 4, 5].map((v) => `<label><input type="radio" name="fam_${k}" value="${v}">${v}</label>`).join("")).join("");
    $("#f-post").addEventListener("change", (e) => {
      if (e.target.name === "recognised_methods") $("#fs-influence").hidden = e.target.value === "No";
    });
  }
  function readForm(form) {
    const out = {};
    for (const [k, v] of new FormData(form)) out[k] = out[k] ? out[k] + ";" + v : v;
    return out;
  }
  function checkForm(form, required, errEl) {
    const vals = readForm(form);
    let firstBad = null;
    $$(`#${form.id} fieldset`).forEach((fs) => fs.classList.remove("missing"));
    required.forEach((name) => {
      if (vals[name]) return;
      const el = form.querySelector(`[name="${name}"]`);
      const fs = el && el.closest("fieldset");
      if (fs && !fs.hidden) { fs.classList.add("missing"); firstBad = firstBad || fs; }
    });
    errEl.hidden = !firstBad;
    if (firstBad) firstBad.scrollIntoView({ behavior: "smooth", block: "center" });
    return firstBad ? null : vals;
  }

  // ---------- welcome ----------
  function initWelcome() {
    const total = (CFG.nMain || 150) + (CFG.nRepeats ?? 12) + (CFG.attentionChecks ?? 10);
    $("#w-ntrials").textContent = total;
    $("#w-minutes").textContent = Math.max(5, Math.round((total * (CFG.secondsPerTrial || 7) + 240) / 60 / 5) * 5);
    $("#w-small").hidden = innerWidth >= (CFG.minViewportWidth || 0);

    const urlPid = Q.get("PROLIFIC_PID");
    const pidIn = $("#pid");
    if (urlPid) {
      $("#pid-label").textContent = "Prolific ID"; pidIn.value = urlPid; pidIn.readOnly = true; $("#pid-hint").hidden = true;
    } else if (Q.get("pid")) pidIn.value = Q.get("pid");

    // unfinished session in this browser?
    const last = !urlPid && store.get(LAST), prev = last && store.get(KEY(last));
    if (prev && prev.phase !== "end") {
      $("#w-resume").hidden = false; $("#w-resume-pid").textContent = last;
      $("#w-resume-at").textContent = prev.phase === "main" ? `pair ${prev.idx + 1}` : prev.phase;
      $("#btn-resume-session").onclick = () => start(last, prev.id_source);
    }
    const ok = () => ($("#btn-start").disabled = !$("#consent").checked);
    $("#consent").addEventListener("change", ok); ok();
    $("#btn-start").onclick = () => {
      const typed = pidIn.value.trim();
      start(typed || autoCode(), urlPid ? "prolific" : typed ? "entered" : "generated");
    };
    show("s-welcome");
  }
  function autoCode() {
    const a = new Uint32Array(2); crypto.getRandomValues(a);
    return "P-" + (a[0].toString(36) + a[1].toString(36)).toUpperCase().slice(0, 6);
  }

  function start(pid, source) {
    if (Q.get("reset") === "1") store.del(KEY(pid));
    SESS = window.MSTCSession.buildSession(DATA, pid, CFG);
    S = store.get(KEY(pid));
    if (!S || S.n_screens !== SESS.seq.length) {
      S = {
        app_version: VERSION, study: CFG.studyName, pid, id_source: source,
        study_id: Q.get("STUDY_ID") || "", session_id: Q.get("SESSION_ID") || "",
        mode: source === "prolific" ? "prolific" : "pilot", demo: DEMO,
        started: nowIso(), consent_at: nowIso(), finished: null,
        phase: "bg", idx: 0, pidx: 0, probeAfter: null, breakShown: false,
        n_screens: SESS.seq.length, balance: SESS.balance,
        responses: [], practice: [], probes: [], breaks: [], events: [], timings: {},
        background: null, debrief: null, upload: null,
        env: {
          user_agent: navigator.userAgent, platform: navigator.platform || "", language: navigator.language,
          screen: `${screen.width}x${screen.height}`, device_pixel_ratio: devicePixelRatio, viewport_start: viewport(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, tz_offset_min: -new Date().getTimezoneOffset(),
          touch: navigator.maxTouchPoints > 0, small_window_warning: innerWidth < (CFG.minViewportWidth || 0),
          referrer: document.referrer || "",
        },
        config: JSON.parse(JSON.stringify({ ...CFG, upload: undefined })),
        data_meta: DATA.meta,
      };
      save();
    } else logEvent("resume", { resumed_phase: S.phase, idx: S.idx });
    if (source !== "prolific") store.set(LAST, pid);
    route();
  }

  function route() {
    switch (S.phase) {
      case "bg": return CFG.askBackground === false ? (setPhase("instr"), route()) : show("s-bg");
      case "instr": return initInstructions();
      case "practice": return S.pidx < SESS.practice.length ? runTrial() : (setPhase("practice_done"), route());
      case "practice_done": $("#pd-n").textContent = N(); return show("s-practice-done");
      case "main": return runTrial();
      case "probe": return showProbe();
      case "break": return showBreak();
      case "post": return CFG.askDebrief === false ? (setPhase("end"), finish()) : show("s-post");
      case "end": return finish();
    }
  }

  // ---------- background ----------
  $("#f-bg").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = checkForm(e.target, ["role", "ml_years", "xai_frequency", "xai_expertise", "colour_vision"], $("#bg-err"));
    if (!v) return;
    S.background = v; setPhase("instr"); route();
  });

  // ---------- instructions (paged) ----------
  function initInstructions() {
    const ex = DATA.practice && DATA.practice[0];
    if (ex) $("#mock-trial").innerHTML = `
      ${CFG.showPhoto === false ? "" : `<img class="mock-photo" src="${photo(ex.image)}" alt="example photo">`}
      <div class="mock-pair"><img src="assets/${ex.image}/${ex.model}/${ex.method_a}.png" alt="example heatmap"><img src="assets/${ex.image}/${ex.model}/${ex.method_b}.png" alt="example heatmap"></div>`;
    $("#i-ntrials").textContent = N();
    $("#i-quality").hidden = !CFG.mentionQualityChecks;
    const pages = $$("#s-instr .page");
    $("#steps").innerHTML = pages.map(() => "<i></i>").join("");
    let k = 0;
    const render = () => {
      pages.forEach((pg, i) => (pg.hidden = i !== k));
      [...$("#steps").children].forEach((d, i) => d.classList.toggle("on", i <= k));
      $("#btn-back").style.visibility = k ? "visible" : "hidden";
      $("#btn-fwd").textContent = k === pages.length - 1 ? "Start practice" : "Next";
      window.scrollTo(0, 0);
    };
    $("#btn-back").onclick = () => { if (k > 0) { k--; render(); } };
    $("#btn-fwd").onclick = () => {
      if (k < pages.length - 1) { k++; render(); return; }
      setPhase("practice"); route();
    };
    show("s-instr"); render();
  }
  $("#btn-go").onclick = () => { setPhase("main"); S.timings.main_start = S.timings.main_start || nowIso(); save(); route(); };

  // ---------- trial ----------
  function currentItem() { return S.phase === "practice" ? SESS.practice[S.pidx] : SESS.seq[S.idx]; }

  function runTrial() {
    const practice = S.phase === "practice";
    const t = currentItem();
    if (!t) return practice ? (setPhase("practice_done"), route()) : afterMain();
    $("#practice-tag").hidden = !practice;
    $("#counter").textContent = practice ? `${S.pidx + 1} / ${SESS.practice.length}` : `${S.idx + 1} / ${N()}`;
    $("#progress-fill").style.width = practice ? "0%" : `${(100 * S.idx) / N()}%`;
    document.body.classList.toggle("is-catch", t.kind === "attention");
    document.body.classList.toggle("is-repeat", t.kind === "repeat");

    $(".photo").hidden = CFG.showPhoto === false;
    const imgs = [$("#img-photo"), $("#card-L .hm"), $("#card-R .hm")];
    const setAt = performance.now();
    imgs[0].src = photo(t.image); imgs[1].src = t.Lsrc; imgs[2].src = t.Rsrc;
    $$(".hm-photo").forEach((im) => (im.src = photo(t.image)));
    $("#card-L .demo-label").textContent = `${t.left} · ${t.model}${t.mstc_left != null ? " · " + t.mstc_left.toFixed(1) : ""}`;
    $("#card-R .demo-label").textContent = `${t.right} · ${t.model}${t.mstc_right != null ? " · " + t.mstc_right.toFixed(1) : ""}`;
    applyOverlay();
    $$(".card").forEach((c) => c.classList.remove("selected", "dimmed"));

    // clicks only count (and the RT clock only starts) once photo + both heatmaps are decoded
    const c = (cur = { t, t0: 0, locked: true, hiddenMs: 0, hiddenAt: document.hidden ? performance.now() : null, blurs: 0, loadMs: null, onset: null });
    Promise.all(imgs.map((im) => (im.decode ? im.decode().catch(() => {}) : null))).then(() => {
      if (cur !== c) return;
      c.t0 = performance.now(); c.loadMs = Math.round(c.t0 - setAt); c.onset = nowIso(); c.locked = false;
    });
    show("s-trial");
    preload(practice ? null : SESS.seq[S.idx + 1]);
  }
  function preload(t) { if (t) [photo(t.image), t.Lsrc, t.Rsrc].forEach((u) => { const im = new Image(); im.src = u; }); }

  function choose(side, input, auto) {
    if (!cur || cur.locked) return;
    cur.locked = true;
    const t = cur.t, tNow = performance.now();
    if (cur.hiddenAt != null) cur.hiddenMs += tNow - cur.hiddenAt;
    const rec = {
      screen: t.screen ?? null, uid: t.uid, kind: t.kind, trial_id: t.trial_id,
      main_index: t.main_index ?? null, repeat_of: t.repeat_of ?? null, repeat_lag: t.repeat_lag ?? null,
      image: t.image, model: t.model, method_a: t.method_a ?? null, method_b: t.method_b ?? null,
      method_left: t.left, method_right: t.right, mstc_left: t.mstc_left ?? null, mstc_right: t.mstc_right ?? null,
      abs_delta_mstc: t.abs_delta_mstc ?? null, bin: t.bin ?? null, attention_target: t.target ?? null,
      chosen_side: side, chosen_method: side === "L" ? t.left : t.right,
      rt_ms: auto ? auto.rt : cur.t0 ? Math.round(tNow - cur.t0) : null,
      input, onset_iso: cur.onset, response_iso: nowIso(),
      t_since_main_start_s: S.timings.main_start ? Math.round((Date.now() - Date.parse(S.timings.main_start)) / 100) / 10 : null,
      stim_load_ms: cur.loadMs, hidden_ms: Math.round(cur.hiddenMs), blur_count: cur.blurs, viewport: viewport(),
      simulated: !!auto,
    };
    if (S.phase === "practice") { S.practice.push(rec); S.pidx++; } else { S.responses.push(rec); S.idx++; }
    save();
    const next = () => (S.phase === "practice" ? route() : afterMain());
    if (auto) return next();
    $$(".card").forEach((c) => { c.classList.toggle("selected", c.dataset.side === side); c.classList.toggle("dimmed", c.dataset.side !== side); });
    setTimeout(next, CFG.advanceDelayMs ?? 250);
  }

  // what comes after a main-sequence click: focus check-in, optional break, next trial or debrief
  function afterMain() {
    cur = null;
    const done = S.idx >= N();
    const pe = CFG.probeEvery;
    if (pe && (done || S.idx % pe === 0) && !S.probes.some((p) => p.after_screen === S.idx)) {
      S.probeAfter = S.idx; setPhase("probe"); return showProbe();
    }
    if (CFG.breakAt && !S.breakShown && S.idx === Math.round(N() * CFG.breakAt)) { setPhase("break"); return showBreak(); }
    if (done) { S.timings.main_end = S.timings.main_end || nowIso(); setPhase("post"); return route(); }
    S.phase = "main"; save(); runTrial();
  }

  // ---------- focus probe ----------
  let probeT0 = 0;
  function showProbe() {
    $("#probe-btns").innerHTML = [1, 2, 3, 4, 5].map((v) => `<button data-v="${v}">${v}</button>`).join("");
    probeT0 = performance.now();
    show("s-probe");
  }
  function answerProbe(v, auto) {
    if (S.phase !== "probe") return;
    S.probes.push({ after_screen: S.probeAfter, value: v, rt_ms: auto ? 1200 : Math.round(performance.now() - probeT0), at: nowIso(), final: S.probeAfter >= N() });
    S.probeAfter = null; S.phase = "main"; save();
    const b = $(`#probe-btns [data-v="${v}"]`); if (b) b.classList.add("selected");
    if (auto) return afterMain();
    setTimeout(afterMain, 200);
  }
  $("#probe-btns").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) answerProbe(+b.dataset.v); });

  // ---------- optional break ----------
  let breakT0 = 0;
  function showBreak() { breakT0 = Date.now(); show("s-break"); }
  $("#btn-resume").onclick = () => {
    S.breakShown = true; S.breaks.push({ after_screen: S.idx, duration_s: Math.round((Date.now() - breakT0) / 1000) });
    S.phase = "main"; save(); afterMain();
  };

  // ---------- debrief ----------
  $("#f-post").addEventListener("submit", (e) => {
    e.preventDefault();
    const req = ["cues", "recognised_methods", ...METHODS_FAM.map(([k]) => "fam_" + k), "fatigue_onset", "length_rating", "difficulty"];
    if (!$("#fs-influence").hidden) req.push("recognition_influence");
    const v = checkForm(e.target, req, $("#post-err"));
    if (!v) return;
    S.debrief = v; setPhase("end"); finish();
  });

  // ---------- export ----------
  const TRIAL_COLS = ["participant_id", "id_source", "study_id", "session_id", "mode", "app_version",
    "screen", "main_index", "kind", "uid", "trial_id", "repeat_of", "repeat_lag", "image", "model",
    "method_a", "method_b", "method_left", "method_right", "mstc_left", "mstc_right", "abs_delta_mstc", "bin",
    "chosen_side", "chosen_method", "chosen_mstc", "chose_higher_mstc", "attention_target", "attention_pass",
    "original_chosen_method", "repeat_consistent", "rt_ms", "input", "onset_iso", "response_iso",
    "t_since_main_start_s", "stim_load_ms", "hidden_ms", "blur_count", "viewport", "simulated"];

  function trialRows() {
    const byUid = {}; S.responses.forEach((r) => (byUid[r.uid] = r));
    const ids = { participant_id: S.pid, id_source: S.id_source, study_id: S.study_id, session_id: S.session_id, mode: S.mode, app_version: S.app_version };
    const rows = [...S.practice, ...S.responses].map((r) => {
      const o = { ...ids, ...r };
      if (r.mstc_left != null && r.mstc_right != null) {
        o.chosen_mstc = r.chosen_side === "L" ? r.mstc_left : r.mstc_right;
        o.chose_higher_mstc = r.mstc_left === r.mstc_right ? null : o.chosen_mstc === Math.max(r.mstc_left, r.mstc_right);
      }
      if (r.kind === "attention") o.attention_pass = r.chosen_method === "gradcam_real";
      if (r.kind === "repeat" && byUid[r.repeat_of]) {
        o.original_chosen_method = byUid[r.repeat_of].chosen_method;
        o.repeat_consistent = o.original_chosen_method === r.chosen_method;
      }
      return o;
    });
    return rows;
  }

  function median(a) { a = a.filter((x) => x != null).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; }
  function summary(rows) {
    const main = rows.filter((r) => r.kind === "main"), att = rows.filter((r) => r.kind === "attention"), rep = rows.filter((r) => r.kind === "repeat" && r.repeat_consistent != null);
    const third = (k) => main.filter((r) => r.main_index > (k * main.length) / 3 && r.main_index <= ((k + 1) * main.length) / 3);
    const hm = rows.filter((r) => r.chose_higher_mstc != null && r.kind === "main");
    const failed = att.filter((r) => !r.attention_pass).length;
    const dur = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 1000) : null);
    return {
      n_main_answered: main.length, n_repeat_answered: rep.length,
      attention_total: att.length, attention_passed: att.length - failed, attention_failed: failed,
      valid: failed < (CFG.prolific?.failThreshold ?? 2),
      repeat_consistency: rep.length ? +(rep.filter((r) => r.repeat_consistent).length / rep.length).toFixed(3) : null,
      left_choice_rate: main.length ? +(main.filter((r) => r.chosen_side === "L").length / main.length).toFixed(3) : null,
      chose_higher_mstc_rate: hm.length ? +(hm.filter((r) => r.chose_higher_mstc).length / hm.length).toFixed(3) : null,
      median_rt_ms: median(main.map((r) => r.rt_ms)),
      median_rt_ms_third1: median(third(0).map((r) => r.rt_ms)), median_rt_ms_third2: median(third(1).map((r) => r.rt_ms)), median_rt_ms_third3: median(third(2).map((r) => r.rt_ms)),
      focus_probe_values: S.probes.map((p) => p.value).join(";"),
      n_tab_hidden: S.events.filter((e) => e.type === "tab_hidden").length,
      total_hidden_s: Math.round(rows.reduce((a, r) => a + (r.hidden_ms || 0), 0) / 100) / 10,
      n_resumes: S.events.filter((e) => e.type === "resume").length,
      duration_total_s: dur(S.started, S.finished), duration_main_s: dur(S.timings.main_start, S.timings.main_end),
      simulated: rows.some((r) => r.simulated),
    };
  }

  function participantRow(sum) {
    const o = { participant_id: S.pid, id_source: S.id_source, study_id: S.study_id, session_id: S.session_id, mode: S.mode,
      app_version: S.app_version, started: S.started, finished: S.finished, main_start: S.timings.main_start, main_end: S.timings.main_end };
    Object.entries(S.env).forEach(([k, v]) => (o["env_" + k] = v));
    Object.entries(S.background || {}).forEach(([k, v]) => (o["bg_" + k] = v));
    Object.entries(S.debrief || {}).forEach(([k, v]) => (o["post_" + k] = v));
    S.probes.forEach((p, i) => { o[`probe${i + 1}_after_screen`] = p.after_screen; o[`probe${i + 1}_value`] = p.value; o[`probe${i + 1}_rt_ms`] = p.rt_ms; });
    Object.entries(sum).forEach(([k, v]) => (o["sum_" + k] = v));
    return o;
  }

  function toCSV(rows, cols) {
    cols = cols || [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const esc = (v) => { v = v == null ? "" : String(v); return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
    return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
  }

  function buildFiles() {
    const rows = trialRows(), sum = summary(rows);
    const stamp = S.started.replace(/[-:]/g, "").replace(/\..*/, "");
    const base = `mstc_pilot_${String(S.pid).replace(/[^\w-]/g, "_")}_${stamp}`;
    const json = {
      meta: { app_version: S.app_version, study: S.study, participant_id: S.pid, id_source: S.id_source, study_id: S.study_id,
        session_id: S.session_id, mode: S.mode, demo: S.demo, started: S.started, consent_at: S.consent_at, finished: S.finished },
      summary: sum, env: S.env, background: S.background, debrief: S.debrief, probes: S.probes, breaks: S.breaks,
      timings: S.timings, events: S.events, balance: S.balance, config: S.config, data_meta: S.data_meta,
      sequence: SESS.seq.map(({ Lsrc, Rsrc, ...t }) => t),
      trials: rows,
    };
    return [
      { name: base + ".json", type: "application/json", data: JSON.stringify(json, null, 1) },
      { name: base + "_trials.csv", type: "text/csv", data: toCSV(rows, TRIAL_COLS) },
      { name: base + "_participant.csv", type: "text/csv", data: toCSV([participantRow(sum)]) },
    ];
  }

  async function upload(files) {
    const up = CFG.upload || {};
    const targets = [];
    if (up.datapipeExperimentId) targets.push({ url: "https://pipe.jspsych.org/api/data/", body: (f) => ({ experimentID: up.datapipeExperimentId, filename: f.name, data: f.data }) });
    if (up.url) targets.push({ url: up.url, body: (f) => ({ participant_id: S.pid, filename: f.name, data: f.data }) });
    for (const tg of targets) for (const f of files) {
      const res = await fetch(tg.url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "*/*" }, body: JSON.stringify(tg.body(f)) });
      if (!res.ok) throw new Error(`${tg.url} → HTTP ${res.status}`);
    }
    return targets.length > 0;
  }

  function download(f) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([f.data], { type: f.type }));
    a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const downloadAll = (files) => files.forEach((f, i) => setTimeout(() => download(f), i * 400));

  // ---------- finish ----------
  async function finish() {
    cur = null;
    S.finished = S.finished || nowIso(); S.phase = "end"; save();
    $("#progress-fill").style.width = "100%";
    show("s-end");
    let files = buildFiles();
    const sum = JSON.parse(files[0].data).summary;
    const prolific = S.id_source === "prolific";
    const hasUpload = !!(CFG.upload && (CFG.upload.datapipeExperimentId || CFG.upload.url));
    $("#end-pid").textContent = prolific ? "" : `Your participant code: ${S.pid}`;

    const wire = () => {
      files = buildFiles();
      $("#btn-dl-all").onclick = () => downloadAll(files);
      $("#btn-json").onclick = () => download(files[0]);
      $("#btn-csv").onclick = () => download(files[1]);
      $("#btn-pcsv").onclick = () => download(files[2]);
    };
    wire();

    const msg = $("#end-msg");
    let saved = !!S.upload?.ok;
    if (hasUpload && !saved) {
      msg.textContent = "Saving your answers… please keep this tab open.";
      try { saved = await upload(files); S.upload = { ok: true, at: nowIso() }; }
      catch (err) { S.upload = { ok: false, at: nowIso(), error: String(err.message || err) }; }
      save(); wire();
    }
    if (hasUpload && saved) msg.textContent = "Your answers have been saved. You can close this tab.";
    else if (hasUpload) msg.textContent = "We couldn't upload your answers automatically. Please download them below and send them to the researcher.";
    else msg.textContent = prolific ? "Your answers are stored in this browser." : "Your answers are ready. The files are downloading; please send them to the researcher.";

    $("#end-tools").hidden = prolific && saved && !DEMO;
    const retry = $("#btn-retry"); retry.hidden = !(hasUpload && !saved);
    retry.onclick = () => { S.upload = null; save(); finish(); };
    if (!prolific && CFG.autoDownload && !saved && !S.autoDownloaded) { S.autoDownloaded = true; save(); downloadAll(files); }

    if (prolific) {
      const P = CFG.prolific || {};
      const failed = sum.attention_failed >= (P.failThreshold ?? 2) && P.failedChecksUrl;
      const url = failed ? P.failedChecksUrl : P.completionUrl;
      const code = failed ? (P.failedChecksCode || P.completionCode) : P.completionCode;
      if (code) { $("#completion-code").textContent = code; $("#code-box").hidden = false; }
      if (url) {
        const a = $("#btn-prolific"); a.href = url; a.hidden = false;
        if (saved || !hasUpload) setTimeout(() => { if (!DEMO) location.href = url; }, P.redirectDelayMs ?? 4000);
      }
    }
    if (DEMO) renderSummary(JSON.parse(files[0].data));
  }

  // demo-only: quick look at what the session produced
  function renderSummary(J) {
    const rows = J.trials.filter((r) => r.kind === "main"), s = J.summary;
    const wins = {}, shown = {};
    DATA.meta.methods.forEach((m) => (wins[m] = shown[m] = 0));
    rows.forEach((r) => { shown[r.method_left]++; shown[r.method_right]++; wins[r.chosen_method]++; });
    const tab = DATA.meta.methods.map((m) => ({ m, w: wins[m], n: shown[m], p: shown[m] ? wins[m] / shown[m] : 0 })).sort((a, b) => b.p - a.p);
    $("#summary").innerHTML = `
      <h2>Session summary <span class="muted">(researcher view only)</span></h2>
      <table><tr><th>Method</th><th class="num">Chosen</th><th class="num">Shown</th><th>Win rate</th></tr>
      ${tab.map((r) => `<tr><td>${r.m}</td><td class="num">${r.w}</td><td class="num">${r.n}</td><td><span class="bar" style="width:${Math.round(r.p * 120)}px"></span>${(r.p * 100).toFixed(0)}%</td></tr>`).join("")}
      </table>
      <p class="muted">Attention checks ${s.attention_passed}/${s.attention_total} · repeat consistency ${s.repeat_consistency ?? "–"} · picked left ${s.left_choice_rate ?? "–"} ·
      chose higher MST-C ${s.chose_higher_mstc_rate ?? "–"} · median RT by third: ${s.median_rt_ms_third1} / ${s.median_rt_ms_third2} / ${s.median_rt_ms_third3} ms ·
      focus probes ${s.focus_probe_values || "–"}${s.simulated ? " · (auto-answered)" : ""}</p>`;
  }

  // ---------- overlay + demo bar ----------
  function applyOverlay() {
    $$(".hm-wrap").forEach((w) => { w.classList.toggle("overlay", !!CFG.overlay); w.style.setProperty("--ov", CFG.overlayOpacity ?? 0.6); });
  }
  function renderDemoBar() {
    if (!DEMO) return;
    document.body.classList.add("demo");
    const bar = $("#demo-bar"); bar.hidden = false;
    const t = S && SESS && ["main", "practice"].includes(S.phase) ? currentItem() : null;
    const info = !t ? `<span>phase <b>${S ? S.phase : "welcome"}</b></span>`
      : t.kind === "attention" ? `<span><b class="catch-flag">HIDDEN ATTENTION CHECK</b> · correct = ${t.target === "L" ? "left" : "right"}</span>`
      : `<span><b>${t.kind}</b> ${t.uid}${t.repeat_of ? ` (of ${t.repeat_of}, lag ${t.repeat_lag})` : ""} · ${t.image.slice(-8)} · <b>${t.model}</b>${t.bin ? ` · ${t.bin} |Δ|=${t.abs_delta_mstc.toFixed(1)}` : ""}</span>`;
    const forms = S && ["bg", "post"].includes(S.phase);
    const running = S && ["main", "probe", "practice", "practice_done", "break"].includes(S.phase);
    bar.innerHTML = `<span class="pill">DEMO</span><span>pid <b>${S ? S.pid : "–"}</b></span>${info}<span class="spacer"></span>
      <label><input type="checkbox" id="d-ov" ${CFG.overlay ? "checked" : ""}> overlay</label>
      ${forms ? `<button id="d-form">auto-fill form</button>` : ""}
      ${running ? `<button id="d-10">auto 10</button><button id="d-all">auto all</button>` : ""}
      <button id="d-new">new participant</button>`;
    $("#d-ov").onchange = (e) => { CFG.overlay = e.target.checked; applyOverlay(); };
    const f = $("#d-form"); if (f) f.onclick = autoFill;
    const a10 = $("#d-10"); if (a10) a10.onclick = () => auto(10);
    const aAll = $("#d-all"); if (aAll) aAll.onclick = () => auto(1e9);
    $("#d-new").onclick = () => { if (S) store.del(KEY(S.pid)); store.del(LAST); location.href = location.pathname + "?demo=1"; };
  }
  function autoFill() {
    const form = S.phase === "bg" ? $("#f-bg") : $("#f-post");
    const groups = {};
    form.querySelectorAll("input[type=radio], input[type=checkbox]").forEach((i) => (groups[i.name] = groups[i.name] || []).push(i));
    Object.values(groups).forEach((g) => (g[Math.floor(Math.random() * g.length)].checked = true));
    form.querySelectorAll("select").forEach((s) => (s.selectedIndex = 1 + Math.floor(Math.random() * (s.options.length - 1))));
    $("#fs-influence").hidden = false;
    form.requestSubmit();
  }
  // simulated participant: RTs drift faster over the session, a bit of noise
  function auto(k) {
    for (let i = 0; i < k; i++) {
      if (S.phase === "practice_done") { $("#btn-go").click(); continue; }
      if (S.phase === "probe") { answerProbe(Math.max(1, 5 - Math.floor(S.idx / 50) - (Math.random() < 0.3)), true); continue; }
      if (S.phase === "break") { $("#btn-resume").click(); continue; }
      if (!["main", "practice"].includes(S.phase) || !cur) break;
      const t = cur.t, p = S.idx / N();
      const side = t.kind === "attention" ? (Math.random() < 0.95 ? t.target : t.target === "L" ? "R" : "L") : Math.random() < 0.5 ? "L" : "R";
      cur.locked = false;
      choose(side, "auto", { rt: Math.round((4500 - 2200 * p) * (0.6 + Math.random() * 0.8)) });
    }
    renderDemoBar();
  }

  // ---------- input ----------
  document.addEventListener("click", (e) => { const card = e.target.closest(".card"); if (card && !$("#s-trial").hidden) choose(card.dataset.side, "mouse"); });
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select")) return;
    if (!$("#s-trial").hidden) {
      if (e.key === "ArrowLeft") { e.preventDefault(); choose("L", "key"); }
      else if (e.key === "ArrowRight") { e.preventDefault(); choose("R", "key"); }
    } else if (!$("#s-probe").hidden && /^[1-5]$/.test(e.key)) answerProbe(+e.key);
  });

  // ---------- boot ----------
  window.addEventListener("error", (e) => { const m = $("#err-msg"); if (m) { m.textContent = e.message; show("s-error"); } });
  fetch("trials.json")
    .then((r) => { if (!r.ok) throw new Error(`trials.json: HTTP ${r.status}`); return r.json(); })
    .then((d) => { DATA = d; initForms(); initWelcome(); })
    .catch((err) => {
      $("#err-msg").textContent = `${err.message}. If you opened index.html directly from disk, run a local server instead: python -m http.server`;
      show("s-error");
    });
})();
