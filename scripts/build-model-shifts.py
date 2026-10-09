# Builds public/model_ability_shifts.json from windrun's ability-hero-attributes export.
# Usage: python3 scripts/build-model-shifts.py <windrun-repo>/src/data public/windrun/ability-hero-attributes.json public
# For each ability: how much worse its winrate is on heroes of each primary attribute
# (str/agi/int/uni) and attack type (melee/ranged) than its overall winrate, in winrate
# points. Only clearly negative shifts are kept (more than 2 standard errors below the
# overall winrate); positive or noisy shifts are stored as 0 (omitted). The simulator
# uses these to estimate synergy for model + ability pairs missing from the pairs data.
import json, sys, math
src, attr_path, outdir = sys.argv[1:4]
def ts_obj(path, var):
    t = open(path).read(); i = t.index('export const ' + var); i = t.index('{', i)
    depth = 0
    for j in range(i, len(t)):
        if t[j] == '{': depth += 1
        elif t[j] == '}':
            depth -= 1
            if depth == 0: return json.loads(t[i:j + 1])
AB = ts_obj(src + '/abilities.ts', 'abilitiesById'); HE = ts_obj(src + '/heroes.ts', 'heroesById')
st = json.load(open(attr_path))['data']['abilityHeroAttributeStats']
ATTRS = ['str', 'agi', 'int', 'uni']; TYPES = ['melee', 'ranged']
heroes = {h['npc'].replace('npc_dota_hero_', ''): [h['primaryAttribute'], h['attackType']]
          for h in HE.values() if h.get('primaryAttribute') in ATTRS and h.get('attackType') in TYPES}
abilities = {}
for k in st['str']:
    if int(k) <= 0 or k not in AB: continue
    w = sum(st[a].get(k, {}).get('wins', 0) for a in ATTRS); n = sum(st[a].get(k, {}).get('numPicks', 0) for a in ATTRS)
    if not n: continue
    overall = w / n
    shifts = {}
    for g in ATTRS + TYPES:
        s = st[g].get(k)
        if not s or not s['numPicks']: continue
        p = s['wins'] / s['numPicks']
        se = math.sqrt(p * (1 - p) / s['numPicks'])
        if p - overall < -2 * se:
            shifts[g] = round((p - overall) * 100, 2)
    if shifts: abilities[AB[k]['shortName']] = shifts
json.dump({'heroes': heroes, 'abilities': abilities}, open(outdir + '/model_ability_shifts.json', 'w'), separators=(',', ':'))
print('heroes', len(heroes), 'abilities with a negative shift', len(abilities))
