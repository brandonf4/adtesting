// Saves a scenario from a judged draft: the pool and every pick before the
// given pick number, plus what Brandon says that pick should have been.
//   node make-scenario.js runs/batch-001.json batch-001-1001 47 shredder_timber_chain "note" [file-name]
'use strict';
const fs = require('fs');
const path = require('path');
const [runFile, id, pickStr, anyOf, note, name] = process.argv.slice(2);
const run = JSON.parse(fs.readFileSync(runFile, 'utf8'));
const d = run.drafts.find(x => x.id === id);
if (!d) throw new Error('No draft ' + id);
const pick = Number(pickStr);
const actual = d.log[pick - 1];
const sc = {
  name: `${id} pick ${pick}: P${actual.seat + 1} should take ${anyOf.split(',').join(' or ')}, not ${actual.item}`,
  note,
  source: { draft: id, pick, seat: actual.seat, pickedInDraft: actual.item, bot: (actual.seat < 5) === (d.sides.radiant === 'search') ? 'search' : 'current' },
  pool: d.pool.map(p => p.name),
  picks: d.log.slice(0, pick - 1).map(l => l.item),
  expect: { anyOf: anyOf.split(',') },
};
const file = path.join(__dirname, 'scenarios', (name || `${id}-pick-${pick}`) + '.json');
fs.writeFileSync(file, JSON.stringify(sc, null, 1) + '\n');
console.log('Saved', path.relative(process.cwd(), file));
