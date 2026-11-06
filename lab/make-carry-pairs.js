// Builds a set of pos 1 vs pos 1 pairs from finished bot drafts, for Brandon to
// judge one build against another. Each pair carries the stand-in's call.
//   node make-carry-pairs.js --name carries-001 --pairs 25 --seed 1 runs/a.json runs/b.json > review/carries.json
'use strict';
const fs = require('fs');
const { loadEngine, rng } = require('./engine');
const { comparePair } = require('./judge/seat-judge');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i === -1 ? d : args.splice(i, 2)[1]; };
const name = opt('name', 'carries-001'), nPairs = +opt('pairs', 25), seed = +opt('seed', 1), pos = opt('pos', 'pos1');
(async () => {
  const engine = await loadEngine();
  const builds = [], seen = new Set();
  for (const f of args) for (const d of JSON.parse(fs.readFileSync(f, 'utf8')).drafts) {
    d.seats.forEach((s, i) => {
      if (d.roles[i] !== pos) return;
      const key = s.map(x => x.name).sort().join(',');
      if (seen.has(key)) return;
      seen.add(key);
      builds.push({ from: `${d.id}#${i}`, items: s });
    });
  }
  const rand = rng(seed);
  for (let i = builds.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [builds[i], builds[j]] = [builds[j], builds[i]]; }
  const pairs = [];
  for (let i = 0; i + 1 < builds.length && pairs.length < nPairs; i += 2) {
    const a = builds[i], b = builds[i + 1];
    pairs.push({ id: `${name}-${pairs.length + 1}`, pos, a: a.items, b: b.items, from: [a.from, b.from], judge: comparePair(engine, a.items, b.items, pos) });
  }
  process.stderr.write(`${builds.length} distinct ${pos} builds, ${pairs.length} pairs\n`);
  process.stdout.write(JSON.stringify({ batch: name, pos, createdAt: new Date().toISOString(), pairs }));
})();
