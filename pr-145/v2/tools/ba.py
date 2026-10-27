import sys
sys.path.insert(0,'/tmp/proof')
from assemble import *
def moments(run):
    ms,good=load(run)
    closed=[m for m in ms if m['segment']=='closed-waiting'][-1]['name']
    first=next(r for r in good if r['seg']!='closed-waiting' and r['p']==0)
    st=next(i for i,r in enumerate(good) if r['seg']!='closed-waiting' and r['p']>=1 and r['d']<1.2 and r['z']<=450)
    jj=next(i for i in range(st,len(good)) if good[i]['d']>=good[st]['d']+0.3 and good[i]['d']>=0.6)
    a,b=good[jj-1],good[jj]
    ready=[r for r in good if r['tick']<=a['tick'] and r['p']>=1 and r['d']<1.2 and r['seg']!='closed-waiting']
    ready=ready[-1] if ready else a
    return closed,first,ready,b
def ba(kind,backend,mr,hr,out):
    m=moments(mr); h=moments(hr)
    items=[]
    for run,(closed,first,ready,b),tag in [(mr,m,'MAIN'),(hr,h,'PR 145')]:
        items+= [(run,closed,f'{tag} {kind}: ride closed after test'),
                 (run,first['name'],f"{tag}: open, waiting t{first['tick']} ({first['d']:.1f} off)"),
                 (run,ready['name'],f"{tag}: loaded, ready t{ready['tick']}"),
                 (run,b['name'],f"{tag}: departing t{b['tick']}")]
    strip(out,items,cols=4,scale=0.8)
if __name__=='__main__':
    for kind in ['steel','wooden']:
        ba(kind,'WebGL2',f'mainc-{kind}-WebGL2-build',f'headc-{kind}-WebGL2-build',f'before-after-{kind}-webgl2.png')
    ba('steel','Canvas2D','main-steel-Canvas2D-build','headg-steel-Canvas2D-build','before-after-steel-canvas2d.png')
