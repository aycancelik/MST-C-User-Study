/* MST-C pilot: per-participant session builder (pure logic, no DOM).
 * Works in the browser (window.MSTCSession) and in Node (require) so balance can be simulated.
 *
 * buildSession(DATA, pid, cfg) -> { seq, practice, balance }
 *   seq      : the main sequence (main trials + repeated pairs + hidden attention checks), in screen order
 *   practice : 2 practice trials (example image, not in the pool)
 *   balance  : counts for a quick sanity check (also stored with the data)
 *
 * Everything is seeded by the participant ID, so a reload rebuilds the identical session.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MSTCSession = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

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
  const pairKey = (t) => [t.method_a, t.method_b].sort().join("|");
  const inc = (o, k, d = 1) => (o[k] = (o[k] || 0) + d);
  const src = (img, model, method) => `assets/${img}/${model}/${method}.png`;

  // ---------- 1. pick the main trials ----------
  // Hard constraint: every model x method-pair cell gets the same number of trials (150 / 30 = 5).
  // Soft (swap repair): |dMSTC| bins as close to 1/3 each as the pool allows, photos spread evenly.
  function pickMain(pool, n, rnd) {
    const cells = {};
    pool.forEach((t) => (cells[t.model + "#" + pairKey(t)] = cells[t.model + "#" + pairKey(t)] || []).push(t));
    const keys = shuffle(Object.keys(cells), rnd);
    const per = Math.floor(n / keys.length), extra = n - per * keys.length;
    const quota = {}; keys.forEach((k, i) => (quota[k] = per + (i < extra ? 1 : 0)));

    const bins = { small: 0, medium: 0, large: 0 }, img = {}, imgModel = {};
    const target = n / 3;
    const add = (t, d) => { bins[t.bin] += d; inc(img, t.image, d); inc(imgModel, t.image + "#" + t.model, d); };
    const W = { bin: 40, img: 10, im: 25 };
    // marginal cost of adding t (used greedily, and as a delta in the repair)
    const addCost = (t) => W.bin * (2 * (bins[t.bin] - target) + 1) + W.img * (2 * (img[t.image] || 0) + 1)
      + W.im * (2 * (imgModel[t.image + "#" + t.model] || 0) + 1);

    const chosen = [], used = new Set();
    // greedy: round-robin over cells so early cells don't eat all the "easy" bins
    const want = { ...quota };
    for (let round = 0; chosen.length < n; round++) {
      for (const k of keys) {
        if (!want[k]) continue;
        let best = null, bc = Infinity;
        for (const t of shuffle(cells[k], rnd)) {
          if (used.has(t.id)) continue;
          const c = addCost(t);
          if (c < bc) { bc = c; best = t; }
        }
        chosen.push(best); used.add(best.id); add(best, 1); want[k]--;
      }
    }
    // repair: swap a chosen trial for an unused one from the SAME cell while it lowers the cost
    for (let pass = 0; pass < 30; pass++) {
      let improved = false;
      for (let i = 0; i < chosen.length; i++) {
        const t = chosen[i];
        add(t, -1);
        const base = addCost(t);
        let best = null, bc = base - 1e-9;
        for (const u of cells[t.model + "#" + pairKey(t)]) {
          if (used.has(u.id)) continue;
          const c = addCost(u);
          if (c < bc) { bc = c; best = u; }
        }
        if (best) { used.delete(t.id); used.add(best.id); chosen[i] = best; add(best, 1); improved = true; }
        else add(t, 1);
      }
      if (!improved) break;
    }
    return chosen;
  }

  // ---------- 2. order: no photo twice in a row ----------
  function orderNoAdjacent(items, rnd) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const left = shuffle(items, rnd), out = [];
      let ok = true;
      while (left.length) {
        const prev = out.length ? out[out.length - 1].image : null;
        // prefer photos that still have many copies left (avoids painting into a corner)
        const remaining = {}; left.forEach((t) => inc(remaining, t.image));
        const cand = left.filter((t) => t.image !== prev);
        if (!cand.length) { ok = false; break; }
        const maxR = Math.max(...cand.map((t) => remaining[t.image]));
        const top = cand.filter((t) => remaining[t.image] >= maxR - 1);
        const pick = top[Math.floor(rnd() * top.length)];
        out.push(pick); left.splice(left.indexOf(pick), 1);
      }
      if (ok) return out;
    }
    return shuffle(items, rnd);
  }

  // insert `item` near index `at` so neither neighbour shows the same photo
  function insertNear(seq, item, at, minPos) {
    const ok = (q) => q >= minPos && q <= seq.length && ![seq[q - 1], seq[q]].some((t) => t && t.image === item.image);
    for (let d = 0; d <= seq.length; d++) {
      if (ok(at + d)) { seq.splice(at + d, 0, item); return; }
      if (ok(at - d)) { seq.splice(at - d, 0, item); return; }
    }
    seq.splice(Math.max(minPos, Math.min(at, seq.length)), 0, item);
  }

  function mainItem(t, flip, k) {
    const left = flip ? t.method_a : t.method_b, right = flip ? t.method_b : t.method_a;
    const sL = flip ? t.mstc_a : t.mstc_b, sR = flip ? t.mstc_b : t.mstc_a;
    return { uid: `m${String(k + 1).padStart(3, "0")}`, kind: "main", trial_id: t.id, image: t.image, model: t.model,
      method_a: t.method_a, method_b: t.method_b, left, right, mstc_left: sL, mstc_right: sR,
      abs_delta_mstc: t.abs_delta_mstc, bin: t.bin, Lsrc: src(t.image, t.model, left), Rsrc: src(t.image, t.model, right) };
  }

  function buildSession(DATA, pid, cfg) {
    const rnd = mulberry32(hash("mstc-pilot|" + pid));
    const N = Math.min(cfg.nMain || 150, DATA.trials.length);

    // main trials, ordered, sides balanced within each third of the session
    const picked = orderNoAdjacent(pickMain(DATA.trials, N, rnd), rnd);
    const flips = [];
    for (let s = 0; s < 3; s++) {
      const a = Math.floor((s * N) / 3), b = Math.floor(((s + 1) * N) / 3);
      const half = (b - a) % 2 && rnd() < 0.5 ? Math.ceil((b - a) / 2) : Math.floor((b - a) / 2);
      flips.push(...shuffle(Array.from({ length: b - a }, (_, i) => i < half), rnd));
    }
    const main = picked.map((t, k) => mainItem(t, flips[k], k));

    // repeated pairs: same pair again, SIDES SWAPPED, `lag` main trials later.
    // Originals are stratified across the session so consistency can be read off as a function of position.
    const nRep = Math.min(cfg.nRepeats ?? 12, Math.floor(N / 10));
    const [lagMin, lagMax] = cfg.repeatLag || [30, 60];
    const after = {}; // main index -> repeats to insert after it
    if (nRep) {
      const lo = 2, hi = N - 1 - lagMin; // original main index range (0-based)
      const seg = (hi - lo) / nRep;
      for (let r = 0; r < nRep; r++) {
        const p = Math.floor(lo + r * seg + rnd() * seg);
        const lag = Math.min(lagMin + Math.floor(rnd() * (lagMax - lagMin + 1)), N - 1 - p);
        const o = main[p];
        const rep = { ...o, uid: `r${String(r + 1).padStart(2, "0")}`, kind: "repeat", repeat_of: o.uid,
          left: o.right, right: o.left, mstc_left: o.mstc_right, mstc_right: o.mstc_left, Lsrc: o.Rsrc, Rsrc: o.Lsrc };
        (after[p + lag] = after[p + lag] || []).push(rep);
      }
    }
    // insert each repeat right after main trial p+lag (searching nearby slots so no photo appears twice in a row)
    const seq = main.slice();
    Object.keys(after).map(Number).sort((a, b) => b - a).forEach((k) => {
      after[k].forEach((rep) => insertNear(seq, rep, seq.indexOf(main[k]) + 1, 1));
    });

    // hidden attention checks: real Grad-CAM vs pixel-shuffled copy; one at a random spot in each
    // tenth of the session; models rotated (4/3/3), real side 50/50.
    const nA = Math.min(cfg.attentionChecks ?? 10, (DATA.catch || []).length);
    if (nA) {
      const byModel = {};
      shuffle(DATA.catch, rnd).forEach((c) => (byModel[c.model] = byModel[c.model] || []).push(c));
      const models = shuffle(Object.keys(byModel), rnd);
      const picks = [];
      for (let k = 0; picks.length < nA && k < nA * 3; k++) { const c = byModel[models[k % models.length]].shift(); if (c) picks.push(c); }
      const sides = shuffle(picks.map((_, k) => (k % 2 ? "L" : "R")), rnd);
      const total = seq.length + picks.length, seg = total / picks.length;
      const spots = picks.map((c, k) => ({ c, k, at: Math.max(4, Math.floor(k * seg + rnd() * seg)) }));
      spots.sort((x, y) => y.at - x.at).forEach(({ c, k, at }) => {
        const realLeft = sides[k] === "L";
        insertNear(seq, { uid: `a${String(k + 1).padStart(2, "0")}`, kind: "attention", trial_id: c.id, image: c.image, model: c.model,
          target: sides[k], left: realLeft ? "gradcam_real" : "gradcam_scrambled", right: realLeft ? "gradcam_scrambled" : "gradcam_real",
          Lsrc: realLeft ? c.real : c.scrambled, Rsrc: realLeft ? c.scrambled : c.real }, Math.min(at, seq.length), 4);
      });
    }
    seq.forEach((t, i) => (t.screen = i + 1));
    let mi = 0; seq.forEach((t) => { if (t.kind === "main") t.main_index = ++mi; });
    const pos = {}; seq.forEach((t) => (pos[t.uid] = t.screen));
    seq.forEach((t) => { if (t.kind === "repeat") t.repeat_lag = t.screen - pos[t.repeat_of]; });

    // practice (example image, never analysed)
    const practice = (DATA.practice || []).map((t, k) => {
      const flip = rnd() < 0.5;
      const left = flip ? t.method_a : t.method_b, right = flip ? t.method_b : t.method_a;
      return { uid: `p${k + 1}`, kind: "practice", trial_id: t.id, image: t.image, model: t.model, left, right,
        Lsrc: src(t.image, t.model, left), Rsrc: src(t.image, t.model, right) };
    });

    return { seq, practice, balance: balanceOf(seq) };
  }

  function balanceOf(seq) {
    const m = seq.filter((t) => t.kind === "main");
    const c = { model: {}, pair: {}, bin: {}, method: {}, image: {}, left_is_a: 0 };
    m.forEach((t) => { inc(c.model, t.model); inc(c.pair, pairKey(t)); inc(c.bin, t.bin); inc(c.method, t.method_a); inc(c.method, t.method_b); inc(c.image, t.image); if (t.left === t.method_a) c.left_is_a++; });
    const imgUses = Object.values(c.image);
    const adj = seq.filter((t, i) => i && t.image === seq[i - 1].image).length;
    return { n_screens: seq.length, n_main: m.length, n_repeat: seq.filter((t) => t.kind === "repeat").length,
      n_attention: seq.filter((t) => t.kind === "attention").length, model: c.model, bin: c.bin, method: c.method,
      pair_min: Math.min(...Object.values(c.pair)), pair_max: Math.max(...Object.values(c.pair)),
      n_images: imgUses.length, image_use_min: Math.min(...imgUses), image_use_max: Math.max(...imgUses),
      left_is_method_a: c.left_is_a, same_photo_adjacent: adj,
      repeat_lags: seq.filter((t) => t.kind === "repeat").map((t) => t.repeat_lag),
      attention_screens: seq.filter((t) => t.kind === "attention").map((t) => t.screen) };
  }

  return { buildSession, hash, mulberry32, shuffle };
});
