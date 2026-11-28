"""Compares ways to predict the winner of real AD games (lab/data/ad-games.jsonl).
Fair test: train on the older 75% of games, score on the newest 25%; also
5-fold CV. Run from lab/:  python3 ml/experiment.py"""
import json, sys, numpy as np
from collections import Counter
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold
from sklearn.metrics import log_loss
import lightgbm as lgb
from scipy import sparse

STR = json.load(open(sys.argv[1] if len(sys.argv) > 1 else '/tmp/claude-0/s/strength.json'))
games = {}
import glob
for gf in sorted(glob.glob('data/ad-games*.jsonl')):
    for l in open(gf):
        if l.strip(): g = json.loads(l); games[g['match_id']] = g
F = json.load(open('runs/ad-games-features.json'))
F.sort(key=lambda f: games[f['match_id']]['start_time'])
top = set(json.load(open('data/top-players.json'))['players'])
n = len(F); y = np.array([int(f['radiant_win']) for f in F])
keys = list(F[0]['diff'].keys())
J = np.array([[f['diff'][k] for k in keys] for f in F])
known = set(STR)
def seats(f):
    g = games[f['match_id']]; ps = sorted(g['players'], key=lambda p: p['slot'])
    return [[p['hero'] + '#m'] + [a for a in p['abilities'] if a in known] for p in ps]
S = [seats(f) for f in F]
items = sorted({i for s in S for seat in s for i in seat})
ix = {k: i for i, k in enumerate(items)}
rows, cols, vals = [], [], []
for r, s in enumerate(S):
    for t, seat in enumerate(s):
        for it in seat: rows.append(r); cols.append(ix[it]); vals.append(1 if t < 5 else -1)
I = sparse.csr_matrix((vals, (rows, cols)), shape=(n, len(items)))
# Players with 5+ games get a skill term (+1 radiant, -1 dire).
pc = Counter(a for f in F for a in f['players'] if a)
pl = sorted(a for a, c in pc.items() if c >= 5); pix = {a: i for i, a in enumerate(pl)}
rows, cols, vals = [], [], []
for r, f in enumerate(F):
    for t, a in enumerate(f['players']):
        if a in pix: rows.append(r); cols.append(pix[a]); vals.append(1 if t < 5 else -1)
P = sparse.csr_matrix((vals, (rows, cols)), shape=(n, len(pl)))
topside = np.array([[sum(a in top for a in f['players'][:5]) - sum(a in top for a in f['players'][5:])] for f in F])
Jz = (J - J.mean(0)) / (J.std(0) + 1e-9)

def lr(C): return LogisticRegression(C=C, max_iter=3000)
def evaluate(name, X, model_fn, dense=False):
    cut = int(n * 0.75); res = []
    m = model_fn(); m.fit(X[:cut], y[:cut]); p = m.predict_proba(X[cut:])[:, 1]
    acc_t = ((p > .5) == y[cut:]).mean(); ll_t = log_loss(y[cut:], p)
    oof = np.zeros(n)
    for tr, te in StratifiedKFold(5, shuffle=True, random_state=1).split(np.zeros(n), y):
        m = model_fn(); m.fit(X[tr], y[tr]); oof[te] = m.predict_proba(X[te])[:, 1]
    print(f'{name:48s} newest-25%: {acc_t:.3f} (logloss {ll_t:.3f})   5-fold: {((oof > .5) == y).mean():.3f}')
    return oof

print(f'{n} games, {len(items)} items, {len(pl)} players with 5+ games, radiant wins {y.mean():.3f}')
cut = int(n * .75)
pj = np.array([f['pRadiant'] for f in F])
print(f'{"current hand-set judge":48s} newest-25%: {((pj[cut:] > .5) == y[cut:]).mean():.3f}                    all: {((pj > .5) == y).mean():.3f}')
evaluate('LR on judge features', Jz, lambda: lr(1.0))
evaluate('LR on judge features + top-player side', np.hstack([Jz, topside]), lambda: lr(1.0))
for C in [0.01, 0.03, 0.1]:
    evaluate(f'LR on picked items (C={C})', I, lambda C=C: lr(C))
