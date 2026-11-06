// Build context for the judge, as drafted with Brandon (archetypes doc,
// 2026-11-06): what each seat's build is (archetype), the job it gets in
// this draft (position), what each needs, and whether the model's stats or
// the spells cover each need. A need nobody covers is a "hole".
//
// Tags come from data/ability_tags.json (Claude's draft) with Brandon's
// corrections from the judging page (data/ability_tags_edits.json) on top.
// Model stats come from data/model_stats.json (game files).
'use strict';
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const TAGS = JSON.parse(fs.readFileSync(path.join(DATA, 'ability_tags.json'), 'utf8')).tags;
const EDITS_FILE = path.join(DATA, 'ability_tags_edits.json');
if (fs.existsSync(EDITS_FILE)) Object.assign(TAGS, JSON.parse(fs.readFileSync(EDITS_FILE, 'utf8')));
const STATS = JSON.parse(fs.readFileSync(path.join(DATA, 'model_stats.json'), 'utf8')).heroes;

const CARRY_TAGS = ['atk', 'aspd', 'orb', 'rng'];

// What a seat brings: its tags (with counts) and its model's traits.
function profile(items) {
  const model = items.find(i => i.kind === 'model');
  const s = (model && STATS[model.name]) || {};
  const tags = {};
  for (const i of items) for (const t of TAGS[i.kind === 'model' ? 'model_' + i.name : i.name] || []) tags[t] = (tags[t] || 0) + 1;
  const has = (...ts) => ts.some(t => tags[t]);
  const count = (...ts) => ts.reduce((n, t) => n + (tags[t] || 0), 0);
  const ranged = !!s.ranged;
  const tanky = s.attr === 'str' || (s.ArmorPhysical || 0) >= 3;
  const squishy = ranged && (s.attr === 'int' || s.attr === 'uni') && (s.ArmorPhysical || 0) <= 1;
  return {
    model: model && model.name, s, tags, has, count, ranged, tanky, squishy,
    slowAttacker: (s.AttackRate || 1.7) >= 1.8,
    slowMover: (s.MovementSpeed || 300) < 290,
    intModel: s.attr === 'int',
  };
}

// Each need: [label, covered?]. Strength = how much the build is this archetype.
const ARCHETYPES = {
  rightClick: {
    label: 'Right-click carry',
    strength: p => p.count(...CARRY_TAGS),
    needs: p => [
      ['attack output', p.count(...CARRY_TAGS) >= 2],
      // A melee right-clicker needs a real gap close (Brandon, batch-001-1005:
      // melee right-click is generally bad unless there's a good reason).
      ['reach (ranged, or a gap close for melee)', p.ranged || p.has('gap')],
      ['attack rate', !p.slowAttacker || p.has('aspd')],
      ['survive while attacking', p.has('def', 'sus', 'life') || p.tanky],
      ['move around', !p.slowMover || p.has('mob', 'gap')],
    ],
  },
  spellBurst: {
    label: 'Spell-burst core',
    strength: p => p.count('burst', 'dis', 'aoed', 'silence'),
    needs: p => [
      ['burst or lockdown', p.count('burst', 'dis', 'aoed', 'silence') >= 2],
      ['mana', p.intModel || p.has('mana')],
      ['wave clear', p.has('wc')],
      ['survive (escape or defense)', p.has('mob', 'def', 'life', 'invis')],
    ],
  },
  brawler: {
    label: 'Tanky melee brawler / initiator',
    strength: p => p.count('def', 'sus', 'life', 'init', 'aoed', 'gap'),
    needs: p => [
      ['initiation', p.has('init', 'gap', 'mob') && p.has('aoed', 'dis', 'init')],
      ['tankiness', p.tanky || p.has('def', 'sus', 'life')],
      ['not a squishy ranged model', !p.squishy],
      ['wave clear or lane sustain', p.has('wc', 'sus')],
    ],
  },
  meleeSupport: {
    label: 'Melee frontline support',
    strength: p => p.count('dis', 'aoed', 'gap', 'init', 'buff', 'lane', 'slow'),
    needs: p => [
      ['a way in', p.has('gap', 'invis', 'init', 'mob')],
      ['lockdown on arrival', p.has('dis', 'aoed', 'slow')],
      ['survive the dive', p.tanky || p.has('def', 'life', 'mob')],
      ['lane spell', p.has('lane', 'buff')],
      ['frontline body (melee or tanky)', !p.ranged || p.tanky],
    ],
  },
  harassSupport: {
    label: 'Ranged harass support',
    strength: p => p.count('lane', 'burst', 'dot', 'slow'),
    needs: p => [
      ['harass', p.has('lane') && p.has('burst', 'dot', 'slow')],
      ['ranged model', p.ranged],
      ['not squishy, or mobile', !p.squishy || p.has('mob')],
    ],
  },
  backlineSupport: {
    label: 'Backline support',
    strength: p => p.count('save', 'heal', 'dis', 'aoed', 'silence', 'buff'),
    needs: p => [
      ['save or disable', p.has('save', 'heal', 'dis', 'aoed', 'silence')],
      ['ranged model', p.ranged],
      ['lane spell', p.has('lane')],
    ],
  },
};

