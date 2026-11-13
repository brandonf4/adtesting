// Arena: drafts pools with two bots on opposite teams and saves the finished
// drafts for Brandon to judge blind. Which side each bot played alternates by
// pool, so neither gets the snake order's advantage.
//
//   node arena.js --pools 20 --seed 1000 --a search --b current --out runs/batch-001.json
//
// Bots: current (the site bot), search (look-ahead), base (base value only).
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { fork } = require('child_process');

function args() {
  const a = { pools: 20, seed: 1000, a: 'search', b: 'current', out: null, workers: os.cpus().length, k: 8, n: 32 };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i += 2) a[v[i].replace(/^--/, '')] = isNaN(v[i + 1]) ? v[i + 1] : Number(v[i + 1]);
  return a;
}

async function runPool(engine, bots, opts, seed) {
  const { judge } = require('./judge/judge');
  engine.newDraft(seed);
  const aRadiant = seed % 2 === 0;
  const log = [];
  while (!engine.done) {
    const seat = engine.seat;
    const side = (seat < 5) === aRadiant ? 'a' : 'b';
    const bot = bots[side];
    const item = bot(engine);
    log.push({ pick: engine.pickIndex + 1, seat, item: item.name, ...(bot.last && bot.last.pickIndex === engine.pickIndex ? { options: bot.last.scores } : {}) });
    engine.pick(item);
  }
  const j = judge(engine);
  const show = it => ({ name: it.name, display: it.kind === 'model' ? `${it.display_name} (model)` : it.display_name, hero: it.hero, kind: it.kind, ult: !!it.isUlt });
  return {
    id: `${opts.tag}-${seed}`, seed,
    sides: { radiant: aRadiant ? opts.a : opts.b, dire: aRadiant ? opts.b : opts.a },
    pool: engine.pool.map(show),
    seats: engine.picks.map(p => p.map(show)),
    log,
    roles: { ...engine.lab.teamAssignment(0).roles, ...engine.lab.teamAssignment(5).roles },
    standIn: { pRadiant: j.pRadiant, diff: j.diff },
  };
}

function makeBot(name, opts) {
  const b = require('./bots');
  if (name === 'current') return b.current;
  if (name === 'base') return b.baseOnly;
  if (name === 'search') return b.makeSearch({ k: opts.k, n: opts.n });
  throw new Error('Unknown bot ' + name);
}

async function worker() {
  const { loadEngine } = require('./engine');
  const engine = await loadEngine();
  process.on('message', async ({ seed, opts }) => {
    if (seed == null) process.exit(0);
    const bots = { a: makeBot(opts.a, opts), b: makeBot(opts.b, opts) };
    process.send(await runPool(engine, bots, opts, seed));
  });
  process.send({ ready: true });
}

async function main() {
  const opts = args();
  opts.tag = opts.tag || path.basename(opts.out || 'run', '.json');
  const seeds = Array.from({ length: opts.pools }, (_, i) => opts.seed + i);
  const results = [];
  const t0 = Date.now();
  await new Promise(resolve => {
    let next = 0, live = 0;
    const n = Math.min(opts.workers, seeds.length);
    for (let w = 0; w < n; w++) {
      const child = fork(__filename, ['--worker']);
      live++;
      const feed = () => child.send(next < seeds.length ? { seed: seeds[next++], opts } : { seed: null });
      child.on('message', m => {
        if (!m.ready) { results.push(m); console.log(`  ${results.length}/${seeds.length} pools (${Math.round((Date.now() - t0) / 1000)}s)`); }
        feed();
      });
      child.on('exit', () => { if (--live === 0) resolve(); });
    }
  });
  results.sort((x, y) => x.seed - y.seed);
  const standInWinsA = results.filter(r => (r.sides.radiant === opts.a) === (r.standIn.pRadiant > 0.5)).length;
  const out = { createdAt: new Date().toISOString(), bots: { a: opts.a, b: opts.b }, settings: { k: opts.k, n: opts.n }, drafts: results };
  if (opts.out) fs.writeFileSync(opts.out, JSON.stringify(out));
  console.log(`Done in ${Math.round((Date.now() - t0) / 1000)}s. The stand-in judge (not a verdict) favors ${opts.a} in ${standInWinsA}/${results.length} drafts.`);
}

if (process.argv.includes('--worker')) worker(); else main();
