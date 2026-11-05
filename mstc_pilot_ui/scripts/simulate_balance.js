// Check per-participant balance over many simulated IDs:  node scripts/simulate_balance.js [n]
const fs = require("fs"), path = require("path");
const { buildSession } = require("../session.js");
global.window = {}; require("../config.js"); const cfg = window.STUDY_CONFIG;
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "trials.json")));
const n = +process.argv[2] || 300, agg = {}, cover = {};
const t0 = Date.now();
let worst = { bin: 0, img: 0, adj: 0 };
for (let i = 0; i < n; i++) {
  const { seq, balance: b } = buildSession(DATA, "sim-" + i, cfg);
  seq.filter((t) => t.kind === "main").forEach((t) => (cover[t.trial_id] = (cover[t.trial_id] || 0) + 1));
  const dev = Math.max(...["small", "medium", "large"].map((k) => Math.abs((b.bin[k] || 0) - b.n_main / 3)));
  worst = { bin: Math.max(worst.bin, dev), img: Math.max(worst.img, b.image_use_max), adj: Math.max(worst.adj, b.same_photo_adjacent) };
  for (const k of ["n_screens", "pair_min", "pair_max", "image_use_min", "image_use_max", "left_is_method_a"]) (agg[k] = agg[k] || new Set()).add(b[k]);
  if (i === 0) console.log("example participant:", JSON.stringify(b));
}
console.log(`${n} participants in ${((Date.now() - t0) / n).toFixed(1)} ms each`);
for (const k in agg) console.log(k.padEnd(18), [...agg[k]].sort((a, b) => a - b).join(","));
console.log("worst |bin - n/3| :", worst.bin, " max image use:", worst.img, " adjacent same photo:", worst.adj);
const c = Object.values(cover);
console.log(`pool coverage: ${c.length}/${DATA.trials.length} trials used at least once`);
