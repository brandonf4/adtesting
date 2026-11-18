// Strips a run file down to what the judging page shows: the finished drafts,
// with no hint of which bot played which side (the judging stays blind), plus
// today's stand-in judge's call and why, shown above Brandon's verdict form.
//   node make-review-batch.js runs/batch-001.json > review/batch.json
'use strict';
const fs = require('fs');
const { loadEngine } = require('./engine');
const { judge, loadWeights } = require('./judge/judge');
const { comparePair, seatScore } = require('./judge/seat-judge');
const path = require('path'), os = require('os'), { spawnSync } = require('child_process');
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

// The daily learner (ml/net.py) makes the call instead once it has beaten the
// hand judge on real games neither had seen (ml/status.json says so).
const P5 = (a => { const out = []; const go = (x, r) => x.length ? x.forEach((v, i) => go([...x.slice(0, i), ...x.slice(i + 1)], [...r, v])) : out.push(r); go(a, []); return out; })([0, 1, 2, 3, 4]);
const POS5 = ['pos1', 'mid', 'offlane', 'pos4', 'pos5'];
function learnerCalls(engine, inputs) {
  let st; try { st = JSON.parse(fs.readFileSync(path.join(__dirname, 'ml/status.json'), 'utf8')); } catch { return null; }
  if (!st.in_charge) return null;
  const tmp = path.join(os.tmpdir(), `drafts-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify(inputs));
  const r = spawnSync('python3', [path.join(__dirname, 'ml/net.py'), 'predict', tmp], { encoding: 'utf8' });
  if (r.status !== 0) { process.stderr.write('learner failed, using the hand judge: ' + r.stderr.slice(-500) + '\n'); return null; }
  return { st, p: JSON.parse(r.stdout.trim().split('\n').pop()) };
}

(async () => {
  const engine = await loadEngine(), w = loadWeights();
  const inputs = [];
  const drafts = run.drafts.map(d => {
    engine.setPool(d.pool.map(p => p.name));
    for (const l of d.log) engine.pick(engine.item(l.item));
    const raw = judge(engine, w);
    const team = picks => { const S = picks.map(s => POS5.map(p => seatScore(engine, s, p).score)); let b = -1e9; for (const p of P5) b = Math.max(b, p.reduce((t, si, k) => t + S[si][k], 0)); return b; };
    const picks = engine.lab.picks;
    inputs.push({ id: d.id, diff: { ...raw.diff, builds: team(picks.slice(0, 5)) - team(picks.slice(5)) },
      seats: d.seats.map(s => [...s.filter(x => x.kind === 'model').map(x => x.name), ...s.filter(x => x.kind !== 'model').map(x => x.name)]) });
    const j = call(raw, w);
    j.lanes = lanes(engine, d);
    return { id: d.id, pool: d.pool, seats: d.seats, roles: d.roles, order: d.log.map(l => [l.seat, l.item]), judge: j };
  });
  const L = learnerCalls(engine, inputs);
  for (const d of drafts) {
    const j = d.judge;
    if (L && d.id in L.p) {
      const p = L.p[d.id], pick = p >= 0.5 ? 'radiant' : 'dire';
      j.hand = { pick: j.pick, pct: j.pct }; j.pick = pick; j.pct = Math.round(100 * Math.max(p, 1 - p)); j.by = 'learner';
      const note = ` Called by the learning model, which was right on ${Math.round(100 * L.st.learner_acc)}% of ${L.st.forward_games} unseen real games vs ${Math.round(100 * L.st.judge_acc)}% for the hand judge.`;
      j.summary = j.hand.pick === pick ? summary(j) + note
        : summary(j).replace(/ The biggest edge is .*$/, '') + note + ` The hand judge would pick ${j.hand.pick === 'radiant' ? 'Radiant' : 'Dire'}, and the reasons listed are its view.`;
    } else j.summary = summary(j);
  }
  process.stdout.write(JSON.stringify({ batch, createdAt: run.createdAt, judgeVersion: L ? 'learner+' + w.version : w.version, drafts }));
})();
