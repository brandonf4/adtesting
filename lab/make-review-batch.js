// Strips a run file down to what the judging page shows: the finished drafts,
// with no hint of which bot played which side (the judging stays blind).
//   node make-review-batch.js runs/batch-001.json > review/batch.json
'use strict';
const fs = require('fs');
const run = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const batch = require('path').basename(process.argv[2], '.json');
const out = {
  batch,
  createdAt: run.createdAt,
  drafts: run.drafts.map(d => ({
    id: d.id,
    pool: d.pool,
    seats: d.seats,
    roles: d.roles,
    order: d.log.map(l => [l.seat, l.item]),
  })),
};
process.stdout.write(JSON.stringify(out));
