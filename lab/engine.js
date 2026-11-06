// Runs the testing site's own draft engine and bot (public/simulator.html) in
// Node, without changing the site. The page's <script> is read at startup and
// run in a sandbox with a stub DOM, so the lab always uses exactly the bot the
// site ships: tune the site, and the lab's "current bot" follows.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PUBLIC = path.join(__dirname, '..', 'public');

// Small seeded RNG (mulberry32) so every pool and rollout can be replayed.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stubElement() {
  const el = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'value') return '0';
      if (prop === 'style' || prop === 'dataset' || prop === 'classList') return el;
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === 'children' || prop === 'childNodes') return [];
      return el;
    },
    set() { return true; },
    apply() { return el; },
  });
  return el;
}

function localFetch(url) {
  const file = url.startsWith('/') ? path.join(PUBLIC, url) : null;
  if (!file || !fs.existsSync(file)) {
    return Promise.resolve({ ok: false, json: async () => ({}) });
  }
  const body = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  return Promise.resolve({ ok: true, json: async () => body });
}

// Everything the lab reads or changes inside the page's script. `let`
// variables aren't visible from outside a script, so these accessors are
// appended to it.
const BRIDGE = `
globalThis.__lab = {
  get pool() { return pool; }, set pool(v) { pool = v; },
  get picks() { return picks; }, set picks(v) { picks = v; },
  get pickIndex() { return pickIndex; }, set pickIndex(v) { pickIndex = v; },
  get done() { return done; }, set done(v) { done = v; },
  get ALL_HEROES() { return ALL_HEROES; },
  get STRENGTH() { return STRENGTH; },
  get MODEL_TYPES() { return MODEL_TYPES; },
  get HERO_MATCHUPS() { return HERO_MATCHUPS; },
  get ABILITY_HERO() { return ABILITY_HERO; },
  resetCache() { botDecisionCache = null; },
  loadData, initDraft, botDecision, confirmPick, pickBlockedFor, currentPlayer,
  synergyBetween, shownBase, categoryOf, teamAssignment, upgradeUnits,
  unitsHavePairData, upgradePairValue, toAbilityItem, buildScore, slotsLeftFor,
  PICK_ORDER, ROLES,
};
`;

async function loadEngine({ seed = 1 } = {}) {
  const html = fs.readFileSync(path.join(PUBLIC, 'simulator.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  let src = scripts[scripts.length - 1];
  // Drop the page's own startup call; the lab loads data itself.
  src = src.replace(/loadData\(\)\.catch\([\s\S]*$/, '');
  const random = { fn: rng(seed) };
  const sandbox = {
    console, fetch: localFetch, setTimeout, clearTimeout,
    document: { getElementById: stubElement, createElement: stubElement, addEventListener() {}, querySelectorAll: () => [], querySelector: stubElement, body: stubElement() },
    window: { addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
    alert() {}, Image: function () { return stubElement(); },
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(src + BRIDGE, ctx, { filename: 'simulator.html' });
  // Seeded randomness for pool generation and everything else in the page.
  vm.runInContext('Math.random = () => __rand()', Object.assign(ctx, { __rand: () => random.fn() }));
  const lab = ctx.__lab;
  // render() touches the page; the lab never needs it.
  vm.runInContext('render = () => {}', ctx);
  await lab.loadData();
  return new Engine(lab, random);
}

class Engine {
  constructor(lab, random) { this.lab = lab; this.random = random; }
  seed(s) { this.random.fn = rng(s); }
  rand() { return this.random.fn(); }

  newDraft(seed) {
    if (seed != null) this.seed(seed);
    this.lab.initDraft();
    this.lab.resetCache();
  }
  // Pool from explicit item names (for saved scenarios): models by hero
  // name, abilities by ability name.
  setPool(names) {
    const lab = this.lab, out = [];
    for (const n of names) {
      const hero = lab.ALL_HEROES.find(h => h.name === n);
      if (hero) {
        out.push({ kind: 'model', name: hero.name, display_name: hero.display_name, hero: hero.display_name, winrateHigh: hero.modelWinrateHigh, pickPositionHigh: hero.modelPickPositionHigh, picked: false });
        continue;
      }
      const owner = lab.ALL_HEROES.find(h => h.abilities.some(a => a.name === n));
      if (!owner) throw new Error('Unknown pool item: ' + n);
      out.push(lab.toAbilityItem(owner.abilities.find(a => a.name === n), owner.display_name));
    }
    lab.pool = out;
    lab.picks = Array(10).fill(null).map(() => []);
    lab.pickIndex = 0; lab.done = false;
    lab.resetCache();
  }
  item(name) { return this.lab.pool.find(a => a.name === name); }

  get pickIndex() { return this.lab.pickIndex; }
  get done() { return this.lab.pickIndex >= this.lab.PICK_ORDER.length; }
  get seat() { return this.lab.PICK_ORDER[this.lab.pickIndex]; }
  get picks() { return this.lab.picks; }
  get pool() { return this.lab.pool; }

  available(seat = this.seat) {
    return this.lab.pool.filter(a => !a.picked && !this.lab.pickBlockedFor(seat, a));
  }
  // The site's bot decision for the seat to move (rows sorted best first).
  currentBot() {
    this.lab.resetCache();
    return this.lab.botDecision();
  }
  pick(item) {
    if (!item || item.picked) throw new Error('Bad pick: ' + (item && item.name));
    const seat = this.seat;
    item.picked = true;
    this.lab.picks[seat].push(item);
    this.lab.pickIndex++;
    this.lab.resetCache();
  }
  undo() {
    this.lab.pickIndex--;
    const item = this.lab.picks[this.lab.PICK_ORDER[this.lab.pickIndex]].pop();
    item.picked = false;
    this.lab.resetCache();
  }
  // Undo back to a saved pick index.
  rewind(to) { while (this.lab.pickIndex > to) this.undo(); }
  finalTeams() {
    return [this.lab.picks.slice(0, 5).map(p => [...p]), this.lab.picks.slice(5).map(p => [...p])];
  }
}

module.exports = { loadEngine, rng };
