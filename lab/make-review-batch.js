// Strips a run file down to what the judging page shows: the finished drafts,
// with no hint of which bot played which side (the judging stays blind), plus
// today's stand-in judge's call and why, shown above Brandon's verdict form.
//   node make-review-batch.js runs/batch-001.json > review/batch.json
'use strict';
const fs = require('fs');
const { loadEngine } = require('./engine');
const { judge, loadWeights } = require('./judge/judge');
const { comparePair } = require('./judge/seat-judge');
const run = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const batch = require('path').basename(process.argv[2], '.json');
const LABEL = { strength: 'stronger spells on their own', synergy: 'spells that combo better', aghs: 'better Aghanim upgrades', roleFitLost: 'a cleaner role split', heroCounters: 'better hero-model matchups', abilityCounters: 'spells that counter the other side', notes: 'your note rules', buildFit: 'builds that fit their positions better' };
const r1 = x => Math.round(x * 10) / 10;
const POS = { mid: 'Mid', pos1: 'Pos 1', offlane: 'Offlane', pos4: 'Pos 4', pos5: 'Pos 5' };

function call(j, w) {
  const pick = j.pRadiant >= 0.5 ? 'radiant' : 'dire', sign = pick === 'radiant' ? 1 : -1;
  const W = pick === 'radiant' ? 'Radiant' : 'Dire', L = pick === 'radiant' ? 'Dire' : 'Radiant';
  const parts = Object.entries(w.weights).map(([k, wt]) => [k, sign * wt * (j.diff[k] || 0)]).filter(([, v]) => Math.abs(v) >= 0.5).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
  const why = parts.map(([k, v]) => v > 0 ? `${W} has ${LABEL[k]} (+${r1(v)})` : `${L} has ${LABEL[k]} (+${r1(-v)} for ${L})`);
  const seats = side => j[side].buildSeats.map(s => ({ pos: POS[s.pos], archetype: s.label, missing: s.holes }));
  return { pick, pct: Math.round(100 * Math.max(j.pRadiant, 1 - j.pRadiant)), why, radiant: seats('radiant'), dire: seats('dire') };
}

// Position by position: the build judge's call on each matchup (pos 1 vs pos 1,
// mid vs mid, offlane vs offlane, support duo vs support duo).
const LANE = [['pos1', 'Pos 1'], ['mid', 'Mid'], ['offlane', 'Offlane'], ['duo', 'Supports']];
function lanes(engine, d) {
  const seatsOf = (team, role) => team.filter(i => d.roles[i] === role).map(i => d.seats[i]);
  const R = [0, 1, 2, 3, 4], D = [5, 6, 7, 8, 9];
  return LANE.map(([pos, label]) => {
    const role = pos === 'duo' ? 'support' : pos;
    const r = seatsOf(R, role), di = seatsOf(D, role);
    if (pos === 'duo' ? (r.length !== 2 || di.length !== 2) : (!r.length || !di.length)) return null;
    const c = comparePair(engine, pos === 'duo' ? r : r[0], pos === 'duo' ? di : di[0], pos);
    const fix = t => t.replace(/for A\)/g, 'for Radiant)').replace(/for B\)/g, 'for Dire)').replace(/^A /, 'Radiant ').replace(/^B /, 'Dire ').replace(/^A, /, 'Radiant, ').replace(/^B, /, 'Dire, ').replace(/\. B is missing/, '. Dire is missing').replace(/^A is missing/, 'Radiant is missing');
    return { pos: label, pick: c.pick === 'a' ? 'radiant' : 'dire', pct: Math.round(100 * Math.max(c.pA, 1 - c.pA)),
      radiant: c.a.archetype, dire: c.b.archetype, why: c.why.map(fix) };
  }).filter(Boolean);
}
function summary(j) {
  const W = j.pick === 'radiant' ? 'Radiant' : 'Dire';
  const won = j.lanes.filter(l => l.pick === j.pick).map(l => l.pos), lost = j.lanes.filter(l => l.pick !== j.pick).map(l => l.pos);
  const top = j.why.length ? j.why[0].replace(/ \(\+[\d.]+.*\)$/, '').replace(/^(Radiant|Dire) has /, '') : '';
  return `${W} wins (${j.pct}%). ${W} has the better ${won.length ? won.join(', ') : 'nothing position by position'}` + (lost.length ? `, and the other side has the better ${lost.join(', ')}` : '') + `. The biggest edge is ${top || 'small'}.`;
}

(async () => {
  const engine = await loadEngine(), w = loadWeights();
  const drafts = run.drafts.map(d => {
    engine.setPool(d.pool.map(p => p.name));
    for (const l of d.log) engine.pick(engine.item(l.item));
    const j = call(judge(engine, w), w);
    j.lanes = lanes(engine, d);
    j.summary = summary(j);
    return { id: d.id, pool: d.pool, seats: d.seats, roles: d.roles, order: d.log.map(l => [l.seat, l.item]), judge: j };
  });
  process.stdout.write(JSON.stringify({ batch, createdAt: run.createdAt, judgeVersion: w.version, drafts }));
})();
