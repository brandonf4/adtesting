# Downloads every ability icon and hero portrait the lab can show, shrinks
# them, and packs them into lab/review/icons.json as data URIs (the judging
# page can't load remote images). Run by the lab-icons workflow, since Valve's
# CDN isn't reachable from Claude's environment.
import base64, json, subprocess, sys, urllib.request, os, tempfile
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
heroes = json.load(open(os.path.join(ROOT, 'public', 'heroes_abilities.json')))
AB = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/abilities/'
HE = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/'
OVERRIDES = {'kez_falcon_rush_ad': 'kez_falcon_rush', 'kez_shodo_sai_ad': 'kez_shodo_sai', 'kez_talon_toss_ad': 'kez_talon_toss', 'kez_ravens_veil_ad': 'kez_ravens_veil'}
jobs = []
for h in heroes:
    jobs.append((h['name'], HE + h['name'] + '.png', '96x54'))
    for a in h['abilities']:
        jobs.append((a['name'], AB + OVERRIDES.get(a['name'], a['name']) + '.png', '56x56'))
out, missing = {}, []
tmp = tempfile.mkdtemp()
for name, url, size in jobs:
    src, dst = os.path.join(tmp, 'in.png'), os.path.join(tmp, 'out.jpg')
    try:
        urllib.request.urlretrieve(url, src)
        subprocess.run(['convert', src, '-resize', size + '^', '-gravity', 'center', '-extent', size, '-background', '#222', '-flatten', '-quality', '82', dst], check=True)
        out[name] = 'data:image/jpeg;base64,' + base64.b64encode(open(dst, 'rb').read()).decode()
    except Exception as e:
        missing.append(name)
json.dump(out, open(os.path.join(ROOT, 'lab', 'review', 'icons.json'), 'w'))
print(f'{len(out)} icons, {len(missing)} missing: {missing}')
