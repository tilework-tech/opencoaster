import sys
sys.path.insert(0,'/tmp/proof')
from assemble import *
def repair(kind,backend,before_run,before_names,load_run,out):
    ms,good=load(load_run)
    bms,bgood=load(before_run)
    loaded=[m for m in ms if m['segment']=='loaded'][0]['name']
    loaded_row=next((r for r in good if r['name']==loaded),None)
    first_ready=next(i for i,r in enumerate(good) if r['p']>=1 and r['d']<0.5 and r['z']<=450)
    j=next(i for i in range(first_ready,len(good)) if good[i]['d']>=0.6)
    a,b=good[j-1],good[j]
    after=[r for r in good if r['tick']>=b['tick']]
    lap=[]
    for r in after:
        lap.append(r)
        if r['d']<0.35 and len(lap)>4: break
    mid=max(lap,key=lambda r:r['d'])
    climb=next((r for r in lap if r['z']>=462 and r['d']>1.0),b)
    ready=[r for r in good if r['tick']<=a['tick'] and r['p']>=1 and r['d']<0.35][-1]
    bn=[next(r for r in bgood if r['name']==n) for n in before_names]
    items=[(before_run,bn[0]['name'],f"MAIN save ({kind}): train behind platform"),
           (before_run,bn[1]['name'],f"MAIN save: still behind platform t{bn[1]['tick']}"),
           (load_run,loaded,"PR 145 after load: train at platform front"),
           (load_run,ready['name'],f"loaded, ready t{ready['tick']}"),
           (load_run,b['name'],f"departing t{b['tick']}"),
           (load_run,climb['name'],f"climbing the chain lift t{climb['tick']}"),
           (load_run,mid['name'],f"mid-lap, top t{mid['tick']}"),
           (load_run,lap[-1]['name'],f"returning to the platform t{lap[-1]['tick']}")]
    strip(out,items,cols=4,scale=0.8)
    print(out,[i[1] for i in items])
if __name__=='__main__':
    repair('steel','WebGL2','mainp-steel-WebGL2-build',['0003-follow.png','0011-follow.png'],'headload3-steel-WebGL2-load','repair-on-load-steel-webgl2.png')
    repair('wooden','WebGL2','mainp-wooden-WebGL2-build',['0003-follow.png','0011-station.png'],'headload3-wooden-WebGL2-load','repair-on-load-wooden-webgl2.png')
