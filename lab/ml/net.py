"""Neural draft model: learns embeddings for every spell and hero model, how they
combine inside one build (attention over the build's items), and how the ten
builds interact (attention across seats, both teams). Player skill is a separate
per-account term so the draft part learns the draft, not who was playing.

logit(Radiant wins) = g(Radiant, Dire) - g(Dire, Radiant)   (side-swap symmetric)
                      + linear(judge features) + bias
                      + sum(skill of Radiant players) - sum(skill of Dire players)

Run from lab/:
  python3 ml/net.py eval            # newest-25% test + 5-fold, compares to LR
  python3 ml/net.py train           # train on everything, save ml/model.pt
  python3 ml/net.py train --warm    # continue from ml/model.pt (daily update)
"""
import json, sys, os, glob, math, random, argparse, time
import numpy as np, torch, torch.nn as nn, torch.nn.functional as Fn
from collections import Counter

torch.set_num_threads(os.cpu_count() or 4)
HERE = os.path.dirname(os.path.abspath(__file__))
LAB = os.path.join(HERE, '..')
MODEL = os.path.join(HERE, 'model.pt')
MAXI = 6  # model + up to 5 abilities per seat
CFG = dict(d=32, drop=0.3, skill=True)
FIT = dict(wd=1e-2, skill_wd=3e-3)
VERDICT_WEIGHT = 20.0  # one of Brandon's verdicts counts as much as 20 real games


def load():
    games = {}
    for gf in sorted(glob.glob(os.path.join(LAB, 'data/ad-games*.jsonl'))):
        for l in open(gf):
            if l.strip():
                g = json.loads(l); games[g['match_id']] = g
    F = json.load(open(os.path.join(LAB, 'runs/ad-games-features.json')))
    F = [f for f in F if f['match_id'] in games]
    F.sort(key=lambda f: games[f['match_id']]['start_time'])
    return games, F


def load_verdicts(games):
    """Brandon's team verdicts as extra games (no players, no judge features).
    Adds them to `games` and returns their feature rows."""
    out = []
    for b in ['batch-001', 'batch-002']:
        try:
            run = json.load(open(os.path.join(LAB, f'runs/{b}.json')))
            vs = json.load(open(os.path.join(LAB, f'judgments/{b}.json')))
        except FileNotFoundError:
            continue
        by = {d['id']: d for d in run['drafts']}
        for v in vs:
            if v['winner'] not in ('radiant', 'dire') or v['draft'] not in by: continue
            d = by[v['draft']]; ps = []
            for i, seat in enumerate(d['seats']):
                model = next((x['name'] for x in seat if x['kind'] == 'model'), '?')
                ps.append(dict(slot=i if i < 5 else 128 + i - 5, account_id=None, hero=model,
                               abilities=[x['name'] for x in seat if x['kind'] != 'model']))
            mid = 'v:' + v['draft']
            games[mid] = dict(match_id=mid, start_time=0, players=ps)
            out.append(dict(match_id=mid, radiant_win=v['winner'] == 'radiant', verdict=True, players=[None] * 10))
    return out


