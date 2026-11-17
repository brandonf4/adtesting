// Turns pulled AD games (data/ad-games.jsonl) into judge features, so the
// judge can be tested and fit against real results.
//   node tools/ad-games-features.js > runs/ad-games-features.json
'use strict';
const fs = require('fs');
const path = require('path');
const { loadEngine } = require('../engine');
const { judge, loadWeights } = require('../judge/judge');
const { seatScore } = require('../judge/seat-judge');
const POS = ['pos1', 'mid', 'offlane', 'pos4', 'pos5'];
const perms = a => a.length < 2 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p]));
const P = perms([0, 1, 2, 3, 4]);

(async () => {
  const e = await loadEngine(), w = loadWeights();
  const H = e.lab.ALL_HEROES, heroes = new Set(H.map(h => h.name)), abil = new Set(H.flatMap(h => h.abilities.map(a => a.name)));
  const games = fs.readFileSync(path.join(__dirname, '../data/ad-games.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const out = [];
  for (const g of games) {
    const ps = [...g.players].sort((a, b) => a.slot - b.slot);
    if (ps.length !== 10 || ps.some(p => !heroes.has(p.hero))) continue;
    const seatNames = ps.map(p => [p.hero, ...p.abilities.filter(a => abil.has(a))]);
    if (seatNames.some(s => s.length < 4)) continue;
    e.setPool(seatNames.flat());
    e.lab.picks = seatNames.map(s => s.map(n => e.item(n)));
    e.lab.done = true;
    const j = judge(e, w);
    // Sum of build scores at each team's best role split.
    const team = seats => { const S = seats.map(s => POS.map(p => seatScore(e, s, p).score)); let b = -1e9; for (const p of P) b = Math.max(b, p.reduce((t, si, k) => t + S[si][k], 0)); return b; };
    const builds = team(e.lab.picks.slice(0, 5)) - team(e.lab.picks.slice(5));
    out.push({ match_id: g.match_id, patch: g.patch, radiant_win: g.radiant_win, players: ps.map(p => p.account_id), pRadiant: j.pRadiant, diff: { ...j.diff, builds } });
  }
  process.stdout.write(JSON.stringify(out));
  process.stderr.write(`${out.length} of ${games.length} games usable\n`);
})();
