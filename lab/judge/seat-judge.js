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
  const W = (weights.byPos && weights.byPos[pos]) || weights.weights;
  const f = seatFeatures(engine, items);
  const fit = seatAt(profile(items), pos);
  f.fit = fit.value;
  let score = 0;
  for (const [k, w] of Object.entries(W)) score += w * (f[k] || 0);
  return { score, f, fit };
}

// A support duo: two builds, scored at their best pos 4 / pos 5 split.
function duoScore(engine, seats, weights = loadSeatWeights()) {
  let best = null;
  for (const [p0, p1] of [['pos4', 'pos5'], ['pos5', 'pos4']]) {
    const x = seatScore(engine, seats[0], p0, weights), y = seatScore(engine, seats[1], p1, weights);
    if (!best || x.score + y.score > best.score) {
      const f = {};
      for (const k of new Set([...Object.keys(x.f), ...Object.keys(y.f)])) f[k] = (x.f[k] || 0) + (y.f[k] || 0);
      const name = s => { const m = s.find(i => i.kind === 'model'); return m ? m.display.replace(' (model)', '') : '?'; };
      const lbl = (pos, s, r) => `${pos === 'pos4' ? 'Pos 4' : 'Pos 5'} ${name(s)} (${r.fit.label})`;
      const holes = [...x.fit.holes.map(h => `${name(seats[0])}: ${h}`), ...y.fit.holes.map(h => `${name(seats[1])}: ${h}`)];
      best = { score: x.score + y.score, f, fit: { label: [lbl(p0, seats[0], x), lbl(p1, seats[1], y)].join(' + '), holes } };
    }
  }
  return best;
}

const r1 = x => Math.round(x * 10) / 10;
const LABEL = { strength: 'stronger spells on their own', synergy: 'spells that combo better', aghs: 'better Aghanim upgrades', notes: 'your note rules', fit: 'a better fit for the role' };

// Compare build A and B at one position: who the judge picks, how sure, and why.
function comparePair(engine, a, b, pos, weights = loadSeatWeights()) {
  const score = (x) => pos === 'duo' ? duoScore(engine, x, weights) : seatScore(engine, x, pos, weights);
  const A = score(a), B = score(b);
  const z = A.score - B.score;
  const pA = 1 / (1 + Math.exp(-z / weights.scale));
  const pick = z >= 0 ? 'a' : 'b';
  const W = pick === 'a' ? A : B, L = pick === 'a' ? B : A, wn = pick.toUpperCase(), ln = pick === 'a' ? 'B' : 'A';
  const PW = (weights.byPos && weights.byPos[pos]) || weights.weights;
  const parts = Object.entries(PW).map(([k, w]) => [k, w * ((W.f[k] || 0) - (L.f[k] || 0))]).filter(([, v]) => Math.abs(v) >= 0.3).sort((x, y) => y[1] - x[1]);
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

module.exports = { seatScore, duoScore, comparePair, loadSeatWeights, WEIGHTS_FILE };
