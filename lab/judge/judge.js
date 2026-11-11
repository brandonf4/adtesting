// The judge: scores a finished 5v5 draft and returns P(Radiant wins).
// P = 1 / (1 + exp(-(Σ weight × (Radiant feature − Dire feature)) / scale)).
// Features are kept readable on purpose, so you can see why it likes a draft.
'use strict';
const fs = require('fs');
const { teamFit, TAGS } = require('./archetypes');
const path = require('path');

const WEIGHTS_FILE = path.join(__dirname, 'weights.json');
const COUNTERS_FILE = path.join(__dirname, 'ability-counter-pairs.json');
const RULES_FILE = path.join(__dirname, 'note-rules.json');
const RULES = fs.existsSync(RULES_FILE) ? JSON.parse(fs.readFileSync(RULES_FILE, 'utf8')) : { pairs: [], conditional: [], models: [], counters: [] };
const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
const RULE_PAIRS = new Map((RULES.pairs || []).map(r => [pairKey(r.a, r.b), r.value]));

function loadWeights(file = WEIGHTS_FILE) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

// Ability counter pairs (from the counter list built with Brandon on
// 2026-10-12) use display names; map them to internal names.
let counterIndex = null;
function counters(engine) {
  if (counterIndex) return counterIndex;
  const byDisplay = new Map();
  for (const h of engine.lab.ALL_HEROES) {
    byDisplay.set(`${h.display_name} (model)|${h.display_name}`, h.name);
    for (const a of h.abilities) byDisplay.set(`${a.display_name}|${h.display_name}`, a.name);
  }
  counterIndex = new Map();
  const rows = fs.existsSync(COUNTERS_FILE) ? JSON.parse(fs.readFileSync(COUNTERS_FILE, 'utf8')) : [];
  for (const r of rows) {
    const a = byDisplay.get(`${r.counter}|${r.counter_hero}`), b = byDisplay.get(`${r.countered}|${r.countered_hero}`);
    if (!a || !b) continue;
    if (!counterIndex.has(a)) counterIndex.set(a, new Map());
    counterIndex.get(a).set(b, r.value);
  }
  for (const r of RULES.counters || []) {
    if (!counterIndex.has(r.counter)) counterIndex.set(r.counter, new Map());
    counterIndex.get(r.counter).set(r.countered, r.value);
  }
  return counterIndex;
}

// Brandon's note rules for one build: conditional fits, combos, and the
// logical extensions (setup for skillshots, short-range self AoE). Returns the
// total and the reasons, so the judge can say which rules fired.
function noteRules(lab, items) {
  const names = items.map(i => i.name), why = [];
  let value = 0;
  const add = (v, text) => { value += v; why.push(`${text} (${v > 0 ? '+' : ''}${v})`); };
  const model = items.find(i => i.kind === 'model');
  const [attr, attack] = (model && lab.MODEL_TYPES.get(model.name)) || [];
  const disp = n => { const i = items.find(x => x.name === n); return i && i.display ? i.display.replace(' (model)', '') : n; };
  for (const r of RULES.conditional || []) {
    if (!names.includes(r.item) || !model) continue;
    if (r.modelAttack && r.modelAttack !== attack) continue;
    if (r.modelAttr && r.modelAttr !== attr) continue;
    if ((r.unlessAny || []).some(n => names.includes(n))) continue;
    if (r.ifAny && !r.ifAny.some(n => names.includes(n))) continue;
    // Needs another item with one of these tags (e.g. Fiery Soul needs a damaging spell).
    if (r.unlessTagAny && names.some(n => n !== r.item && (TAGS[n] || []).some(t => r.unlessTagAny.includes(t)))) continue;
    add(r.value, r.from.replace(/^[^:]*: /, ''));
  }
  for (const r of RULES.models || []) if (model && model.name === r.model) add(r.value, r.from);
  for (const c of RULES.combos || []) if (c.allOf.every(n => names.includes(n))) add(c.value, `combo: ${c.allOf.map(disp).join(' + ')}`);
  const ns = RULES.needsSetup;
  if (ns) for (const n of names) {
    if (!ns.items.includes(n)) continue;
    const setup = names.some(m => m !== n && (TAGS[m] || []).some(t => ns.setupTags.includes(t)));
    if (!setup) add(ns.missing, `${disp(n)} has no disable to set it up`);
  }
  const sr = RULES.shortRangeSelfAoE;
  if (sr && model && attack === 'ranged') {
    const gap = names.some(m => (TAGS[m] || []).includes('gap'));
    for (const n of names) if (sr.items.includes(n) && !gap) add(sr.value, `${disp(n)} is short range on a ranged model with no gap close`);
  }
  return { value, why };
}

function seatFeatures(engine, items) {
  const lab = engine.lab, names = items.map(i => i.name);
  let strength = 0, synergy = 0, aghs = 0;
  for (const n of names) strength += lab.STRENGTH[n] || 0;
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) { const k = pairKey(names[i], names[j]); synergy += RULE_PAIRS.has(k) ? RULE_PAIRS.get(k) : lab.synergyBetween(names[i], names[j]); }
  for (const kind of ['scepter', 'shard']) {
    const units = lab.upgradeUnits(names, kind);
    for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) {
      if (!lab.unitsHavePairData(units[i], units[j])) aghs += lab.upgradePairValue(kind, units[i], units[j]);
    }
  }
  const notes = noteRules(lab, items).value;
  return { strength, synergy, aghs, notes };
}

function teamFeatures(engine, team, enemy, firstSeat) {
  const lab = engine.lab, f = { strength: 0, synergy: 0, aghs: 0, notes: 0 };
  for (const seat of team) { const s = seatFeatures(engine, seat); for (const k in s) f[k] += s[k]; }
  f.roleFitLost = lab.teamAssignment(firstSeat).lost;
  // Build context: archetypes, positions, needs and holes.
  const fit = teamFit(team);
  f.buildFit = fit.value;
  f.buildSeats = fit.seats;
  // Hero counters: STRATZ normal-Dota matchup of each of our models vs theirs.
  f.heroCounters = 0;
  const M = lab.HERO_MATCHUPS;
  const models = t => t.flat().filter(i => i.kind === 'model').map(i => M && M.idx.get(i.name)).filter(x => x != null);
  if (M) for (const a of models(team)) for (const b of models(enemy)) f.heroCounters += M.vs[a][b] || 0;
  // Ability counters: any of our items that counters any of theirs.
  f.abilityCounters = 0;
  const idx = counters(engine), theirs = new Set(enemy.flat().map(i => i.name));
  for (const i of team.flat()) {
    const row = idx.get(i.name);
    if (row) for (const [b, v] of row) if (theirs.has(b)) f.abilityCounters += v;
  }
  return f;
}

// Judge the engine's current (finished) draft.
function judge(engine, weights = loadWeights()) {
  const [rad, dire] = engine.finalTeams();
  const fr = teamFeatures(engine, rad, dire, 0), fd = teamFeatures(engine, dire, rad, 5);
  const diff = {};
  let z = 0;
  for (const [k, w] of Object.entries(weights.weights)) { diff[k] = (fr[k] || 0) - (fd[k] || 0); z += w * diff[k]; }
  return { pRadiant: 1 / (1 + Math.exp(-z / weights.scale)), margin: z, radiant: fr, dire: fd, diff };
}

module.exports = { judge, loadWeights, teamFeatures, seatFeatures, noteRules, RULES, WEIGHTS_FILE };
