// Bots the arena can pit against each other. A bot is (engine) -> item to pick
// for the seat that's on the clock.
'use strict';
const { judge, loadWeights } = require('./judge/judge');
const { rng } = require('./engine');

// Today's site bot, unchanged.
const current = engine => engine.currentBot().chosen;

// Sanity baseline: highest base value, nothing else.
function baseOnly(engine) {
  let best = null, bestV = -Infinity;
  for (const a of engine.available()) { const v = engine.lab.shownBase(a); if (v > bestV) { bestV = v; best = a; } }
  return best;
}

// Fast, slightly random policy used to finish drafts inside the search:
// base value + synergy with what the seat holds, plus noise so rollouts vary.
function rolloutPick(engine, rand, noise) {
  const lab = engine.lab, held = engine.picks[engine.seat];
  let best = null, bestV = -Infinity;
  for (const a of engine.available()) {
    let v = lab.shownBase(a);
    if (!Number.isFinite(v)) v = -50;
    for (const h of held) v += 1.5 * lab.synergyBetween(a.name, h.name);
    // Gumbel noise: picks are softmax-random around the greedy choice.
    v += -noise * Math.log(-Math.log(rand() || 1e-12));
    if (v > bestV) { bestV = v; best = a; }
  }
  return best;
}

// Look-ahead bot: take the site bot's top K options, finish the draft N times
// after each (all ten seats play the fast policy), judge every finished draft,
// and pick the option with the best average win chance for this seat's team.
// The same N rollout seeds are reused for every option, so the comparison is
// fair (differences come from the option, not luck).
function makeSearch({ k = 8, n = 32, noise = 4, weights = loadWeights(), seed = 12345 } = {}) {
  let call = 0;
  const bot = engine => {
    const seat = engine.seat, radiant = seat < 5;
    const rows = engine.currentBot().rows;
    if (rows.length <= 1) return rows[0] && rows[0].item;
    const cands = rows.slice(0, k).map(r => r.item);
    const start = engine.pickIndex;
    const base = seed + 7919 * (call++);
    let best = null, bestV = -Infinity;
    const scores = [];
    for (const c of cands) {
      engine.pick(c);
      const after = engine.pickIndex;
      let total = 0;
      for (let i = 0; i < n; i++) {
        const rand = rng(base + i);
        while (!engine.done) engine.pick(rolloutPick(engine, rand, noise));
        const p = judge(engine, weights).pRadiant;
        total += radiant ? p : 1 - p;
        engine.rewind(after);
      }
      engine.rewind(start);
      const v = total / n;
      scores.push({ name: c.name, v });
      if (v > bestV) { bestV = v; best = c; }
    }
    bot.last = { pickIndex: start, seat, scores };
    return best;
  };
  return bot;
}

module.exports = { current, baseOnly, makeSearch, rolloutPick };
