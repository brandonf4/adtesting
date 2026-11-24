#!/usr/bin/env python3
"""Pulls Ability Draft games (game_mode 18) for chosen players from OpenDota.

Reads lab/data/top-players.json ({"players": [account ids]}), lists each
player's AD games, then fetches details for games not already saved and
appends them to lab/data/ad-games*.jsonl (one game per line; a new numbered
file starts when the last one passes 40 MB):
  {match_id, start_time, duration, patch, radiant_win, players: [
    {slot, radiant, account_id, hero_id, hero, abilities: [names...]}]}
Abilities are the distinct ones each player leveled (their drafted spells).
The hero model is `hero`. OPENDOTA_API_KEY is used if set (optional).

  python3 lab/tools/fetch-ad-games.py --max 200
"""
import argparse, glob, json, os, sys, time, urllib.request, urllib.error

API = 'https://api.opendota.com/api'
ROOT = os.path.join(os.path.dirname(__file__), '..', 'data')
GAMES = os.path.join(ROOT, 'ad-games.jsonl')
SHARD_MB = 40  # GitHub refuses files over 100 MB, so games go into numbered files


def game_files():
    return sorted(glob.glob(os.path.join(ROOT, 'ad-games*.jsonl')))


def out_file():
    fs = game_files()
    if not fs: return GAMES
    last = max(fs, key=lambda f: (len(f), f))
    if os.path.getsize(last) < SHARD_MB * 1e6: return last
    k = 1
    while os.path.exists(os.path.join(ROOT, f'ad-games-{k}.jsonl')): k += 1
    return os.path.join(ROOT, f'ad-games-{k}.jsonl')
LISTED = os.path.join(ROOT, 'ad-listed.json')  # each player's AD match ids from Steam
KEY = os.environ.get('OPENDOTA_API_KEY', '')
STEAM_KEY = os.environ.get('STEAM_API_KEY', '')
calls = 0
# How each build did in its game (for learning build quality, not just who won).
STATS = ['gold_per_min', 'xp_per_min', 'net_worth', 'hero_damage', 'tower_damage', 'hero_healing', 'last_hits',
         'denies', 'kills', 'deaths', 'assists', 'level', 'lane', 'lane_role', 'is_roaming', 'lane_efficiency_pct',
         'stuns', 'teamfight_participation', 'item_0', 'item_1', 'item_2', 'item_3', 'item_4', 'item_5', 'aghanims_scepter', 'aghanims_shard']
limited = 0  # calls that stayed rate-limited after every retry


def get(path):
    global calls, limited
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
                if e.code == 429 and attempt == 5:
                    limited += 1
                time.sleep(10 * (attempt + 1)); continue
            print(f'HTTP {e.code} for {path}', file=sys.stderr); return None
        except Exception as e:  # network hiccup
            print(f'{e} for {path}', file=sys.stderr); time.sleep(5 * (attempt + 1))
    return None