class Vocab:
    def __init__(self, items=None, players=None, keys=None, mu=None, sd=None):
        self.items = items or ['<pad>', '<unk>']; self.players = players or ['<unk>']
        self.keys, self.mu, self.sd = keys, mu, sd
        self.ix = {k: i for i, k in enumerate(self.items)}; self.px = {k: i for i, k in enumerate(self.players)}

    @staticmethod
    def build(games, F, min_item=5, min_player=5):
        ic, pc = Counter(), Counter()
        for f in F:
            g = games[f['match_id']]
            for p in g['players']:
                ic[p['hero'] + '#m'] += 1; ic.update(p['abilities'])
                if p['account_id']: pc[p['account_id']] += 1
        items = ['<pad>', '<unk>'] + sorted(k for k, c in ic.items() if c >= min_item)
        players = ['<unk>'] + sorted(a for a, c in pc.items() if c >= min_player)
        keys = list(F[0]['diff'].keys())
        J = np.array([[f['diff'][k] for k in keys] for f in F])
        return Vocab(items, players, keys, J.mean(0).tolist(), (J.std(0) + 1e-9).tolist())

    def grow(self, games, F, min_item=5, min_player=5):
        """Adds new spells/players seen since the last training (for warm starts)."""
        new = Vocab.build(games, F, min_item, min_player)
        for k in new.items:
            if k not in self.ix: self.ix[k] = len(self.items); self.items.append(k)
        for k in new.players:
            if k not in self.px: self.px[k] = len(self.players); self.players.append(k)

    def encode(self, games, F):
        n = len(F)
        I = np.zeros((n, 10, MAXI), dtype=np.int64); P = np.zeros((n, 10), dtype=np.int64)
        J = np.zeros((n, len(self.keys)), dtype=np.float32); y = np.zeros(n, dtype=np.float32)
        for r, f in enumerate(F):
            g = games[f['match_id']]
            ps = sorted(g['players'], key=lambda p: p['slot'])
            for s, p in enumerate(ps[:10]):
                toks = [p['hero'] + '#m'] + p['abilities']
                for t, k in enumerate(toks[:MAXI]): I[r, s, t] = self.ix.get(k, 1)
                P[r, s] = self.px.get(p['account_id'], 0)
            if not f.get('verdict'): J[r] = (np.array([f['diff'][k] for k in self.keys]) - self.mu) / self.sd
            y[r] = float(f['radiant_win'])
        return torch.tensor(I), torch.tensor(P), torch.tensor(J), torch.tensor(y)

    def state(self): return dict(items=self.items, players=self.players, keys=self.keys, mu=self.mu, sd=self.sd)


class DraftNet(nn.Module):
    def __init__(self, n_items, n_players, n_feat, d=32, heads=4, drop=0.3, skill=True):
        super().__init__()
        self.d = d
        self.emb = nn.Embedding(n_items, d, padding_idx=0)
        self.slot = nn.Parameter(torch.zeros(MAXI, d))  # marks the model token vs spells
        self.build = nn.TransformerEncoder(nn.TransformerEncoderLayer(d, heads, 2 * d, drop, batch_first=True), 1)
        self.side = nn.Parameter(torch.randn(2, d) * .02)  # own team vs enemy team
        self.game = nn.TransformerEncoder(nn.TransformerEncoderLayer(d, heads, 2 * d, drop, batch_first=True), 1)
        self.head = nn.Sequential(nn.Linear(d, d), nn.GELU(), nn.Dropout(drop), nn.Linear(d, 1))
        self.lin = nn.Linear(n_feat, 1)
        self.skill = nn.Embedding(n_players, 1) if skill else None
        if skill: nn.init.zeros_(self.skill.weight)
        self.drop = drop

    def grow(self, n_items, n_players):
        def ext(e, n):
            if e is None or n <= e.num_embeddings: return e
            w = torch.zeros(n, e.embedding_dim); w[:e.num_embeddings] = e.weight.data
            if e.embedding_dim > 1: w[e.num_embeddings:] = torch.randn(n - e.num_embeddings, e.embedding_dim) * .02
            new = nn.Embedding(n, e.embedding_dim, padding_idx=e.padding_idx); new.weight.data = w; return new
        self.emb = ext(self.emb, n_items); self.skill = ext(self.skill, n_players)

    def seats(self, I):  # I: (b,10,MAXI) -> (b,10,d)
        b = I.shape[0]; x = I.view(b * 10, MAXI)
        mask = x == 0
        h = self.emb(x) + self.slot
        if self.training and self.drop:  # spell dropout: hide a random spell now and then
            keep = (torch.rand(x.shape) > 0.1) | (torch.arange(MAXI) == 0)
            mask = mask | ~keep
        h = self.build(h, src_key_padding_mask=mask)
        h = (h * (~mask).unsqueeze(-1)).sum(1) / (~mask).sum(1, keepdim=True).clamp(min=1)
        return h.view(b, 10, self.d)

    def g(self, S):  # S: (b,10,d) with own team in 0..4
        x = S + torch.cat([self.side[0].expand(5, -1), self.side[1].expand(5, -1)], 0)
        h = self.game(x)
        return self.head(h[:, :5].mean(1)).squeeze(-1)

    def forward(self, I, P, J, draft_only=False):
        S = self.seats(I)
        swap = torch.cat([S[:, 5:], S[:, :5]], 1)
        z = self.g(S) - self.g(swap) + self.lin(J).squeeze(-1)
        if self.skill is not None and not draft_only:
            k = self.skill(P).squeeze(-1)
            z = z + k[:, :5].sum(1) - k[:, 5:].sum(1)
        return z


