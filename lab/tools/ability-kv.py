# Reads each AD ability's damage type and spell-immunity (BKB) behavior from
# the Dota game files (spirit-bear-productions/dota_vpk_updates mirror) and
# writes lab/data/ability_kv.json.
#   python3 lab/tools/ability-kv.py
import json, os, re, urllib.request
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
RAW = 'https://raw.githubusercontent.com/spirit-bear-productions/dota_vpk_updates/main/scripts/npc/'
heroes = json.load(open(os.path.join(ROOT, 'public', 'heroes_abilities.json')))
texts = {}
def get(path):
    if path not in texts:
        try: texts[path] = urllib.request.urlopen(RAW + path).read().decode('utf-8', 'replace')
        except Exception: texts[path] = ''
    return texts[path]

def block(text, name):
    m = re.search(r'^\s*"' + re.escape(name) + r'"\s*\n\s*\{', text, re.M)
    if not m: return None
    i, depth = m.end(), 1
    j = i
    while depth and j < len(text):
        if text[j] == '{': depth += 1
        elif text[j] == '}': depth -= 1
        j += 1
    return text[i:j]

def field(b, key):
    m = re.search(r'"' + key + r'"\s+"([^"]*)"', b)
    return m.group(1) if m else None

out, missing = {}, []
for h in heroes:
    t = get(f'heroes/npc_dota_hero_{h["name"]}.txt')
    for a in h['abilities']:
        n = a['name']
        b = None
        for cand in (n, re.sub(r'_ad$', '', n)):
            b = block(t, cand) or block(get('npc_abilities.txt'), cand)
            if b: break
        if not b: missing.append(n); continue
        dmg = field(b, 'AbilityUnitDamageType') or ''
        imm = field(b, 'SpellImmunityType') or ''
        out[n] = {
            'damage': {'DAMAGE_TYPE_MAGICAL': 'magical', 'DAMAGE_TYPE_PHYSICAL': 'physical', 'DAMAGE_TYPE_PURE': 'pure'}.get(dmg.split('|')[0].strip(), None),
            'pierces': 'ENEMIES_YES' in imm,
            'raw': {'AbilityUnitDamageType': dmg, 'SpellImmunityType': imm},
        }
json.dump({'source': 'Dota game files via github.com/spirit-bear-productions/dota_vpk_updates', 'abilities': out}, open(os.path.join(ROOT, 'lab', 'data', 'ability_kv.json'), 'w'), indent=0)
print(len(out), 'abilities; missing:', missing)
