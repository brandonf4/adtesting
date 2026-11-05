// Tallies Brandon's verdicts for a batch: which bot won his blind judging, and
// how often the stand-in judge agreed with him.
//   node results.js runs/batch-001.json judgments/batch-001.json
'use strict';
const fs = require('fs');
const run = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const verdicts = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const byId = new Map(run.drafts.map(d => [d.id, d]));
const { a, b } = run.bots;
let aWins = 0, bWins = 0, even = 0, skipped = 0, agree = 0, decided = 0;
const tags = {};
for (const v of verdicts) {
  const d = byId.get(v.draft);
  if (!d) continue;
  for (const t of v.tags || []) tags[t] = (tags[t] || 0) + 1;
  if (v.winner === 'skip') { skipped++; continue; }
  if (v.winner === 'even') { even++; continue; }
  const winnerBot = d.sides[v.winner];
  if (winnerBot === a) aWins++; else bWins++;
  decided++;
  if ((d.standIn.pRadiant > 0.5) === (v.winner === 'radiant')) agree++;
}
const n = aWins + bWins;
// 95% interval on A's share of decided drafts (Wilson).
const z = 1.96, p = n ? aWins / n : 0;
const den = 1 + z * z / n, mid = (p + z * z / (2 * n)) / den, half = n ? z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den : 0;
console.log(`${a} vs ${b}: ${aWins}-${bWins} (${even} even, ${skipped} can't tell)`);
if (n) console.log(`${a} wins ${(100 * p).toFixed(0)}% of decided drafts (95% range ${(100 * (mid - half)).toFixed(0)}-${(100 * (mid + half)).toFixed(0)}%)`);
if (decided) console.log(`Stand-in judge agreed with you on ${agree}/${decided} (${(100 * agree / decided).toFixed(0)}%)`);
console.log('Reason tags:', Object.entries(tags).sort((x, y) => y[1] - x[1]).map(([t, c]) => `${t} ${c}`).join(', ') || 'none');