def augment(I, P, J, y):
    """Shuffle seat order inside each team; swap sides half the time (flip label + features)."""
    b = I.shape[0]
    perm = torch.stack([torch.cat([torch.randperm(5), torch.randperm(5) + 5]) for _ in range(b)])
    I = torch.gather(I, 1, perm.unsqueeze(-1).expand(-1, -1, MAXI)); P = torch.gather(P, 1, perm)
    sw = torch.rand(b) < .5
    I2 = torch.where(sw.view(b, 1, 1), torch.cat([I[:, 5:], I[:, :5]], 1), I)
    P2 = torch.where(sw.view(b, 1), torch.cat([P[:, 5:], P[:, :5]], 1), P)
    J2 = torch.where(sw.view(b, 1), -J, J); y2 = torch.where(sw, 1 - y, y)
    # the bias (Radiant edge) can't be flipped by a feature swap, so it's learned from unswapped games
    return I2, P2, J2, y2, sw


def fit(net, data, idx_tr, idx_va=None, epochs=40, lr=2e-3, wd=1e-2, skill_wd=3e-3, bs=128, weights=None, quiet=False):
    I, P, J, y = data
    bias = nn.Parameter(net.bias.clone() if isinstance(getattr(net, "bias", None), torch.Tensor) else torch.zeros(1))
    groups = [{'params': [p for n_, p in net.named_parameters() if not n_.startswith('skill')], 'weight_decay': wd},
              {'params': [bias], 'weight_decay': 0}]
    if net.skill is not None: groups.append({'params': net.skill.parameters(), 'weight_decay': 0})
    opt = torch.optim.AdamW(groups, lr=lr)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=lr, total_steps=epochs * math.ceil(len(idx_tr) / bs))
    best, best_state, bad = 1e9, None, 0
    w_all = weights if weights is not None else torch.ones(len(y))
    for ep in range(epochs):
        net.train(); perm = idx_tr[torch.randperm(len(idx_tr))]
        for s in range(0, len(perm), bs):
            b = perm[s:s + bs]
            Ib, Pb, Jb, yb, sw = augment(I[b], P[b], J[b], y[b])
            z = net(Ib, Pb, Jb) + torch.where(sw, -bias, bias)
            loss = (Fn.binary_cross_entropy_with_logits(z, yb, reduction='none') * w_all[b]).mean()
            if net.skill is not None: loss = loss + skill_wd * (net.skill(Pb) ** 2).mean()
            opt.zero_grad(); loss.backward(); opt.step(); sched.step()
        if idx_va is not None:
            ll, acc = score(net, data, idx_va, bias)
            if not quiet and (ep % 5 == 4 or ep == epochs - 1): print(f'   epoch {ep + 1}: val logloss {ll:.4f} acc {acc:.3f}')
            if ll < best - 1e-4: best, bad, best_state = ll, 0, ({k: v.clone() for k, v in net.state_dict().items()}, bias.data.clone())
            else:
                bad += 1
                if bad >= 8: break
    if best_state: net.load_state_dict(best_state[0]); bias.data = best_state[1]
    net.bias = bias.data
    return net


@torch.no_grad()
def predict(net, data, idx, bias=None, draft_only=False):
    net.eval(); I, P, J, y = data
    b = net.bias if bias is None else bias.data
    return torch.sigmoid(net(I[idx], P[idx], J[idx], draft_only) + b)


