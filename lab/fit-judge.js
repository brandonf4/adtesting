// Refits the stand-in judge's weights from Brandon's verdicts only.
//   node fit-judge.js runs/batch-001.json:judgments/batch-001.json [more pairs...]
// Each verdict becomes a target win chance for Radiant (slight edge 0.6,
// clear win 0.8, stomp 0.95, even 0.5); "can't tell" is skipped. The fit is a
// ridge-regularized logistic regression on the stand-in's features, and it
// reports leave-one-out agreement so you can see whether it actually copies you.
'use strict';
const fs = require('fs');
const { WEIGHTS_FILE, loadWeights } = require('./judge/judge');
const TARGET = { slight: 0.6, clear: 0.8, stomp: 0.95 };
const LAMBDA = Number(process.env.LAMBDA || 0.05);

const rows = [];
for (const pair of process.argv.slice(2)) {
  const [runFile, verdictFile] = pair.split(':');
  const run = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  const byId = new Map(run.drafts.map(d => [d.id, d]));
  for (const v of JSON.parse(fs.readFileSync(verdictFile, 'utf8'))) {
    const d = byId.get(v.draft);
    if (!d || v.winner === 'skip') continue;
    const t = v.winner === 'even' ? 0.5 : (v.winner === 'radiant' ? TARGET[v.confidence] || 0.7 : 1 - (TARGET[v.confidence] || 0.7));
    rows.push({ x: d.standIn.diff, t });
  }
}
const w0 = loadWeights();
const keys = Object.keys(w0.weights);
// Standardize features so one ridge strength fits all of them.
const sd = Object.fromEntries(keys.map(k => [k, Math.sqrt(rows.reduce((s, r) => s + r.x[k] * r.x[k], 0) / Math.max(1, rows.length)) || 1]));

function fit(data) {
  const w = Object.fromEntries(keys.map(k => [k, 0]));
  for (let it = 0; it < 3000; it++) {
    const g = Object.fromEntries(keys.map(k => [k, LAMBDA * w[k]]));
    for (const r of data) {
      const z = keys.reduce((s, k) => s + w[k] * r.x[k] / sd[k], 0);
      const p = 1 / (1 + Math.exp(-z));
      for (const k of keys) g[k] += (p - r.t) * r.x[k] / sd[k] / data.length;
    }
    for (const k of keys) w[k] -= 0.5 * g[k];
  }
  return w;
}
const predict = (w, r) => 1 / (1 + Math.exp(-keys.reduce((s, k) => s + w[k] * r.x[k] / sd[k], 0)));

if (rows.length < 10) { console.log(`Only ${rows.length} verdicts; need at least 10 to refit.`); process.exit(0); }
let agree = 0, counted = 0;
rows.forEach((r, i) => {
  if (r.t === 0.5) return;
  const w = fit(rows.filter((_, j) => j !== i));
  counted++; if ((predict(w, r) > 0.5) === (r.t > 0.5)) agree++;
});
const w = fit(rows);
// Store in the judge's units: weight per raw feature, scale 1.
const out = { version: `fit-${new Date().toISOString().slice(0, 10)}`, note: `Fit to ${rows.length} of Brandon's verdicts. Leave-one-out agreement ${agree}/${counted}.`, scale: 1, weights: Object.fromEntries(keys.map(k => [k, +(w[k] / sd[k]).toFixed(5)])) };
fs.writeFileSync(WEIGHTS_FILE, JSON.stringify(out, null, 2) + '\n');
console.log(out.note);
console.log(out.weights);
