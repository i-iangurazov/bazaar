"""Bounded PaddleClas detection -> per-region recognition -> best region for OCR.

The published SystemPredictor recognizes every proposed foreground box plus the
whole image. Bazaar returns candidate products for explicit user selection, keeping
the existing similarity threshold in Node. No shared store index or query cache.
"""
from geometry import crop_region, fallback_analysis


def describe_views(rgb, encoder, propose=None, region=None, automatic=True):
    # At most five detector proposals plus the full image; manual choice bypasses
    # both detection and the full image so it cannot silently broaden the query.
    regions = [region] if region else [None]
    if not region and automatic and propose:
        regions += [proposal for _, proposal in propose(rgb)[:5]]
    queries = [encoder.encode_rgb(crop_region(rgb, box) if box else rgb).tolist() for box in regions]
    return regions, queries


def select_views(regions, batches, region, min_score):
    if len(batches) != len(regions):
        raise ValueError('invalidSearch')
    grouped = {}
    for matches in batches:
        for match in matches:
            group = match['group']
            if group not in grouped or match['score'] > grouped[group]['score']:
                grouped[group] = {'index': match['index'], 'score': match['score']}
    # Recognition evidence selects the relevant proposal, rather than the detector's
    # most confident object (which may be a hand/person). Ties retain the full view.
    selected = max(range(len(batches)), key=lambda index: batches[index][0]['score'] if batches[index] else -1.01)
    # An unrelated background crop with the least-bad subthreshold score is not
    # a recognized product. Read the full photo instead; retain manual intent.
    if not region and (not batches[selected] or batches[selected][0]['score'] < min_score):
        selected = 0
    box = regions[selected]
    source = 'manual' if region else 'auto' if box else 'full'
    return sorted(grouped.values(), key=lambda match: (-match['score'], match['index']))[:8], box, source


def search_views(rgb, encoder, searcher, matrix, groups, vision=None, region=None, automatic=True, min_score=0.68):
    regions, queries = describe_views(rgb, encoder, vision.propose if vision else None, region, automatic)
    batches = searcher.search_many(matrix, groups, queries)
    hits = [[{**match, 'group': groups[match['index']]} for match in batch] for batch in batches]
    matches, box, source = select_views(regions, hits, region, min_score)
    analysis = vision.read(rgb, box, source) if vision else fallback_analysis(region)
    return {'matches': matches, 'analysis': analysis}
