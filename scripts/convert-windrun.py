# Rebuilds public/heroes_abilities.json and public/ability_synergies.json from windrun exports.
# Usage: python3 scripts/convert-windrun.py <windrun-repo>/src/data ability-high-skill.json ability-pairs.json public
# <windrun-repo> is a clone of github.com/Noxville/windrun (for ability/hero id -> name lookups).
# Synergy uses windrun's own formula: pair winrate% - sqrt(winrateA% * winrateB%), all-skill winrates.
import json,sys,re,math
src,hs_path,pairs_path,outdir=sys.argv[1:5]
def ts_obj(path,var):
    t=open(path).read(); i=t.index('export const '+var); i=t.index('{',i)
    depth=0
    for j in range(i,len(t)):
        if t[j]=='{': depth+=1
        elif t[j]=='}':
            depth-=1
            if depth==0: return json.loads(t[i:j+1])
AB=ts_obj(src+'/abilities.ts','abilitiesById'); HE=ts_obj(src+'/heroes.ts','heroesById')
hs=json.load(open(hs_path))['data']; pr=json.load(open(pairs_path))['data']
allS={s['abilityId']:s for s in hs['allData']['abilityStats']}
hiS={s['abilityId']:s for s in hs['highSkillData']['abilityStats']}
def hero_name(hid): return HE[str(hid)]['npc'].replace('npc_dota_hero_','')
def key(aid):
    if aid<0: return hero_name(-aid)
    return AB[str(aid)]['shortName']
missing=[a for a in set(allS)|set(hiS) if (a<0 and str(-a) not in HE) or (a>0 and str(a) not in AB)]
heroes={}
for aid in sorted(set(allS)|set(hiS)):
    if aid in missing: continue
    a=allS.get(aid,{}); h=hiS.get(aid,{})
    if aid<0:
        hid=-aid
        heroes.setdefault(hid,{'abilities':[]})
        heroes[hid]['model_avg_pick_position_high']=round(h['avgPickPosition'],2) if h else None
        heroes[hid]['model_winrate_high']=h.get('winrate')
        continue
    info=AB[str(aid)]; hid=a.get('ownerHero') or info['ownerHeroId']
    if hid is None:  # newer abilities missing an owner in windrun's static data: match by name prefix
        cands=[int(k) for k in HE if info['shortName'].startswith(hero_name(int(k))+'_')]
        hid=max(cands,key=lambda k:len(hero_name(k))) if cands else None
        print('owner inferred:',info['shortName'],'->',hid and hero_name(hid))
        if hid is None: continue
    heroes.setdefault(hid,{'abilities':[]})['abilities'].append({
        'name':info['shortName'],'display_name':info['englishName'],'is_ultimate':bool(info['isUltimate']),
        'winrate':round(a['winrate'],4) if a else None,'pick_rate':round(a['pickRate']*100,2) if a else None,
        'winrate_high':round(h['winrate'],4) if h else None,'pick_rate_high':round(h['pickRate']*100,2) if h else None,
        'avg_pick_position_high':round(h['avgPickPosition'],2) if h else None})
out=[]
for hid in sorted(heroes,key=lambda x:hero_name(x)):
    v=heroes[hid]; v['abilities'].sort(key=lambda x:-(x['pick_rate'] or 0))
    out.append({'name':hero_name(hid),'display_name':HE[str(hid)]['englishName'],'abilities':v['abilities'],
                'model_avg_pick_position_high':v.get('model_avg_pick_position_high'),'model_winrate_high':v.get('model_winrate_high')})
syn=[];skipped=0
for p in pr['abilityPairs']:
    a,b=p['abilityIdOne'],p['abilityIdTwo']
    if a in missing or b in missing or a not in allS or b not in allS: skipped+=1; continue
    s=p['winrate']*100-math.sqrt(allS[a]['winrate']*100*allS[b]['winrate']*100)
    syn.append([key(a),key(b),round(s,2)])
json.dump(out,open(outdir+'/heroes_abilities.json','w'),indent=2,ensure_ascii=False)
json.dump(syn,open(outdir+'/ability_synergies.json','w'),ensure_ascii=False)
print('patch',hs['allData']['patches']['overall'],'heroes',len(out),'abilities',sum(len(h['abilities']) for h in out),'missing ids',missing,'pairs',len(syn),'skipped',skipped)
