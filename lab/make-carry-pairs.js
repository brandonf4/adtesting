// Builds a set of pos 1 vs pos 1 pairs from finished bot drafts, for Brandon to
// judge one build against another. Each pair carries the stand-in's call.
//   node make-carry-pairs.js --name carries-001 --pairs 25 --seed 1 runs/a.json runs/b.json > review/carries.json
// --keep old.json keeps that file's pairs (re-judged with today's judge) and
// skips their builds, so a new batch only adds new builds.
'use strict';
const fs = require('fs');
const { loadEngine, rng } = require('./engine');
const { comparePair } = require('./judge/seat-judge');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i === -1 ? d : args.splice(i, 2)[1]; };
const keep = opt('keep', null);
const name = opt('name', 'carries-001'), nPairs = +opt('pairs', 25), seed = +opt('seed', 1), pos = opt('pos', 'pos1');
(async () => {
  const engine = await loadEngine();
  const builds = [], seen = new Set();
  const kept = keep ? JSON.parse(fs.readFileSync(keep, 'utf8')) : null;
  const old = kept ? kept.pairs.map(p => ({ ...p, batch: p.batch || kept.batch, judge: comparePair(engine, p.a, p.b, p.pos || pos) })) : [];
  const keyOf = s => (Array.isArray(s[0]) ? s.flat() : s).map(x => x.name).sort().join(',');
  for (const p of old) for (const s of [p.a, p.b]) seen.add(keyOf(s));
  for (const f of args) for (const d of JSON.parse(fs.readFileSync(f, 'utf8')).drafts) {
    // Support duos: each team's two support seats, judged together.
    if (pos === 'duo') {
      for (const team of [[0, 1, 2, 3, 4], [5, 6, 7, 8, 9]]) {
        const sup = team.filter(i => d.roles[i] === 'support');
        if (sup.length !== 2) continue;
        const items = sup.map(i => d.seats[i]), key = keyOf(items);
        if (seen.has(key)) continue;
        seen.add(key);
        builds.push({ from: `${d.id}#${sup.join('+')}`, items });
      }
      continue;
    }
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
    pairs.push({ id: `${name}-${pairs.length + 1}`, batch: name, pos, a: a.items, b: b.items, from: [a.from, b.from], judge: comparePair(engine, a.items, b.items, pos) });
  }
  process.stderr.write(`${builds.length} distinct ${pos} builds, ${pairs.length} pairs\n`);
  process.stdout.write(JSON.stringify({ batch: name, pos, createdAt: new Date().toISOString(), judgeVersion: require('./judge/seat-judge').loadSeatWeights().version, pairs: [...old, ...pairs] }));
})();