def score(net, data, idx, bias=None):
    p = predict(net, data, idx, bias).clamp(1e-6, 1 - 1e-6); y = data[3][idx]
    return float(Fn.binary_cross_entropy(p, y)), float(((p > .5).float() == y).float().mean())


def make(v, **kw): return DraftNet(len(v.items), len(v.players), len(v.keys), **kw)


def run_eval(args):
    games, F = load(); n = len(F)
    print(f'{n} games')
    for cfg in [dict(d=32, skill=True), dict(d=32, skill=False)]:
        torch.manual_seed(0); random.seed(0); np.random.seed(0)
        cut = int(n * .75)
        # Vocab from training games only, so the test set holds real unknowns.
        v = Vocab.build(games, F[:cut]); data = v.encode(games, F)
        va = int(cut * .9)
        net = fit(make(v, **cfg), data, torch.arange(va), torch.arange(va, cut), epochs=args.epochs, quiet=True)
        # refit on all training games for the found number of epochs is skipped: early-stopped net is used as is
        ll, acc = score(net, data, torch.arange(cut, n))
        V = load_verdicts(games)
        if V:
            dv = v.encode(games, V); pv = predict(net, dv, torch.arange(len(V)), draft_only=True)
            print(f'   agrees with {int(((pv > .5).float() == dv[3]).sum())} of your {len(V)} team verdicts (never trained on them)')
        name = 'net draft + skill' if cfg['skill'] else 'net draft only'
        line = f'{name:28s} newest-25%: {acc:.3f} (logloss {ll:.3f})'
        if args.folds:
            ok = 0; idx = np.random.RandomState(1).permutation(n)
            for k in range(5):
                te = idx[k::5]; tr = np.setdiff1d(idx, te)
                v = Vocab.build(games, [F[i] for i in tr]); data = v.encode(games, F)
                trt = torch.tensor(tr[torch.randperm(len(tr)).numpy()]); m = int(len(trt) * .9)
                net = fit(make(v, **cfg), data, trt[:m], trt[m:], epochs=args.epochs, quiet=True)
                p = predict(net, data, torch.tensor(te)); ok += int(((p > .5).float() == data[3][te]).sum())
            line += f'   5-fold: {ok / n:.3f}'
        print(line, flush=True)


