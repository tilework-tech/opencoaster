import json,math,os,shutil,subprocess,sys
S=(47.5,60.5)
OUT='/home/sprite/org/workspace/opencoaster-proofs/pr-145/v2'
os.makedirs(f'{OUT}/sheets',exist_ok=True); os.makedirs(f'{OUT}/raw',exist_ok=True)
def load(run):
    base=f'/tmp/proof/out/{run}'
    ms=[json.loads(l) for l in open(f'{base}/meta.jsonl')]
    rows=[]
    for m in ms:
        c=m['cars']
        if len(c)>=4 and m['tick']>=0:
            n=len(c)//4; x=sum(c[k*4] for k in range(n))/n/256; y=sum(c[k*4+1] for k in range(n))/n/256; z=sum(c[k*4+2] for k in range(n))/n
            rows.append(dict(name=m['name'],seg=m['segment'],tick=m['tick'],d=math.hypot(x-S[0],y-S[1]),z=z,p=(c[3]>>9)&7))
    return ms,rows
def strip(out,items,cols=4,scale=0.8):
    args=['node','/tmp/proof/build-strip.cjs',f'{OUT}/sheets/{out}',str(cols),str(scale)]
    for run,name,cap in items:
        args.append(f'/tmp/proof/out/{run}/{name}|{cap}')
        os.makedirs(f'{OUT}/raw/{run}',exist_ok=True)
        shutil.copy(f'/tmp/proof/out/{run}/{name}',f'{OUT}/raw/{run}/{name}')
    subprocess.run(args,check=True)
def phases(run,out,label,last):
    ms,good=load(run)
    wait=[m for m in ms if m['segment']=='closed-waiting'][-1]['name']
    st=next(i for i,r in enumerate(good) if r['seg']!='closed-waiting' and r['p']>=1 and r['d']<1.2 and r['z']<=450)
    jj=next(i for i in range(st,len(good)) if good[i]['d']>=good[st]['d']+0.3 and good[i]['d']>=0.6)
    a,b=good[jj-1],good[jj]
    after=[r for r in good if r['tick']>=b['tick']]
    lap=[]
    for r in after:
        lap.append(r)
        if r['d']<0.35 and len(lap)>4: break
    mid=max(lap,key=lambda r:r['d'])
    climb=next((r for r in lap if r['z']>=462 and r['d']>1.0),b)
    desc=next((r for r in lap if r['tick']>mid['tick'] and r['z']<=450),mid)
    ret=next((r for r in lap if r['tick']>desc['tick'] and 1.0<=r['d']<=3.3),lap[-1])
    ready=[r for r in good if r['tick']<=a['tick'] and r['p']>=1 and r['d']<0.35 and r['seg']!='closed-waiting']
    ready=ready[-1] if ready else a
    lastrow=next(r for r in good if r['name']==last)
    items=[(run,wait,f'{label}: 1 ride closed, train at platform front'),
      (run,ready['name'],f"2 open, loaded, ready t{ready['tick']}"),
      (run,b['name'],f"3 departing t{b['tick']}"),
      (run,climb['name'],f"4 climbing the chain lift t{climb['tick']}"),
      (run,mid['name'],f"5 mid-lap, top t{mid['tick']}"),
      (run,desc['name'],f"6 mid-lap, descending t{desc['tick']}"),
      (run,ret['name'],f"7 returning to the station t{ret['tick']}"),
      (run,last,f"8 back at the platform, guests queueing t{lastrow['tick']}")]
    strip(out,items)
    return items
if __name__=='__main__':
    pass
