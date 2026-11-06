// Stand-in judge for one build at one position (e.g. two pos 1 builds side by
// side). Score = weights . features; features are the team judge's per-seat
// ones plus the archetype fit at that position. explain() says why, in words.
'use strict';
const fs = require('fs');
const path = require('path');
const { seatFeatures } = require('./judge');
const { profile, seatAt } = require('./archetypes');
const WEIGHTS_FILE = path.join(__dirname, 'seat-weights.json');
const loadSeatWeights = () => JSON.parse(fs.readFileSync(WEIGHTS_FILE, 'utf8'));

function seatScore(engine, items, pos, weights = loadSeatWeights()) {
  const f = seatFeatures(engine, items);
  const fit = seatAt(profile(items), pos);
  f.fit = fit.value;
  let score = 0;
  for (const [k, w] of Object.entries(weights.weights)) score += w * (f[k] || 0);
  return { score, f, fit };
}

const r1 = x => Math.round(x * 10) / 10;
const LABEL = { strength: 'stronger spells on their own', synergy: 'spells that combo better', aghs: 'better Aghanim upgrades', notes: 'your note rules', fit: 'a better fit for the role' };

// Compare build A and B at one position: who the judge picks, how sure, and why.
function comparePair(engine, a, b, pos, weights = loadSeatWeights()) {
  const A = seatScore(engine, a, pos, weights), B = seatScore(engine, b, pos, weights);
  const z = A.score - B.score;
  const pA = 1 / (1 + Math.exp(-z / weights.scale));
  const pick = z >= 0 ? 'a' : 'b';
  const W = pick === 'a' ? A : B, L = pick === 'a' ? B : A, wn = pick.toUpperCase(), ln = pick === 'a' ? 'B' : 'A';
  const parts = Object.entries(weights.weights).map(([k, w]) => [k, w * ((W.f[k] || 0) - (L.f[k] || 0))]).filter(([, v]) => Math.abs(v) >= 0.3).sort((x, y) => y[1] - x[1]);
  const why = parts.filter(([, v]) => v > 0).map(([k, v]) => `${wn} has ${LABEL[k]} (+${r1(v)})`);
  const against = parts.filter(([, v]) => v < 0).map(([k, v]) => `${ln} has ${LABEL[k]} (+${r1(-v)} for ${ln})`);
  const holes = s => s.fit.holes.length ? s.fit.holes.join(', ') : 'nothing';
  return {
    pick, pA, margin: z,
    a: { score: r1(A.score), f: Object.fromEntries(Object.entries(A.f).map(([k, v]) => [k, r1(v)])), archetype: A.fit.label, missing: A.fit.holes },
    b: { score: r1(B.score), f: Object.fromEntries(Object.entries(B.f).map(([k, v]) => [k, r1(v)])), archetype: B.fit.label, missing: B.fit.holes },
    why: [...why, ...against, `A is missing: ${holes(A)}. B is missing: ${holes(B)}.`],
  };
}

module.exports = { seatScore, comparePair, loadSeatWeights, WEIGHTS_FILE };