const POSITIONS = {
  mid: { label: 'Mid', archetypes: ['spellBurst', 'brawler', 'rightClick'], needs: p => [
    ['survive a solo lane', p.has('lane', 'sus', 'def', 'mob') || p.ranged],
    ['mobility', p.has('mob', 'gap', 'invis')],
    ['wave clear', p.has('wc')],
  ] },
  pos1: { label: 'Pos 1', archetypes: ['rightClick'], needs: p => [['farming speed (wave clear)', p.has('wc')]] },
  offlane: { label: 'Offlane', archetypes: ['brawler', 'spellBurst'], needs: p => [['survive the hard lane', p.has('def', 'sus', 'life', 'mob') || p.tanky]] },
  pos4: { label: 'Pos 4', archetypes: ['meleeSupport', 'harassSupport'], needs: () => [] },
  pos5: { label: 'Pos 5', archetypes: ['backlineSupport', 'meleeSupport'], needs: () => [] },
};
const SUPPORT_POS = new Set(['pos4', 'pos5']);

// Best archetype for one seat at one position.
function seatAt(p, pos) {
  let best = null;
  for (const a of POSITIONS[pos].archetypes) {
    const A = ARCHETYPES[a];
    const holes = [...A.needs(p), ...POSITIONS[pos].needs(p)].filter(([, ok]) => !ok).map(([l]) => l);
    // Carry-only spells on a support are mostly wasted.
    const waste = SUPPORT_POS.has(pos) ? p.count(...CARRY_TAGS) : 0;
    const value = Math.min(3, A.strength(p)) - holes.length - 0.5 * waste;
    if (!best || value > best.value) best = { archetype: a, label: A.label, holes, waste, value };
  }
  return best;
}

const PERMS = (() => {
  const out = [], pos = Object.keys(POSITIONS);
  const rec = (rest, acc) => { if (!rest.length) return out.push(acc); rest.forEach((x, i) => rec([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, x])); };
  rec(pos, []);
  return out;
})();

// The team's best assignment of builds to positions, and its total fit.
function teamFit(team) {
  const profs = team.map(profile);
  const cache = profs.map(p => Object.fromEntries(Object.keys(POSITIONS).map(pos => [pos, seatAt(p, pos)])));
  let best = null;
  for (const perm of PERMS) {
    const v = perm.reduce((t, pos, i) => t + cache[i][pos].value, 0);
    if (!best || v > best.value) best = { value: v, perm };
  }
  // Team checks: a melee lane-guardian pos 5 fits a ranged pos 1.
  const seats = best.perm.map((pos, i) => ({ pos, model: profs[i].model, ...cache[i][pos] }));
  const p1 = seats.findIndex(x => x.pos === 'pos1'), p5 = seats.findIndex(x => x.pos === 'pos5');
  let team_ = 0;
  if (seats[p5].archetype === 'meleeSupport' && !profs[p1].ranged) team_ -= 0.5;
  return { value: best.value + team_, seats };
}

module.exports = { teamFit, profile, ARCHETYPES, POSITIONS };
