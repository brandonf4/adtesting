// Replays saved scenarios (from Brandon's notes) and checks what each bot picks.
//   node scenarios.js [current|search ...]
// A scenario is a JSON file in scenarios/ with:
//   name, note (Brandon's words), pool (item names: hero name = model),
//   picks (names already picked, in draft order),
//   expect: { anyOf: [names the seat on the clock should pick], noneOf: [...] }
'use strict';
const fs = require('fs');
const path = require('path');
const { loadEngine } = require('./engine');
const bots = require('./bots');

(async () => {
  const engine = await loadEngine();
  const names = process.argv.slice(2).length ? process.argv.slice(2) : ['current', 'search'];
  const dir = path.join(__dirname, 'scenarios');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  if (!files.length) { console.log('No scenarios yet.'); return; }
  let fails = 0;
  for (const f of files) {
    const sc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const name of names) {
      const bot = name === 'search' ? bots.makeSearch() : name === 'base' ? bots.baseOnly : bots.current;
      engine.setPool(sc.pool);
      for (const n of sc.picks) engine.pick(engine.item(n));
      const choice = bot(engine).name;
      const ok = (!sc.expect.anyOf || sc.expect.anyOf.includes(choice)) && !(sc.expect.noneOf || []).includes(choice);
      if (!ok) fails++;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${sc.name}  [${name}] picked ${choice}`);
    }
  }
  process.exitCode = fails ? 1 : 0;
})();
