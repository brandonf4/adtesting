# Tests function-vs-function patterns (from ability tags) on real AD games.
# Run from lab/: python3 ml/pattern-test.py   (needs scikit-learn, statsmodels)
import json, glob, numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss
games={}
for f in sorted(glob.glob('data/ad-games*.jsonl')):
    for l in open(f):
        if l.strip(): g=json.loads(l); games[g['match_id']]=g
F=json.load(open('runs/ad-games-features.json')); F=[f for f in F if f['match_id'] in games]
F.sort(key=lambda f:games[f['match_id']]['start_time'])
T=json.load(open('data/ability_tags.json')); L=T['legend']; t=T['tags']; t.update(json.load(open('data/ability_tags_edits.json')))
tags=sorted(L); ix={k:i for i,k in enumerate(tags)}; K=len(tags)
n=len(F); y=np.array([int(f['radiant_win']) for f in F])
keys=list(F[0]['diff']); J=np.array([[f['diff'][k] for k in keys] for f in F]); J=(J-J.mean(0))/(J.std(0)+1e-9)
C=np.zeros((n,2,K))
for r,f in enumerate(F):
    ps=sorted(games[f['match_id']]['players'],key=lambda p:p['slot'])
    for s,p in enumerate(ps):
        for it in ['model_'+p['hero']]+p['abilities']:
            for tg in t.get(it,[]):
                if tg in ix: C[r,s//5,ix[tg]]+=1
S=np.minimum(C,3)  # 4th copy of a function adds nothing new
R,D=S[:,0],S[:,1]
main=R-D
cross=(R[:,:,None]*D[:,None,:]-D[:,:,None]*R[:,None,:]).reshape(n,-1)  # my a x their b, side-symmetric
lack=((R==0)*1.-(D==0)*1.)
cut=int(n*.75)
def ev(name,X,Cr):
    m=LogisticRegression(C=Cr,max_iter=4000); m.fit(X[:cut],y[:cut]); p=m.predict_proba(X[cut:])[:,1]
    print(f'{name:40s} newest-25%: {((p>.5)==y[cut:]).mean():.4f}  logloss {log_loss(y[cut:],p):.4f}',flush=True); return m
print(n,'games',K,'tags')
ev('judge features',J,1)
ev('tags only',np.hstack([main,lack]),.1)
ev('judge + tags',np.hstack([J,main,lack]),.1)
for Cr in [.003,.01,.03]:
    ev(f'judge + tags + tag-vs-tag C={Cr}',np.hstack([J,main,lack,cross/3]),Cr)
ev('tag-vs-tag only C=.01',cross/3,.01)
print('--- direct test: lockdown vs mobility')
g=lambda M,ts: sum(M[:,:,ix[x]] for x in ts)
lock=g(C,['dis','aoed','silence']); mob=g(C,['mob','gap','invis'])
pj=np.array([f['pRadiant'] for f in F])
for side,other,yy,pp in [(0,1,y,pj),(1,0,1-y,1-pj)]:
    pass
rows=[]
for r in range(n):
    for s in (0,1):
        o=1-s; win=y[r] if s==0 else 1-y[r]; pexp=pj[r] if s==0 else 1-pj[r]
        rows.append((lock[r,s],mob[r,o],win,pexp))
A=np.array(rows)
for lo,hi in [(0,1),(2,3),(4,5),(6,99)]:
    for mlo,mhi in [(0,2),(3,4),(5,99)]:
        sel=(A[:,0]>=lo)&(A[:,0]<=hi)&(A[:,1]>=mlo)&(A[:,1]<=mhi)
        if sel.sum()>200: print(f'my lockdown {lo}-{hi} vs their mobility {mlo}-{mhi}: games {sel.sum():6d} win {A[sel,2].mean():.3f}  judge expected {A[sel,3].mean():.3f}  surprise {A[sel,2].mean()-A[sel,3].mean():+.3f}')
print('--- one hypothesis term')
import statsmodels.api as sm
Lr,Ld=np.minimum(lock[:,0],8),np.minimum(lock[:,1],8); Mr,Md=np.minimum(mob[:,0],8),np.minimum(mob[:,1],8)
h=(Ld*Mr-Lr*Md)  # their lockdown x my mobility (minus mirror): positive = I'm mobile vs their lockdown
hz=((8-Ld)*Mr-(8-Lr)*Md)/8  # my mobility against THEIR LACK of lockdown
X=np.hstack([J,(Lr-Ld)[:,None],(Mr-Md)[:,None],hz[:,None]])
r=sm.Logit(y,sm.add_constant(X)).fit(disp=0); print('coef lack-of-lockdown x enemy mobility',r.params[-1],'z',r.tvalues[-1],'p',r.pvalues[-1])
ev('judge + lockdown + mobility',np.hstack([J,(Lr-Ld)[:,None],(Mr-Md)[:,None]]),1)
ev('judge + lockdown + mobility + their mob vs my lack',X,1)