X = sparse.hstack([I, sparse.csr_matrix(Jz)]).tocsr()
for C in [0.01, 0.03]:
    evaluate(f'LR items + judge features (C={C})', X, lambda C=C: lr(C))
X2 = sparse.hstack([I, sparse.csr_matrix(Jz), P]).tocsr()
for C in [0.01, 0.03]:
    evaluate(f'LR items + judge + player skill (C={C})', X2, lambda C=C: lr(C))
evaluate('LR player skill only (C=0.1)', P.tocsr(), lambda: lr(0.1))
gb = lambda: lgb.LGBMClassifier(n_estimators=300, learning_rate=0.03, num_leaves=8, min_child_samples=30, subsample=0.8, subsample_freq=1, colsample_bytree=0.8, verbose=-1)
evaluate('Gradient boosting on judge features', Jz, gb)
evaluate('Gradient boosting judge + top side', np.hstack([Jz, topside]), gb)

# --- Round 2: your tags, same-build pairs, player skill as a control ---
T = json.load(open('data/ability_tags.json'))['tags']
T.update(json.load(open('data/ability_tags_edits.json')))
tagset = sorted({t for v in T.values() for t in v})
tix = {t: i for i, t in enumerate(tagset)}
G = np.zeros((n, len(tagset)))
for r, s in enumerate(S):
    for t, seat in enumerate(s):
        for it in seat:
            key = 'model_' + it[:-2] if it.endswith('#m') else it
            for tg in T.get(key, []): G[r, tix[tg]] += 1 if t < 5 else -1
Gz = G / (G.std(0) + 1e-9)
pairc = Counter()
for s in S:
    for seat in s:
        for i in range(len(seat)):
            for j in range(i + 1, len(seat)): pairc[tuple(sorted((seat[i], seat[j])))] += 1
pairs = [p for p, c in pairc.items() if c >= 8]; pjx = {p: i for i, p in enumerate(pairs)}
rows, cols, vals = [], [], []
for r, s in enumerate(S):
    for t, seat in enumerate(s):
        for i in range(len(seat)):
            for j in range(i + 1, len(seat)):
                k = tuple(sorted((seat[i], seat[j])))
                if k in pjx: rows.append(r); cols.append(pjx[k]); vals.append(1 if t < 5 else -1)
PR = sparse.csr_matrix((vals, (rows, cols)), shape=(n, len(pairs)))
print(f'{len(tagset)} tags, {len(pairs)} same-build pairs seen 8+ times')
evaluate('LR judge + tag counts', np.hstack([Jz, Gz]), lambda: lr(0.1))
evaluate('LR judge + player skill (C=0.03)', sparse.hstack([sparse.csr_matrix(Jz), P]).tocsr(), lambda: lr(0.03))
evaluate('LR judge + tags + player skill', sparse.hstack([sparse.csr_matrix(Jz), sparse.csr_matrix(Gz * .3), P]).tocsr(), lambda: lr(0.03))
evaluate('LR judge + items + pairs + skill', sparse.hstack([sparse.csr_matrix(Jz), I, PR, P]).tocsr(), lambda: lr(0.02))
evaluate('LR judge + items + tags + skill', sparse.hstack([sparse.csr_matrix(Jz), I, sparse.csr_matrix(Gz * .3), P]).tocsr(), lambda: lr(0.02))
evaluate('Boosting judge + tags + top side', np.hstack([Jz, Gz, topside]), gb)

# Draft weights from the judge + player-skill model (skill as a control), in raw units.
m = lr(0.03); m.fit(sparse.hstack([sparse.csr_matrix(Jz), P]).tocsr(), y)
wraw = {k: m.coef_[0][i] / (J[:, i].std() + 1e-9) for i, k in enumerate(keys)}
print('draft weights with skill controlled:', {k: round(v, 5) for k, v in wraw.items()})
json.dump(wraw, open('/tmp/claude-0/s/wskill.json', 'w'))