def run_train(args):
    """Daily update. With --warm, first scores the saved model on games it has never
    seen (a true forward test, logged to ml/history.json), then keeps training it."""
    games, F = load(); V = load_verdicts(games)
    if args.limit: F = F[:args.limit]  # train on the oldest N games only (to test the daily loop)
    ck = torch.load(MODEL, weights_only=False) if args.warm and os.path.exists(MODEL) else None
    hist = ck.get('history', []) if ck else []
    if ck:
        v = Vocab(**ck['vocab']); net = make(v, **ck['cfg']); net.load_state_dict(ck['state']); net.bias = ck['bias']
        seen = set(ck['seen']); new = [f for f in F if f['match_id'] not in seen]
        if new:
            dn = v.encode(games, new)  # spells/players it has never seen count as unknown
            ll, acc = score(net, dn, torch.arange(len(new)))
            # Draft-only calls (what the judging page needs: no players) vs the hand-set judge.
            pd = predict(net, dn, torch.arange(len(new)), draft_only=True)
            draft_ok = int(((pd > .5).float() == dn[3]).sum())
            judge_ok = sum((f['pRadiant'] > .5) == bool(f['radiant_win']) for f in new)
            entry = dict(date=time.strftime('%Y-%m-%d'), trained_on=ck['at_games'], new_games=len(new),
                         forward_acc=round(acc, 4), forward_logloss=round(ll, 4),
                         draft_only_acc=round(draft_ok / len(new), 4), judge_acc=round(judge_ok / len(new), 4))
            print('forward test on new games:', entry); hist.append(entry)
        v.grow(games, F); net.grow(len(v.items), len(v.players))
        cfg, lr, epochs = ck['cfg'], 5e-4, max(10, args.epochs // 2)
    else:
        v = Vocab.build(games, F); cfg = CFG; net = make(v, **cfg); lr, epochs = 2e-3, args.epochs
    allF = F + V; data = v.encode(games, allF); n = len(F)
    w = torch.ones(len(allF)); w[n:] = VERDICT_WEIGHT
    m = int(n * .92); idx = torch.arange(n)  # newest 8% held back to decide when to stop
    tr = torch.cat([idx[:m], torch.arange(n, len(allF))])
    torch.manual_seed(0)
    net = fit(net, data, tr, idx[m:], epochs=epochs, lr=lr, weights=w, **FIT)
    ll, acc = score(net, data, idx[m:])
    agree = int(((predict(net, data, torch.arange(n, len(allF)), draft_only=True) > .5).float() == data[3][n:]).sum()) if V else 0
    print(f'trained on {m} games + {len(V)} verdicts; newest {n - m} held out: acc {acc:.3f} logloss {ll:.4f}; fits {agree}/{len(V)} verdicts')
    if hist: hist[-1].update(newest_held_out_acc=round(acc, 4), verdicts_fit=f'{agree}/{len(V)}')
    else: hist.append(dict(date=time.strftime('%Y-%m-%d'), first_train=n, held_out_acc=round(acc, 4), verdicts_fit=f'{agree}/{len(V)}'))
    torch.save(dict(vocab=v.state(), cfg=cfg, state=net.state_dict(), bias=net.bias,
                    seen=[f['match_id'] for f in F[:m]], at_games=m, history=hist), MODEL)
    json.dump(hist, open(os.path.join(HERE, 'history.json'), 'w'), indent=1)
    write_status(hist)


def write_status(hist):
    """The learner takes over the judging page's calls once, across every forward
    test so far (at least 500 unseen games), its draft-only calls beat the hand judge's
    by half a point; it hands back only if it falls half a point behind."""
    h = [e for e in hist if 'draft_only_acc' in e]
    games = sum(e['new_games'] for e in h)
    net_ok = sum(e['draft_only_acc'] * e['new_games'] for e in h); judge_ok = sum(e['judge_acc'] * e['new_games'] for e in h)
    # A half-point margin each way, so a tie doesn't flip the page's calls day to day.
    try: was = json.load(open(os.path.join(HERE, 'status.json'))).get('in_charge', False)
    except Exception: was = False
    lead = (net_ok - judge_ok) / games if games else 0
    st = dict(in_charge=games >= 500 and (lead > -0.005 if was else lead > 0.005), forward_games=games,
              learner_acc=round(net_ok / games, 4) if games else None, judge_acc=round(judge_ok / games, 4) if games else None)
    json.dump(st, open(os.path.join(HERE, 'status.json'), 'w'), indent=1)
    print('status:', st)


def run_predict(args):
    """Draft-only win chances for drafts with no players (the judging page).
    Input: [{id, seats: [[model, spell, ...] x10, Radiant first], diff: {judge features}}]."""
    ck = torch.load(MODEL, weights_only=False)
    v = Vocab(**ck['vocab']); net = make(v, **ck['cfg']); net.load_state_dict(ck['state']); net.bias = ck['bias']
    D = json.load(open(args.file)); games, F = {}, []
    for d in D:
        games[d['id']] = dict(players=[dict(slot=i if i < 5 else 128 + i - 5, account_id=None, hero=s[0], abilities=s[1:])
                                       for i, s in enumerate(d['seats'])])
        F.append(dict(match_id=d['id'], radiant_win=False, diff={k: d['diff'].get(k, 0) for k in v.keys}))
    p = predict(net, v.encode(games, F), torch.arange(len(F)), draft_only=True)
    print(json.dumps({d['id']: round(float(x), 4) for d, x in zip(D, p)}))


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('mode', choices=['eval', 'train', 'predict'])
    ap.add_argument('file', nargs='?')
    ap.add_argument('--epochs', type=int, default=40)
    ap.add_argument('--folds', action='store_true')
    ap.add_argument('--warm', action='store_true')
    ap.add_argument('--limit', type=int, default=0)
    a = ap.parse_args()
    {'eval': run_eval, 'train': run_train, 'predict': run_predict}[a.mode](a)