def steam_ad_matches(pid):
    """OpenDota leaves AD games out of player histories, so list them from Steam
    (needs STEAM_API_KEY; Steam only keeps each player's last 500 games)."""
    ids, start, fails = [], None, 0
    while True:
        url = ('https://api.steampowered.com/IDOTA2Match_570/GetMatchHistory/v1/?key=' + STEAM_KEY +
               f'&account_id={pid}&game_mode=18&matches_requested=100' + (f'&start_at_match_id={start}' if start else ''))
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'ad-draft-lab'}), timeout=60) as r:
                res = json.load(r).get('result', {})
        except Exception as e:
            fails += 1
            print(f'Steam error for {pid}: {e}', file=sys.stderr)
            if fails > 4: return None  # give up for now; try again next run
            time.sleep(30 * fails); continue
        if res.get('status') != 1:
            print(f'Steam says for {pid}: {res.get("statusDetail")}', file=sys.stderr); break
        ms = res.get('matches', [])
        ids += [m['match_id'] for m in ms if m.get('game_mode', 18) == 18]
        if not ms or res.get('results_remaining', 0) == 0: break
        start = ms[-1]['match_id'] - 1
        time.sleep(1)
    return ids


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--max', type=int, default=200, help='most new games to fetch this run')
    ap.add_argument('--discover', type=int, default=0,
                    help='also list this many new players, picked from those who show up most in saved games')
    a = ap.parse_args()
    tp = json.load(open(os.path.join(ROOT, 'top-players.json')))
    players = list(tp['players'])
    have = set(); seen_with = {}
    for gf in game_files():
        for line in open(gf):
            if line.strip():
                g = json.loads(line); have.add(g['match_id'])
                for p in g['players']:
                    acc = p.get('account_id')
                    if acc and acc != 4294967295: seen_with[acc] = seen_with.get(acc, 0) + 1
    # Discovered players: everyone already listed, plus the most frequent new faces (3+ games).
    # Players whose Steam history is hidden come back with no games and are not tried again.
    cache0 = json.load(open(LISTED)) if os.path.exists(LISTED) else {}
    skip = set(players) | set(tp.get('private', []))
    found = [int(k) for k in cache0 if int(k) not in skip]
    fresh = sorted((acc for acc, c in seen_with.items() if c >= 3 and acc not in skip and str(acc) not in cache0),
                   key=lambda acc: -seen_with[acc])[:a.discover]
    players += found + fresh

    ab_ids = get('/constants/ability_ids') or {}
    heroes = get('/constants/heroes') or {}
    hero_name = {int(h['id']): h['name'].replace('npc_dota_hero_', '') for h in heroes.values()}

    for mid in json.load(open(os.path.join(ROOT, 'top-players.json'))).get('probe_matches', []):
        d = get(f'/matches/{mid}') or {}
        print('probe match', mid, 'mode', d.get('game_mode'), 'lobby', d.get('lobby_type'), 'patch', d.get('patch'), 'radiant_win', d.get('radiant_win'))
        for p in d.get('players') or []:
            print('   ', p.get('account_id'), hero_name.get(p.get('hero_id')), [ab_ids.get(str(u), u) for u in dict.fromkeys(p.get('ability_upgrades_arr') or [])])

    listed_cache = json.load(open(LISTED)) if os.path.exists(LISTED) else {}
    todo, listed = [], {}
    for pid in players:
        if STEAM_KEY:
            # Each player's list is fetched once a week at most (Steam rate-limits).
            c = listed_cache.get(str(pid))
            stale = 7 * 86400 if pid in tp['players'] else 30 * 86400  # discovered players: monthly
            if not c or time.time() - c['at'] > stale:
                got = steam_ad_matches(pid)
                if got is not None:
                    c = listed_cache[str(pid)] = {'at': int(time.time()), 'ids': got}
                    json.dump(listed_cache, open(LISTED, 'w'))
                time.sleep(2)
            ms = [{'match_id': m} for m in (c['ids'] if c else [])]
        else:
            ms = get(f'/players/{pid}/matches?game_mode=18') or []
        listed[pid] = len(ms)
        if not ms and not STEAM_KEY:  # say why: no profile, private data, or no AD games
            prof = get(f'/players/{pid}') or {}
            pr = prof.get('profile') or {}
            counts = (get(f'/players/{pid}/counts') or {}).get('game_mode', {})
            recent = get(f'/players/{pid}/matches?limit=5') or []
            print(f'{pid}: name={pr.get("personaname")!r} profile_found={bool(pr)} '
                  f'games_by_mode={ {k: v.get("games") for k, v in counts.items() if v.get("games")} } '
                  f'recent={[ (m.get("match_id"), m.get("game_mode")) for m in recent]}')
            if recent:  # show one recent game's picks, to see what mode it really is
                d = get(f'/matches/{recent[0]["match_id"]}') or {}
                print('  sample game', d.get('match_id'), 'mode', d.get('game_mode'), 'lobby', d.get('lobby_type'))
                for p in (d.get('players') or [])[:3]:
                    print('   ', hero_name.get(p.get('hero_id')), [ab_ids.get(str(u), u) for u in dict.fromkeys(p.get('ability_upgrades_arr') or [])])
        for m in ms:
            if m['match_id'] not in have and m['match_id'] not in todo: todo.append(m['match_id'])
    for mid in json.load(open(os.path.join(ROOT, 'top-players.json'))).get('matches', []):
        if mid not in have and mid not in todo: todo.append(mid)
    todo.sort(reverse=True)  # newest first
    unlisted = sum(1 for pid in players if STEAM_KEY and str(pid) not in listed_cache)
    print('AD games listed per top player:', {p: listed[p] for p in tp['players'] if p in listed},
          f'| players listed: {len(listed)} ({len(fresh)} newly discovered) | new: {len(todo)} | unlisted: {unlisted}')

    added = no_abilities = 0
    with open(out_file(), 'a') as out:
        for mid in todo[:a.max]:
            if limited >= 3:  # OpenDota's limit for today is used up; stop and let training run
                print('OpenDota keeps refusing (rate limit); stopping this run early.'); break
            m = get(f'/matches/{mid}')
            if not m or 'players' not in m: continue
            ps = []
            for p in m['players']:
                ups = p.get('ability_upgrades_arr') or []
                names = []
                for u in ups:
                    n = ab_ids.get(str(u), str(u))
                    if n not in names and not n.startswith(('special_bonus', 'ad_special_bonus')): names.append(n)
                ps.append({'slot': p.get('player_slot'), 'radiant': p.get('isRadiant', p.get('player_slot', 0) < 128),
                           'account_id': p.get('account_id'), 'hero_id': p.get('hero_id'),
                           'hero': hero_name.get(p.get('hero_id')), 'abilities': names,
                           'stats': {k: p.get(k) for k in STATS}})
            if not any(p['abilities'] for p in ps): no_abilities += 1
            out.write(json.dumps({'match_id': mid, 'start_time': m.get('start_time'), 'duration': m.get('duration'),
                                  'patch': m.get('patch'), 'radiant_win': m.get('radiant_win'), 'players': ps}) + '\n')
            out.flush()
            added += 1
    print(f'Added {added} games ({no_abilities} with no ability data). {len(todo) - added} still to fetch. API calls: {calls}.')


if __name__ == '__main__':
    main()
