"""Reanalyse held-out ALOI photos with hard negatives selected from gallery only.

Uses frozen measured PP-ShiTu features, not fabricated marketplace responses.
No training or threshold fitting on test queries. No database writes.
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np


def select_pairs(gallery, vectors, eligible, count=20):
    # Similarity is based solely on catalog views r0/r90, never on queries.
    scores = vectors @ vectors.T
    candidates = {}
    for i, first in enumerate(gallery):
        if first['product_id'] not in eligible:
            continue
        for j in range(i+1, len(gallery)):
            second = gallery[j]
            if second['product_id'] not in eligible or first['product_id'] == second['product_id']:
                continue
            pair = tuple(sorted([first['product_id'], second['product_id']]))
            if pair not in candidates or float(scores[i,j]) > candidates[pair]['score']:
                candidates[pair] = {'products': pair, 'score': float(scores[i,j]), 'images': [first['id'], second['id']]}
    chosen, used = [], set()
    for pair in sorted(candidates.values(), key=lambda x: (-x['score'], x['products'])):
        if used.intersection(pair['products']):
            continue
        chosen.append(pair)
        used.update(pair['products'])
        if len(chosen) == count:
            break
    return chosen


def ranked_products(scores, gallery):
    seen, matches = set(), []
    for i in np.argsort(-scores, kind='stable'):
        product = gallery[int(i)]['product_id']
        if product in seen:
            continue
        seen.add(product)
        matches.append({'product_id': product, 'image_id': gallery[int(i)]['id'], 'score': float(scores[i])})
    return matches


def summarize(rows, threshold):
    known = [r for r in rows if r['known']]
    unknown = [r for r in rows if not r['known']]
    def rank(row, visible=False):
        return next((i+1 for i,m in enumerate(row['matches']) if m['product_id']==row['product_id'] and (not visible or m['score']>=threshold)), 99999)
    mean=lambda xs: sum(xs)/len(xs) if xs else None
    return {'known_queries':len(known), 'known_identities':len({r['product_id'] for r in known}),
        'raw_recall_at_1':mean([rank(r)<=1 for r in known]),
        'raw_recall_at_5':mean([rank(r)<=5 for r in known]),
        'visible_recall_at_5':mean([rank(r,True)<=5 for r in known]),
        'visible_recall_at_8':mean([rank(r,True)<=8 for r in known]),
        'visible_wrong_top1_rate':mean([rank(r)!=1 and r['matches'][0]['score']>=threshold for r in known]),
        'unknown_queries':len(unknown),
        'unknown_candidate_rate':mean([r['matches'][0]['score']>=threshold for r in unknown]),
        'near_tie_top2_rate':mean([len(r['matches'])>1 and r['matches'][1]['score']>=threshold and r['matches'][0]['score']-r['matches'][1]['score']<0.03 for r in known])}


def main(args):
    root, out = args.root, args.out
    manifest_path = root/'dataset.json'
    manifest = json.loads(manifest_path.read_text())
    prior = json.loads((root/'results/ppshitu-2t.json').read_text())
    digest = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    if digest != prior['dataset_manifest_sha256']:
        raise ValueError('feature cache and manifest disagree')
    entries = manifest['entries']
    gallery=[r for r in entries if r['split']=='gallery']
    queries=[r for r in entries if r['split']!='gallery']
    cache_path=root/'results/ppshitu-2t.features.npz'
    cache_digest=hashlib.sha256(cache_path.read_bytes()).hexdigest()
    protocol=json.loads(Path('docs/benchmarks/product-photo-20261114/protocol.json').read_text())
    if protocol['raw_evidence_hashes'].get(cache_path.name) != cache_digest:
        raise ValueError('feature cache differs from published benchmark evidence')
    features=np.load(cache_path,allow_pickle=False)
    g,q=features['gallery'],features['query']
    if g.shape!=(len(gallery),512) or q.shape!=(len(queries),512):
        raise ValueError('feature dimensions or ordering differ')
    eligible={r['product_id'] for r in queries if r['split']=='test' and r['known']}
    pairs=select_pairs(gallery,g,eligible,args.pairs)
    hard_ids={p for pair in pairs for p in pair['products']}
    results=[]
    for row,vector in zip(queries,q):
        if row['split']!='test': continue
        results.append({k:row[k] for k in ['id','product_id','condition','known']}|{'hard':row['product_id'] in hard_ids,'matches':ranked_products(g @ vector,gallery)[:8]})
    # Counterfactual: remove the true product from the gallery for each hard query.
    absent=[]
    for row in results:
        if not row['hard']: continue
        absent.append(row|{'known':False,'matches':[m for m in row['matches'] if m['product_id']!=row['product_id']]})
    report={'schema':1,'model': 'PP-ShiTuV2 PPLCNetV2 FP32', 'threshold':args.threshold,
      'method':'Frozen feature reanalysis; hard pairs selected only from gallery; held-out queries; full 300-product gallery',
      'manifest_sha256':digest,'features_sha256':hashlib.sha256(cache_path.read_bytes()).hexdigest(),
      'pairs':pairs,'overall_test':summarize(results,args.threshold),
      'hard_test':summarize([r for r in results if r['hard']],args.threshold),
      'hard_true_product_removed':summarize(absent,args.threshold),
      'limitations':['Public 154x115 ALOI objects; not exact Bazaar SKU accuracy','Frozen embeddings from prior benchmark; not an end-to-end HTTP latency test','Near tie is a descriptive score gap, never a confidence probability','Same model, no new training, no threshold fitting on this test'],
      'failure_examples':[r for r in results if r['hard'] and r['matches'][0]['product_id']!=r['product_id']][:12]}
    out.mkdir(parents=True,exist_ok=True)
    (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    (out/'queries.json').write_text(json.dumps(results,indent=2)+'\n')
    print(json.dumps({k:report[k] for k in ['overall_test','hard_test','hard_true_product_removed']},indent=2))
    # Contact sheet is a scientific inspection figure, original photographs unchanged.
    from PIL import Image, ImageDraw
    byid={r['id']:r for r in gallery}
    sheet=Image.new('RGB',(700,len(pairs)*150),'white');draw=ImageDraw.Draw(sheet)
    for n,pair in enumerate(pairs):
        for side,image_id in enumerate(pair['images']):
            record=byid[image_id]
            image=Image.open(root/record['path']);image.thumbnail((200,115))
            x=20+side*330;y=n*150+20;sheet.paste(image,(x,y));draw.text((x+165,y+5),record['product_id'],fill='black')
        draw.text((540,n*150+110),f"gallery cosine {pair['score']:.3f}",fill='black')
    sheet.save(out/'pairs.png')


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root',type=Path,default=Path('.local/photo-search-benchmark'))
    p.add_argument('--out',type=Path,default=Path('.local/product-photo-hard-cases'))
    p.add_argument('--pairs',type=int,default=20)
    p.add_argument('--threshold',type=float,default=0.68)
    main(p.parse_args())
