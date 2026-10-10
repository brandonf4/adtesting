# Builds public/ability_strength.json from windrun's ability-values export (the
# "Strength" column on windrun's Abilities page: a win-model coefficient per ability
# or hero model, higher = stronger). Keyed by the same names heroes_abilities.json
# uses (ability shortName, hero npc name for models).
# Usage: python3 scripts/build-strength.py <windrun-repo>/src/data public/windrun/ability-values.json public
import json, sys
src, values_path, outdir = sys.argv[1:4]
def ts_obj(path, var):
    t = open(path).read(); i = t.index('export const ' + var); i = t.index('{', i)
    depth = 0
    for j in range(i, len(t)):
        if t[j] == '{': depth += 1
        elif t[j] == '}':
            depth -= 1
            if depth == 0: return json.loads(t[i:j + 1])
AB = ts_obj(src + '/abilities.ts', 'abilitiesById'); HE = ts_obj(src + '/heroes.ts', 'heroesById')
data = json.load(open(values_path))['data']
out = {}
for v in data['abilityValues']:
    i = v['abilityId']
    if i < 0:
        h = HE.get(str(-i))
        if h: out[h['npc'].replace('npc_dota_hero_', '')] = round(v['strength'], 3)
    else:
        a = AB.get(str(i))
        if a and a.get('shortName'): out[a['shortName']] = round(v['strength'], 3)
json.dump({'patch': data['model']['patch'], 'strength': out}, open(outdir + '/ability_strength.json', 'w'), separators=(',', ':'))
print('entries', len(out))
