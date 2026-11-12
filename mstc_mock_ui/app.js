/* MST-C heatmap comparison study: static front end (GitHub Pages friendly).
 *
 * trials.json  : canonical trial list from scripts/build_trials.py (image x model x method pair)
 * per participant (seeded by participant ID, so a reload gives the same session):
 *   - trial order shuffled, never the same photo twice in a row
 *   - left/right placement of the two methods counterbalanced (exactly half each way)
 *   - CONFIG.nTrials pairs drawn (balanced) from the pool
 *   - CONFIG.attentionChecks hidden catch trials (real vs scrambled heatmap), side balanced
 * URL params: ?PROLIFIC_PID=..&STUDY_ID=..&SESSION_ID=..   ?demo=1 (researcher view)   ?reset=1
 */
(() => {
  "use strict";
  const CFG = window.STUDY_CONFIG || {};
  const Q = new URLSearchParams(location.search);
  const DEMO = Q.get("demo") === "1";
  const $ = (s) => document.querySelector(s);
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  // ---------- seeded RNG ----------
  function hash(str) { // cyrb53
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
  function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const shuffle = (arr, rnd) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ---------- session building ----------
  // Pick n trials from the pool for this participant, keeping the subset balanced:
  // equal share per model (round-robin), method pairs / methods / photos spread as evenly as possible.
  // Different participants get different subsets, so across people the whole pool gets covered.
  function pickSubset(pool, n, rnd) {
    if (!n || n >= pool.length) return pool.slice();
    const cand = shuffle(pool, rnd);
    const models = shuffle([...new Set(pool.map((t) => t.model))], rnd);
    const cnt = { pair: {}, img: {}, meth: {} };
    const inc = (o, k) => (o[k] = (o[k] || 0) + 1);
    const pairKey = (t) => [t.method_a, t.method_b].sort().join("|");
    const chosen = [], used = new Set();
    for (let k = 0; chosen.length < n; k++) {
      const m = models[k % models.length];
      let best = null, bestScore = Infinity;
      for (const t of cand) {
        if (used.has(t.id) || t.model !== m) continue;
        const sc = 100 * (cnt.pair[pairKey(t)] || 0) + 30 * ((cnt.meth[t.method_a] || 0) + (cnt.meth[t.method_b] || 0))
          + 10 * (cnt.img[t.image] || 0);
        if (sc < bestScore) { best = t; bestScore = sc; }
      }
      if (!best) { models.splice(k % models.length, 1); k--; continue; } // model exhausted
      chosen.push(best); used.add(best.id);
      inc(cnt.pair, pairKey(best)); inc(cnt.img, best.image); inc(cnt.meth, best.method_a); inc(cnt.meth, best.method_b);
    }
    // repair: swap a chosen trial for an unused one of the SAME model while that lowers the imbalance
    // (sum of squared counts; pairs weigh most, then methods, then photo repeats)
    const cost = (set) => {
      const c = { p: {}, m: {}, i: {} };
      set.forEach((t) => { inc(c.p, pairKey(t)); inc(c.m, t.method_a); inc(c.m, t.method_b); inc(c.i, t.image); });
      const sq = (o) => Object.values(o).reduce((a, v) => a + v * v, 0);
      return 100 * sq(c.p) + 30 * sq(c.m) + 10 * sq(c.i);
    };
    let curCost = cost(chosen), improved = true;
    for (let it = 0; improved && it < 100; it++) {
      improved = false;
      const unused = cand.filter((t) => !used.has(t.id));
      for (let i = 0; i < chosen.length && !improved; i++) {
        for (const u of unused) {
          if (u.model !== chosen[i].model) continue;
          const trial = chosen.slice(); trial[i] = u;
          const c = cost(trial);
          if (c < curCost) { used.delete(chosen[i].id); used.add(u.id); chosen[i] = u; curCost = c; improved = true; break; }
        }
      }
    }
    return chosen;
  }

  function buildSession(allTrials, pid) {
    const rnd = mulberry32(hash("mstc|" + pid));
    const trials = pickSubset(allTrials, CFG.nTrials, rnd);

    // order: shuffle until no photo repeats back-to-back (cheap; 24 photos x 3)
    let order;
    for (let tries = 0; tries < 500; tries++) {
      order = shuffle(trials, rnd);
      if (order.every((t, i) => i === 0 || t.image !== order[i - 1].image)) break;
    }

    // sides: exactly half the trials put method_a on the left
    const flips = shuffle(order.map((_, i) => i < order.length / 2), rnd);
    let seq = order.map((t, i) => ({
      ...t, kind: "main",
      left: flips[i] ? t.method_a : t.method_b,
      right: flips[i] ? t.method_b : t.method_a,
    }));
    seq.forEach((t) => { t.Lsrc = src(t.image, t.model, t.left); t.Rsrc = src(t.image, t.model, t.right); });

    // hidden attention checks ("catch trials"): real Grad-CAM vs. the same map pixel-scrambled.
    // They look like any other trial; the correct answer is the real (structured) heatmap.
    // One per model (keeps model counts balanced), real side balanced, each dropped at a random
    // spot inside its own third of the session so the position isn't predictable.
    const nA = Math.min(CFG.attentionChecks ?? 3, (DATA.catch || []).length);
    if (nA) {
      const byModel = {};
      shuffle(DATA.catch, rnd).forEach((c) => (byModel[c.model] = byModel[c.model] || []).push(c));
      const models = shuffle(Object.keys(byModel), rnd);
      const picks = Array.from({ length: nA }, (_, k) => byModel[models[k % models.length]].shift()).filter(Boolean);
      const sides = shuffle(picks.map((_, k) => (k % 2 ? "L" : "R")), rnd);
      const seg = seq.length / picks.length;
      // insert from the back so earlier positions stay valid
      picks.map((c, k) => ({ c, k, at: Math.max(3, Math.floor(k * seg + rnd() * seg)) }))
        .sort((x, y) => y.at - x.at)
        .forEach(({ c, k, at }) => {
          // nearest slot (searching both ways) where neither neighbour shows the same photo
          const ok = (q) => q >= 3 && q <= seq.length && ![seq[q - 1], seq[q]].some((t) => t && t.image === c.image);
          let pos = at;
          for (let d = 0; d <= seq.length; d++) { if (ok(at + d)) { pos = at + d; break; } if (ok(at - d)) { pos = at - d; break; } }
          const realLeft = sides[k] === "L";
          seq.splice(pos, 0, { id: c.id, kind: "attention", image: c.image, model: c.model, target: sides[k],
            left: realLeft ? "gradcam (real)" : "scrambled", right: realLeft ? "scrambled" : "gradcam (real)",
            Lsrc: realLeft ? c.real : c.scrambled, Rsrc: realLeft ? c.scrambled : c.real });
        });
    }
    return seq;
  }

  // ---------- state ----------
  let DATA, SEQ, S; // S = persisted session state
  const key = (pid) => `mstc-session:${pid}`;
  const save = () => store.set(key(S.pid), S);
  const src = (img, model, method) => `assets/${img}/${model}/${method}.png`;
  const photo = (img) => `assets/${img}/input.png`;

  function show(id) {
    document.body.classList.add("ready");
    document.querySelectorAll(".screen").forEach((s) => (s.hidden = s.id !== id));
    window.scrollTo(0, 0);
    renderDemoBar();
  }

  const PAGE_OPENED = new Date().toISOString(); // when the participant first loaded the study page
  // ---------- welcome ----------
  function initWelcome() {
    const n = Math.min(CFG.nTrials || Infinity, DATA.trials.length) + Math.min(CFG.attentionChecks ?? 3, (DATA.catch || []).length);
    $("#w-ntrials").textContent = n;
    $("#w-minutes").textContent = Math.max(5, Math.round((n * (CFG.secondsPerTrial || 11)) / 60 / 5) * 5);
    const urlPid = Q.get("PROLIFIC_PID");
    const pidIn = $("#pid");
    if (urlPid) { pidIn.value = urlPid; pidIn.readOnly = true; }
    else if (DEMO) pidIn.value = "demo-" + Math.random().toString(36).slice(2, 7);
    const ok = () => ($("#btn-start").disabled = !(pidIn.value.trim() && $("#consent").checked));
    pidIn.addEventListener("input", ok); $("#consent").addEventListener("change", ok); ok();
    $("#btn-start").onclick = () => start(pidIn.value.trim());
    show("s-welcome");
  }

  function start(pid) {
    if (Q.get("reset") === "1") store.del(key(pid));
    SEQ = buildSession(DATA.trials, pid);
    S = store.get(key(pid));
    if (!S || S.n !== SEQ.length) {
      S = { pid, study_id: Q.get("STUDY_ID") || "", session_id: Q.get("SESSION_ID") || "", opened: PAGE_OPENED,
        n: SEQ.length, idx: 0, started: new Date().toISOString(), responses: [], breakShown: false,
        ua: navigator.userAgent, screen: `${screen.width}x${screen.height}` };
      save();
    }
    if (S.comp && S.comp.screened_out) return screenOut();
    if (S.idx >= SEQ.length) return runTrial(); // -> end check or finish
    if (S.idx > 0 || (S.comp && S.comp.passed)) return runTrial();
    showComp("start");
  }

  // ---------- comprehension check (Prolific-compliant) ----------
  // START: instructions and questions on ONE page (as Prolific asks), before the task. 2 attempts;
  //        after a wrong 1st try the wrong questions are marked (not the answers). Failing twice ->
  //        screen-out page asking them to return the study (never a rejection).
  // END:   the same questions once more after the last pair, no feedback. A question answered wrong
  //        both at the start (1st attempt) and at the end flags the person for exclusion from the
  //        ANALYSIS only (payment is not affected; Prolific doesn't allow rejecting on these).
  const COMP = [
    { id: "task", q: "What do you do on each screen?", hint: "Have another look at the instructions above.",
      opts: ["Click the heatmap I find more legible", "Click the heatmap with the most red", "Click the heatmap that looks most like the photo", "Click the photo"] },
    { id: "legible", q: "What does \u201cmore legible\u201d mean in this study?", hint: "Have another look at the instructions above.",
      opts: ["Clearer and easier to read", "More colourful", "Covers more of the photo", "Looks more like the photo"] },
    { id: "right_answer", q: "Is there a right or wrong answer for each pair?", hint: "Have another look at the instructions above.",
      opts: ["No, it's my own impression", "Yes, one heatmap is always the correct one", "Yes, the left heatmap is always correct"] },
    { id: "speed", q: "How long should you spend on each pair?", hint: "Have another look at the instructions above.",
      opts: ["A few seconds, going with my impression", "At least a minute per pair", "As long as it takes to find the correct one"] },
    { id: "repeat", q: "The same photo shows up again with different heatmaps. What do you do?", hint: "Have another look at the instructions above.",
      opts: ["Judge the new pair on its own", "Pick the same side as last time", "Skip it"] },
  ]; // first option = correct; the order shown is shuffled per participant (same order at start and end)

  let compStage = "start";
  function showComp(stage) {
    compStage = stage;
    const rnd = mulberry32(hash("comp|" + S.pid));
    const start = stage === "start";
    const tries = start ? (S.comp ? S.comp.attempts : []) : (S.compEndAttempts || []);
    // start and end show the IDENTICAL page: instructions + the same questions (Prolific: checks are
    // answered with the instructions in view, not from memory). End = 1 attempt, no feedback.
    $("#instr-block").hidden = false;
    $("#i-ntrials").textContent = SEQ.length; // participants just see the total
    $("#comp-eyebrow").textContent = "Quick check";
    $("#comp-title").textContent = `Please answer these ${COMP.length} questions`;
    $("#comp-lead").textContent = "Not sure? Re-read the instructions above. You have two chances to get these right.";
    $("#btn-comp").textContent = "Continue";
    const shownKey = start ? "compShownAt" : "compEndShownAt";
    if (!S[shownKey]) { S[shownKey] = new Date().toISOString(); save(); }
    const last = tries.length === 1 ? tries[0] : null; // after a failed 1st attempt (start AND end: same page, same rules)
    $("#comp-msg").hidden = !last;
    if (last) $("#comp-msg").innerHTML = "Some answers aren't right yet (marked in red). Please re-read the instructions above, then try again. <b>This is your last attempt.</b>";
    $("#comp-qs").innerHTML = COMP.map((c) => {
      const order = shuffle(c.opts.map((_, i) => i), rnd);
      const wrong = last && !last.correct[c.id];
      const prev = last ? last.answers_idx[c.id] : null;
      return `<fieldset class="q${wrong ? " wrong" : ""}" data-q="${c.id}"><legend>${c.q}</legend>` +
        order.map((i) => `<label class="opt"><input type="radio" name="${c.id}" value="${i}"${prev === i && !wrong ? " checked" : ""}><span>${c.opts[i]}</span></label>`).join("") +
        `<p class="hint">Not quite. ${c.hint}</p></fieldset>`;
    }).join("");
    $("#comp-err").hidden = true;
    show("s-comp");
    if (last) setTimeout(() => $("#comp-msg").scrollIntoView({ block: "center" }), 0); // keep the feedback in view
  }
  $("#f-comp").addEventListener("change", (e) => { const q = e.target.closest(".q"); if (q) q.classList.remove("wrong", "missing"); });
  $("#f-comp").addEventListener("submit", (e) => {
    e.preventDefault();
    const answers = {}, correct = {};
    let missing = false;
    COMP.forEach((c) => {
      const el = e.target.querySelector(`input[name="${c.id}"]:checked`);
      e.target.querySelector(`[data-q="${c.id}"]`).classList.toggle("missing", !el);
      if (!el) { missing = true; return; }
      answers[c.id] = +el.value; correct[c.id] = +el.value === 0;
    });
    $("#comp-err").hidden = !missing;
    if (missing) return;
    const rec = { at: new Date().toISOString(), answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, COMP.find((c) => c.id === k).opts[v]])),
      correct, n_wrong: Object.values(correct).filter((v) => !v).length };
    rec.answers_idx = answers; // 0 = correct option
    if (compStage === "end") {
      // same two chances as at the start, but never screened out here (they've already done the work).
      // The FIRST end attempt is what counts for the exclusion flag.
      S.compEndAttempts = S.compEndAttempts || [];
      S.compEndAttempts.push(rec);
      S.compEnd = S.compEndAttempts[0];
      if (rec.n_wrong && S.compEndAttempts.length < 2) { save(); return showComp("end"); }
      S.compEndDoneAt = rec.at; save(); return runTrial(); // -> demographics -> end
    }
    S.comp = S.comp || { attempts: [], passed: false, screened_out: false };
    S.comp.attempts.push(rec);
    if (!rec.n_wrong) { S.comp.passed = true; S.trialsStartedAt = new Date().toISOString(); save(); return runTrial(); }
    if (S.comp.attempts.length >= 2) { S.comp.screened_out = true; S.finished = new Date().toISOString(); save(); return screenOut(); }
    save(); showComp("start");
  });

  // ---------- demographics (end of study) ----------
  function showDemo() { if (!S.demoShownAt) { S.demoShownAt = new Date().toISOString(); save(); } show("s-demo"); }
  $("#f-demo").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target, age = +f.age.value;
    const d = { age: f.age.value ? age : "", gender: (f.querySelector("input[name=gender]:checked") || {}).value || "",
      nationality: f.nationality.value.trim(), occupation: f.occupation.value.trim() };
    const bad = !(age >= 18 && age <= 100) || !d.nationality || !d.occupation;
    [f.age, f.nationality, f.occupation].forEach((el) => el.classList.add("touched"));
    $("#demo-err").hidden = !bad;
    if (bad) return;
    S.demographics = { ...d, at: new Date().toISOString() }; save();
    finish();
  });
  $("#f-demo").addEventListener("input", () => { $("#demo-err").hidden = true; });
  // nationality suggestions: country names from the browser (ISO codes), so spelling stays consistent
  (() => {
    try {
      const codes = "AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI KH CM CA CV CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HK HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI XK KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG KP MK NO OM PK PW PS PA PG PY PE PH PL PT PR QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA KR SS ES LK SD SR SE CH SY TW TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VA VE VN YE ZM ZW".split(" ");
      const dn = new Intl.DisplayNames(["en"], { type: "region" });
      const dl = document.createElement("datalist"); dl.id = "countries";
      dl.innerHTML = codes.map((c) => dn.of(c)).sort().map((n) => `<option value="${n}">`).join("");
      document.body.appendChild(dl);
    } catch {}
  })();

  async function screenOut() {
    if (CFG.prolificScreenOutUrl) { const a = $("#btn-screenout"); a.href = CFG.prolificScreenOutUrl; a.hidden = false;
      $("#so-how").innerHTML = "Please click the button below to go back to Prolific."; }
    show("s-screenout");
    if (CFG.submitUrl && !S.submitted) { // keep a record of screen-outs too
      try { const r = await fetch(CFG.submitUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(exportJSON()) }); if (r.ok) { S.submitted = true; save(); } } catch {}
    }
  }

  // session-level summary (comprehension + attention), also repeated on every CSV row
  function summarize() {
    const att = S.responses.filter((r) => r.kind === "attention");
    const first = S.comp && S.comp.attempts[0], end = S.compEnd;
    const wrongFirst = first ? COMP.filter((c) => !first.correct[c.id]).map((c) => c.id) : [];
    const wrongEnd = end ? COMP.filter((c) => !end.correct[c.id]).map((c) => c.id) : [];
    const both = wrongFirst.filter((q) => wrongEnd.includes(q));
    return {
      comp_start_attempts: S.comp ? S.comp.attempts.length : 0,
      comp_start_passed: !!(S.comp && S.comp.passed),
      comp_screened_out: !!(S.comp && S.comp.screened_out),
      comp_start_first_wrong: wrongFirst.join(";"),
      comp_end_attempts: (S.compEndAttempts || []).length,
      comp_end_wrong: wrongEnd.join(";"),
      comp_wrong_both_times: both.join(";"),
      exclude_comprehension: both.length > 0,
      attention_checks: att.length,
      attention_failed: att.filter((r) => r.attention_pass !== true).length,
      ...durations(),
      age: S.demographics ? S.demographics.age : "",
      gender: S.demographics ? S.demographics.gender : "",
      nationality: S.demographics ? S.demographics.nationality : "",
      occupation: S.demographics ? S.demographics.occupation : "",
    };
  }
  const exportJSON = () => ({ summary: summarize(), ...S });

  // How long things took (seconds). Based on ISO timestamps, so they survive reloads/resumes.
  function durations() {
    const t = (iso) => (iso ? new Date(iso).getTime() : NaN);
    const sec = (a, b) => { const d = (t(b) - t(a)) / 1000; return Number.isFinite(d) ? Math.round(d) : ""; };
    const main = S.responses.filter((r) => r.kind === "main"), rts = main.map((r) => r.image_duration_ms).filter((v) => v != null);
    const sorted = rts.slice().sort((a, b) => a - b), lastClick = S.responses.length ? S.responses[S.responses.length - 1].timestamp : "";
    const brk = sec(S.breakStartedAt, S.breakEndedAt), trials = sec(S.trialsStartedAt, lastClick);
    return {
      duration_total_s: sec(S.opened || S.started, S.finished),                       // welcome page -> end screen
      duration_instructions_check_s: sec(S.compShownAt, S.trialsStartedAt),           // reading + start check (all attempts)
      duration_trials_s: trials,                                                      // first pair -> last click, incl. break
      duration_break_s: brk,
      duration_trials_excl_break_s: trials !== "" ? trials - (brk || 0) : "",
      duration_end_check_s: sec(S.compEndShownAt, S.compEndDoneAt),
      duration_demographics_s: sec(S.demoShownAt, S.demographics && S.demographics.at),
      image_duration_median_ms: sorted.length ? sorted[Math.floor(sorted.length / 2)] : "",
      image_duration_mean_ms: rts.length ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length) : "",
      image_duration_min_ms: sorted.length ? sorted[0] : "",
      image_duration_max_ms: sorted.length ? sorted[sorted.length - 1] : "",
    };
  }

  // ---------- trial ----------
  // One click = one answer: the chosen card flashes briefly, then the next pair loads.
  let cur = null; // { t0, locked }
  function runTrial() {
    if (S.idx >= SEQ.length) {
      if (CFG.comprehension !== false && !S.compEndDoneAt) return showComp("end");
      if (CFG.demographics !== false && !S.demographics) return showDemo();
      return finish();
    }
    if (CFG.breakAt && !S.breakShown && S.idx === Math.round(SEQ.length * CFG.breakAt)) {
      S.breakShown = true; S.breakStartedAt = new Date().toISOString(); save();
      $("#btn-resume").onclick = () => { S.breakEndedAt = new Date().toISOString(); save(); runTrial(); };
      return show("s-break");
    }
    const t = SEQ[S.idx];
    cur = { t0: 0, locked: true };
    $("#counter").textContent = `${S.idx + 1} / ${SEQ.length}`;
    $("#progress-fill").style.width = `${(100 * S.idx) / SEQ.length}%`;

    // trials are wordless; only attention checks carry an instruction
    $("#attn").hidden = true; // hidden checks: nothing tells participants


    $(".photo").hidden = CFG.showPhoto === false;
    const imgs = [$("#img-photo"), $("#card-L .hm"), $("#card-R .hm")];
    imgs[0].src = photo(t.image);
    imgs[1].src = t.Lsrc;
    imgs[2].src = t.Rsrc;
    document.querySelectorAll(".hm-photo").forEach((im) => (im.src = photo(t.image)));
    $("#card-L .demo-label").textContent = `${t.left} · ${t.model}`;
    $("#card-R .demo-label").textContent = `${t.right} · ${t.model}`;
    document.body.classList.toggle("is-catch", DEMO && t.kind === "attention"); // marker only in demo view
    applyOverlay();
    document.querySelectorAll(".card").forEach((c) => c.classList.remove("selected", "dimmed"));

    // clicks only count (and the RT clock only starts) once both heatmaps are on screen
    const c = cur;
    Promise.all(imgs.map((im) => (im.decode ? im.decode().catch(() => {}) : null)))
      .then(() => { c.t0 = performance.now(); c.onset = new Date().toISOString(); c.locked = false; });
    show("s-trial");
    preload(S.idx + 1);
  }

  function preload(i) {
    const t = SEQ[i]; if (!t) return;
    [photo(t.image), t.Lsrc, t.Rsrc].forEach((u) => { const im = new Image(); im.src = u; });
  }

  function choose(side, instant) {
    if (!cur || cur.locked) return;
    cur.locked = true; // ignore double clicks
    const t = SEQ[S.idx];
    const dur = cur.t0 ? Math.round(performance.now() - cur.t0) : null; // one measurement for both columns
    S.responses.push({
      pid: S.pid, study_id: S.study_id, session_id: S.session_id,
      position: S.idx + 1, trial_id: t.id, kind: t.kind, image: t.image, model: t.model,
      left_method: t.left, right_method: t.right,
      chosen_side: side, chosen_method: side === "L" ? t.left : t.right,
      other_method: side === "L" ? t.right : t.left,
      // how long this image pair was on screen: both heatmaps visible -> click
      image_duration_ms: dur,
      image_duration_s: dur == null ? null : dur / 1000,
      shown_at: cur.onset || "",
      overlay: !!CFG.overlay,
      attention_target: t.kind === "attention" ? t.target : "",
      attention_pass: t.kind === "attention" ? side === t.target : "",
      timestamp: new Date().toISOString(),
    });
    S.idx++; save();
    if (instant) return runTrial();
    document.querySelectorAll(".card").forEach((c) => {
      c.classList.toggle("selected", c.dataset.side === side);
      c.classList.toggle("dimmed", c.dataset.side !== side);
    });
    setTimeout(runTrial, CFG.advanceDelayMs ?? 250);
  }

  // ---------- finish ----------
  async function finish() {
    S.finished = S.finished || new Date().toISOString(); save();
    $("#progress-fill").style.width = "100%";
    if (CFG.completionCode) { $("#completion-code").textContent = CFG.completionCode; $("#code-box").hidden = false; }
    if (CFG.prolificReturnUrl) { const a = $("#btn-prolific"); a.href = CFG.prolificReturnUrl; a.hidden = false; }
    $("#end-tools").hidden = !(CFG.showDownloads || DEMO);
    const sm = summarize();
    $("#btn-csv").onclick = () => download(`mstc_${S.pid}.csv`, toCSV(S.responses.map((r) => ({ ...r, ...sm }))), "text/csv");
    $("#btn-json").onclick = () => download(`mstc_${S.pid}.json`, JSON.stringify(exportJSON(), null, 1), "application/json");
    if (DEMO) renderSummary();
    show("s-end");
    if (CFG.submitUrl && !S.submitted) {
      $("#end-msg").textContent = "Saving your answers…";
      try {
        const res = await fetch(CFG.submitUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(exportJSON()) });
        if (!res.ok) throw new Error(res.status);
        S.submitted = true; save();
        $("#end-msg").textContent = "Your answers have been saved.";
      } catch (e) {
        $("#end-msg").textContent = "We couldn't upload your answers automatically. Please download them below and send them to the researcher.";
        $("#end-tools").hidden = false;
      }
    } else if (!CFG.submitUrl) {
      $("#end-msg").textContent = DEMO ? "Demo run finished. Nothing is uploaded in this mock; download the responses below."
        : "Your answers have been recorded in this browser.";
    }
  }

  function toCSV(rows) {
    if (!rows.length) return "";
    const cols = Object.keys(rows[0]);
    const esc = (v) => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
    return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  }
  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // demo-only: quick look at what the session produced
  function renderSummary() {
    const main = S.responses.filter((r) => r.kind === "main");
    const att = S.responses.filter((r) => r.kind === "attention");
    const wins = {}, shown = {};
    DATA.meta.methods.forEach((m) => (wins[m] = shown[m] = 0));
    main.forEach((r) => { shown[r.left_method]++; shown[r.right_method]++; wins[r.chosen_method]++; });
    const leftRate = main.length ? main.filter((r) => r.chosen_side === "L").length / main.length : 0;
    const rows = DATA.meta.methods.map((m) => ({ m, w: wins[m], n: shown[m], p: shown[m] ? wins[m] / shown[m] : 0 })).sort((a, b) => b.p - a.p);
    $("#summary").innerHTML = `
      <h2>Session summary <span class="muted">(researcher view only)</span></h2>
      <table><tr><th>Method</th><th class="num">Chosen</th><th class="num">Shown</th><th>Win rate</th></tr>
      ${rows.map((r) => `<tr><td>${r.m}</td><td class="num">${r.w}</td><td class="num">${r.n}</td><td><span class="bar" style="width:${Math.round(r.p * 120)}px"></span>${(r.p * 100).toFixed(0)}%</td></tr>`).join("")}
      </table>
      <p class="muted">Comprehension: start ${S.comp ? S.comp.attempts.length : 0} attempt(s) · end wrong: ${summarize().comp_end_wrong || "none"} · exclude_comprehension: <b>${summarize().exclude_comprehension}</b> · Attention checks passed: ${att.filter((r) => r.attention_pass === true).length} / ${att.length} · picked left side: ${(leftRate * 100).toFixed(0)}% · median time per image: ${median(main.map((r) => r.image_duration_ms).filter(Boolean))} · total time: ${durations().duration_total_s} s</p>`;
  }
  const median = (a) => { if (!a.length) return "– (auto-answered)"; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)] + " ms"; };

  // ---------- overlay + demo bar ----------
  function applyOverlay() {
    document.querySelectorAll(".hm-wrap").forEach((w) => { w.classList.toggle("overlay", !!CFG.overlay); w.style.setProperty("--ov", CFG.overlayOpacity ?? 0.6); });
  }
  function renderDemoBar() {
    if (!DEMO) return;
    document.body.classList.add("demo");
    const bar = $("#demo-bar"); bar.hidden = false;
    const t = SEQ && S && SEQ[S.idx];
    bar.innerHTML = `<span class="pill">DEMO</span>
      <span>pid <b>${S ? S.pid : "–"}</b></span>
      ${t ? `<span>${t.kind === "attention" ? `<b class="catch-flag">HIDDEN ATTENTION CHECK</b> · correct = ${t.target === "L" ? "left" : "right"}` : `trial <b>${t.id}</b>`} · ${t.image.slice(-8)} · <b>${t.model}</b></span>` : ""}
      ${!$("#s-comp").hidden ? `<span><b>${compStage === "start" ? "COMPREHENSION CHECK (start, gate)" : "COMPREHENSION CHECK (end, flag only)"}</b></span>` : ""}
      <span class="spacer"></span>
      ${!$("#s-comp").hidden ? `<button id="d-right">fill correct</button><button id="d-wrong">fill 1 wrong</button>` : ""}
      <label><input type="checkbox" id="d-ov" ${CFG.overlay ? "checked" : ""}> overlay on photo</label>
      ${S && S.idx < SEQ.length ? `<button id="d-fill">auto-answer 10</button><button id="d-end">auto-answer all</button>` : ""}
      <button id="d-new">new participant</button>`;
    $("#d-ov").onchange = (e) => { CFG.overlay = e.target.checked; applyOverlay(); };
    const auto = (k) => { // random answers for walkthroughs
      for (let i = 0; i < k && S.idx < SEQ.length; i++) {
        const t = SEQ[S.idx]; const side = t.kind === "attention" ? t.target : Math.random() < .5 ? "L" : "R";
        cur.locked = false; choose(side, true); if (!$("#s-break").hidden) runTrial();
      }
      renderDemoBar();
    };
    const fill = (nWrong) => { COMP.forEach((c, k) => { const v = k < nWrong ? 1 : 0; const el = document.querySelector(`#f-comp input[name="${c.id}"][value="${v}"]`); if (el) el.checked = true; });
      document.querySelectorAll("#f-comp .q").forEach((q) => q.classList.remove("wrong", "missing")); };
    const dr = $("#d-right"); if (dr) dr.onclick = () => fill(0);
    const dw = $("#d-wrong"); if (dw) dw.onclick = () => fill(1);
    const f = $("#d-fill"); if (f) f.onclick = () => auto(10);
    const e = $("#d-end"); if (e) e.onclick = () => auto(1e9);
    $("#d-new").onclick = () => { if (S) store.del(key(S.pid)); location.href = location.pathname + "?demo=1"; };
  }

  // ---------- input ----------
  document.addEventListener("click", (e) => {
    const card = e.target.closest(".card"); if (card) return choose(card.dataset.side);
  });
  document.addEventListener("keydown", (e) => {
    if ($("#s-trial").hidden || e.target.matches("input")) return;
    if (e.key === "ArrowLeft" || e.key === "a") choose("L");
    else if (e.key === "ArrowRight" || e.key === "l") choose("R");
  });

  // ---------- boot ----------
  window.addEventListener("error", (e) => {
    const m = $("#err-msg"); if (m) { m.textContent = e.message; show("s-error"); }
  });
  fetch("trials.json")
    .then((r) => { if (!r.ok) throw new Error(`trials.json: HTTP ${r.status}`); return r.json(); })
    .then((d) => { DATA = d; initWelcome(); })
    .catch((err) => {
      $("#err-msg").textContent = `${err.message}. If you opened index.html directly from disk, run a local server instead: python -m http.server`;
      show("s-error");
    });
})();
