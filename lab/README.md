# AD Draft Lab

A separate workspace for teaching the simulator's bots to draft better by
playing each other, with **Brandon as the only judge**. Nothing here touches
the testing site: the deploy workflow only publishes `public/`, and the lab
reads `public/simulator.html` without changing it.

## How it works

1. **Engine** (`engine.js`) runs the site's own draft rules and bot in Node by
   loading the page's script in a sandbox. The lab's "current bot" is always
   exactly what the site ships.
2. **Look-ahead bot** (`bots.js`, `makeSearch`): at each pick it takes the
   site bot's top 8 options, plays the rest of the draft out 32 times after
   each (all ten seats, a fast, slightly random policy), scores each finished
   draft with the stand-in judge, and takes the option that did best for its team.
3. **Arena** (`arena.js`) drafts the same pools with one bot per team,
   alternating sides, and saves the finished drafts.
4. **Judging page** (`review/`, published as a private claude.ai page) shows
   each finished draft blind. Brandon picks the winner, how sure he is and
   why, and can leave general notes. Verdicts are saved with the page.
5. **Results** (`results.js`) un-blinds a batch: which bot won Brandon's
   verdicts, and how often the stand-in agreed with him.
6. **Stand-in judge** (`judge/`) exists only because the look-ahead needs to
   score thousands of imagined drafts per pick. It's a small logistic model
   over readable features (windrun strength, pair synergy, scepter/shard
   pairs, role fit, hero matchups, ability counters). `weights.json` starts
   as a hand guess (v0) and `fit-judge.js` refits it from Brandon's verdicts
   alone. It never decides whether a bot is better; Brandon's verdicts do.
7. **Scenarios** (`scenarios/`): Brandon's notes turned into replayable
   checks, e.g. "with Fury Swipes and Anchor Smash gone, take the ranged
   carry models". `scenarios.js` reports what each bot picks.

## Commands (Node 18+, from this folder)

    node arena.js --pools 20 --seed 1000 --a search --b current --out runs/batch-001.json
    node make-review-batch.js runs/batch-001.json > review/batch.json
    node results.js runs/batch-001.json judgments/batch-001.json
    node fit-judge.js runs/batch-001.json:judgments/batch-001.json
    node scenarios.js current search

A 20-pool batch takes about 10 minutes on 4 cores.

## Notes from Brandon

Brandon's notes come in through the judging page's notes box or the project
thread. Claude turns each one into a judge feature, a saved scenario, or
both, and logs it in `notes/log.md`. Notes never change the bot directly.

## Shipping

A bot change goes to the testing site only if it wins Brandon's blind
verdicts, and only after he says to deploy.
