# Builds lab/data/model_stats.json: each hero model's base stats from the
# Dota game files (spirit-bear-productions/dota_vpk_updates mirror). These are
# objective facts the judge uses to decide what a model brings to a build
# (range, attack rate, move speed, armor, ...).
#   python3 lab/tools/hero-stats.py
import json, os, re, urllib.request
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
RAW = 'https://raw.githubusercontent.com/spirit-bear-productions/dota_vpk_updates/main/scripts/npc/heroes/'
KEYS = ['AttackCapabilities', 'AttackRange', 'AttackRate', 'BaseAttackSpeed', 'AttackAnimationPoint',
        'AttackDamageMin', 'AttackDamageMax', 'ProjectileSpeed', 'MovementSpeed', 'MovementTurnRate',
        'ArmorPhysical', 'MagicalResistance', 'StatusHealth', 'StatusHealthRegen', 'StatusMana',
        'AttributePrimary', 'AttributeBaseStrength', 'AttributeStrengthGain', 'AttributeBaseAgility',
        'AttributeAgilityGain', 'AttributeBaseIntelligence', 'AttributeIntelligenceGain', 'VisionNighttimeRange']

def parse(text, name):
    # Only the hero's own block (skip nested blocks such as ItemSlots).
    m = re.search(r'"' + re.escape(name) + r'"\s*\{', text)
    if not m: return {}
    i, depth, out = m.end(), 1, {}
    for line in text[i:].splitlines():
        s = line.strip()
        if s.startswith('{'): depth += 1; continue
        if s.startswith('}'):
            depth -= 1
            if depth == 0: break
            continue
        if depth == 1:
            kv = re.match(r'"(\w+)"\s+"([^"]*)"', s)
            if kv and kv.group(1) in KEYS: out[kv.group(1)] = kv.group(2)
    return out

def num(v):
    try: return float(v)
    except: return v

base = parse(urllib.request.urlopen(RAW + 'npc_dota_hero_base.txt').read().decode('utf-8', 'replace'), 'npc_dota_hero_base')
heroes = json.load(open(os.path.join(ROOT, 'public', 'heroes_abilities.json')))
stats, missing = {}, []
for h in heroes:
    n = h['name']
    try:
        own = parse(urllib.request.urlopen(RAW + f'npc_dota_hero_{n}.txt').read().decode('utf-8', 'replace'), f'npc_dota_hero_{n}')
    except Exception:
        missing.append(n); continue
    s = {k: num(v) for k, v in {**base, **own}.items()}
    s['ranged'] = 'RANGED' in str(s.get('AttackCapabilities', ''))
    s['attr'] = {'DOTA_ATTRIBUTE_STRENGTH': 'str', 'DOTA_ATTRIBUTE_AGILITY': 'agi', 'DOTA_ATTRIBUTE_INTELLECT': 'int', 'DOTA_ATTRIBUTE_ALL': 'uni'}.get(s.get('AttributePrimary'), s.get('AttributePrimary'))
    stats[n] = s
out = {'source': 'Dota game files via github.com/spirit-bear-productions/dota_vpk_updates (scripts/npc/heroes)', 'heroes': stats}
json.dump(out, open(os.path.join(ROOT, 'lab', 'data', 'model_stats.json'), 'w'), indent=1)
print(len(stats), 'heroes; missing:', missing)
