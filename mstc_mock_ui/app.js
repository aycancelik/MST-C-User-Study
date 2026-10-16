/* MST-C heatmap comparison study: static front end (GitHub Pages friendly).
 *
 * trials.json  : canonical trial list from scripts/build_trials.py (image x model x method pair)
 * per participant (seeded by participant ID, so a reload gives the same session):
 *   - trial order shuffled, never the same photo twice in a row
 *   - left/right placement of the two methods counterbalanced (exactly half each way)
 *   - attention checks injected at CONFIG.attentionAt, target side balanced
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
  function buildSession(trials, pid) {
    const rnd = mulberry32(hash("mstc|" + pid));

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

    // attention checks: reuse a random stimulus, instruct a side
    const nA = (CFG.attentionAt || []).length;
    const targets = shuffle(Array.from({ length: nA }, (_, i) => (i % 2 ? "L" : "R")), rnd);
    (CFG.attentionAt || []).forEach((p, k) => {
      const at = Math.round(p * (seq.length + 1));
      const near = new Set([seq[at - 1], seq[at]].filter(Boolean).map((t) => t.image));
      const pool = trials.filter((t) => !near.has(t.image));
      const src = pool[Math.floor(rnd() * pool.length)];
      seq.splice(at, 0, { id: `attn${k + 1}`, kind: "attention", image: src.image, model: src.model,
        left: src.method_a, right: src.method_b, target: targets[k] });
    });
    return seq;
  }

  // ---------- state ----------
  let DATA, SEQ, S; // S = persisted session state
  const key = (pid) => `mstc-session:${pid}`;
  const save = () => store.set(key(S.pid), S);
  const src = (img, model, method) => `assets/${img}/${model}/${method}.png`;
  const photo = (img) => `assets/${img}/input.png`;

  function show(id) {
    document.querySelectorAll(".screen").forEach((s) => (s.hidden = s.id !== id));
    window.scrollTo(0, 0);
    renderDemoBar();
  }

  // ---------- welcome ----------
  function initWelcome() {
    const n = DATA.trials.length + (CFG.attentionAt || []).length;
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
      S = { pid, study_id: Q.get("STUDY_ID") || "", session_id: Q.get("SESSION_ID") || "",
        n: SEQ.length, idx: 0, started: new Date().toISOString(), responses: [], breakShown: false,
        ua: navigator.userAgent, screen: `${screen.width}x${screen.height}` };
      save();
    }
    if (S.idx >= SEQ.length) return finish();
    if (S.idx > 0) return runTrial();
    initInstructions();
  }

  // ---------- instructions (paged) ----------
  // Example uses a photo that is NOT in the trial set (assets/_example), so nobody is primed on a real trial.
  function initInstructions() {
    const ex = "assets/_example/";
    $("#mock-trial").innerHTML = `
      <img class="mock-photo" src="${ex}input.png" alt="example photo">
      <div class="mock-pair"><img src="${ex}heatmap_1.png" alt="example heatmap"><img src="${ex}heatmap_2.png" alt="example heatmap"></div>`;
    $("#i-ntrials").textContent = SEQ.length;
    const pages = [...document.querySelectorAll("#s-instr .page")];
    $("#steps").innerHTML = pages.map(() => "<i></i>").join("");
    let k = 0;
    const render = () => {
      pages.forEach((pg, i) => (pg.hidden = i !== k));
      [...$("#steps").children].forEach((d, i) => d.classList.toggle("on", i <= k));
      $("#btn-back").style.visibility = k ? "visible" : "hidden";
      $("#btn-fwd").textContent = k === pages.length - 1 ? "Start the study" : "Next";
      window.scrollTo(0, 0);
    };
    $("#btn-back").onclick = () => { if (k > 0) { k--; render(); } };
    $("#btn-fwd").onclick = () => {
      if (k < pages.length - 1) { k++; render(); return; }
      S.instrDone = new Date().toISOString(); save(); runTrial();
    };
    show("s-instr"); render();
  }

  // ---------- trial ----------
  // One click = one answer: the chosen card flashes briefly, then the next pair loads.
  let cur = null; // { t0, locked }
  function runTrial() {
    if (S.idx >= SEQ.length) return finish();
    if (CFG.breakAt && !S.breakShown && S.idx === Math.round(SEQ.length * CFG.breakAt)) {
      S.breakShown = true; save();
      $("#btn-resume").onclick = () => runTrial();
      return show("s-break");
    }
    const t = SEQ[S.idx];
    cur = { t0: 0, locked: true };
    $("#counter").textContent = `${S.idx + 1} / ${SEQ.length}`;
    $("#progress-fill").style.width = `${(100 * S.idx) / SEQ.length}%`;

    // trials are wordless; only attention checks carry an instruction
    const attn = $("#attn");
    attn.hidden = t.kind !== "attention";
    if (t.kind === "attention") attn.innerHTML = `Attention check: please click the <b>${t.target === "L" ? "left" : "right"}</b> heatmap.`;

    $(".photo").hidden = CFG.showPhoto === false;
    const imgs = [$("#img-photo"), $("#card-L .hm"), $("#card-R .hm")];
    imgs[0].src = photo(t.image);
    imgs[1].src = src(t.image, t.model, t.left);
    imgs[2].src = src(t.image, t.model, t.right);
    document.querySelectorAll(".hm-photo").forEach((im) => (im.src = photo(t.image)));
    $("#card-L .demo-label").textContent = `${t.left} · ${t.model}`;
    $("#card-R .demo-label").textContent = `${t.right} · ${t.model}`;
    applyOverlay();
    document.querySelectorAll(".card").forEach((c) => c.classList.remove("selected", "dimmed"));

    // clicks only count (and the RT clock only starts) once both heatmaps are on screen
    const c = cur;
    Promise.all(imgs.map((im) => (im.decode ? im.decode().catch(() => {}) : null)))
      .then(() => { c.t0 = performance.now(); c.locked = false; });
    show("s-trial");
    preload(S.idx + 1);
  }

  function preload(i) {
    const t = SEQ[i]; if (!t) return;
    [photo(t.image), src(t.image, t.model, t.left), src(t.image, t.model, t.right)].forEach((u) => { const im = new Image(); im.src = u; });
  }

  function choose(side, instant) {
    if (!cur || cur.locked) return;
    cur.locked = true; // ignore double clicks
    const t = SEQ[S.idx];
    S.responses.push({
      pid: S.pid, study_id: S.study_id, session_id: S.session_id,
      position: S.idx + 1, trial_id: t.id, kind: t.kind, image: t.image, model: t.model,
      left_method: t.left, right_method: t.right,
      chosen_side: side, chosen_method: side === "L" ? t.left : t.right,
      other_method: side === "L" ? t.right : t.left,
      rt_ms: cur.t0 ? Math.round(performance.now() - cur.t0) : null,
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
    $("#btn-csv").onclick = () => download(`mstc_${S.pid}.csv`, toCSV(S.responses), "text/csv");
    $("#btn-json").onclick = () => download(`mstc_${S.pid}.json`, JSON.stringify(S, null, 1), "application/json");
    if (DEMO) renderSummary();
    show("s-end");
    if (CFG.submitUrl && !S.submitted) {
      $("#end-msg").textContent = "Saving your answers…";
      try {
        const res = await fetch(CFG.submitUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(S) });
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
      <p class="muted">Attention checks passed: ${att.filter((r) => r.attention_pass === true).length} / ${att.length} · picked left side: ${(leftRate * 100).toFixed(0)}% · median RT: ${median(main.map((r) => r.rt_ms).filter(Boolean))}</p>`;
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
      ${t ? `<span>${t.kind === "attention" ? "<b>ATTENTION CHECK</b>" : `trial <b>${t.id}</b>`} · ${t.image.slice(-8)} · <b>${t.model}</b></span>` : ""}
      <span class="spacer"></span>
      <label><input type="checkbox" id="d-ov" ${CFG.overlay ? "checked" : ""}> overlay on photo</label>
      ${S && S.idx < SEQ.length ? `<button id="d-fill">auto-answer 10</button><button id="d-end">auto-answer all</button>` : ""}
      <button id="d-new">new participant</button>`;
    $("#d-ov").onchange = (e) => { CFG.overlay = e.target.checked; applyOverlay(); };
    const auto = (k) => { // random answers for walkthroughs
      for (let i = 0; i < k && S.idx < SEQ.length; i++) {
        const t = SEQ[S.idx]; const side = t.kind === "attention" ? t.target : Math.random() < .5 ? "L" : "R";
        cur.locked = false; choose(side, true); if (!$("#s-break").hidden) runTrial();
      }
    };
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
  fetch("trials.json")
    .then((r) => { if (!r.ok) throw new Error(`trials.json: HTTP ${r.status}`); return r.json(); })
    .then((d) => { DATA = d; initWelcome(); })
    .catch((err) => {
      $("#err-msg").textContent = `${err.message}. If you opened index.html directly from disk, run a local server instead: python -m http.server`;
      show("s-error");
    });
})();
