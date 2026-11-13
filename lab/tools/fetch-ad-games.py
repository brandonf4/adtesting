#!/usr/bin/env python3
"""Pulls Ability Draft games (game_mode 18) for chosen players from OpenDota.

Reads lab/data/top-players.json ({"players": [account ids]}), lists each
player's AD games, then fetches details for games not already saved and
appends them to lab/data/ad-games.jsonl (one game per line):
  {match_id, start_time, duration, patch, radiant_win, players: [
    {slot, radiant, account_id, hero_id, hero, abilities: [names...]}]}
Abilities are the distinct ones each player leveled (their drafted spells).
The hero model is `hero`. OPENDOTA_API_KEY is used if set (optional).

  python3 lab/tools/fetch-ad-games.py --max 200
"""
import argparse, json, os, sys, time, urllib.request, urllib.error

API = 'https://api.opendota.com/api'
ROOT = os.path.join(os.path.dirname(__file__), '..', 'data')
GAMES = os.path.join(ROOT, 'ad-games.jsonl')
KEY = os.environ.get('OPENDOTA_API_KEY', '')
calls = 0


def get(path):
    global calls
    url = API + path + (('&' if '?' in path else '?') + 'api_key=' + KEY if KEY else '')
    for attempt in range(6):
        try:
            calls += 1
            req = urllib.request.Request(url, headers={'User-Agent': 'ad-draft-lab'})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.load(r)
            time.sleep(0 if KEY else 1.1)  # free tier: about 60 calls a minute
            return data
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                time.sleep(10 * (attempt + 1)); continue
            print(f'HTTP {e.code} for {path}', file=sys.stderr); return None
        except Exception as e:  # network hiccup
            print(f'{e} for {path}', file=sys.stderr); time.sleep(5 * (attempt + 1))
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--max', type=int, default=200, help='most new games to fetch this run')
    a = ap.parse_args()
    players = json.load(open(os.path.join(ROOT, 'top-players.json')))['players']
    have = set()
    if os.path.exists(GAMES):
        for line in open(GAMES):
            if line.strip(): have.add(json.loads(line)['match_id'])

    ab_ids = get('/constants/ability_ids') or {}
    heroes = get('/constants/heroes') or {}
    hero_name = {int(h['id']): h['name'].replace('npc_dota_hero_', '') for h in heroes.values()}

    todo, listed = [], {}
    for pid in players:
        ms = get(f'/players/{pid}/matches?game_mode=18') or []
        listed[pid] = len(ms)
        if not ms:  # say why: no profile, private data, or no AD games
            prof = get(f'/players/{pid}') or {}
            pr = prof.get('profile') or {}
            counts = (get(f'/players/{pid}/counts') or {}).get('game_mode', {})
            recent = get(f'/players/{pid}/matches?limit=5') or []
            print(f'{pid}: name={pr.get("personaname")!r} profile_found={bool(pr)} '
                  f'games_by_mode={ {k: v.get("games") for k, v in counts.items() if v.get("games")} } '
                  f'recent={[ (m.get("match_id"), m.get("game_mode")) for m in recent]}')
        for m in ms:
            if m['match_id'] not in have and m['match_id'] not in todo: todo.append(m['match_id'])
    todo.sort(reverse=True)  # newest first
    print('AD games listed per player:', listed, f'| new: {len(todo)}')

    added = no_abilities = 0
    with open(GAMES, 'a') as out:
        for mid in todo[:a.max]:
            m = get(f'/matches/{mid}')
            if not m or 'players' not in m: continue
            ps = []
            for p in m['players']:
                ups = p.get('ability_upgrades_arr') or []
                names = []
                for u in ups:
                    n = ab_ids.get(str(u), str(u))
                    if n not in names and not n.startswith('special_bonus'): names.append(n)
                ps.append({'slot': p.get('player_slot'), 'radiant': p.get('isRadiant', p.get('player_slot', 0) < 128),
                           'account_id': p.get('account_id'), 'hero_id': p.get('hero_id'),
                           'hero': hero_name.get(p.get('hero_id')), 'abilities': names})
            if not any(p['abilities'] for p in ps): no_abilities += 1
            out.write(json.dumps({'match_id': mid, 'start_time': m.get('start_time'), 'duration': m.get('duration'),
                                  'patch': m.get('patch'), 'radiant_win': m.get('radiant_win'), 'players': ps}) + '\n')
            added += 1
    print(f'Added {added} games ({no_abilities} with no ability data). {len(todo) - added} still to fetch. API calls: {calls}.')


if __name__ == '__main__':
    main()
