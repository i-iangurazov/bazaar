"""Product-level ambiguity veto for the offline PP/DINO agreement experiment.

Retain the established PP acceptance policy. A fallback must have not only
cross-encoder ID agreement but a minimum PP gap to the next *different* product.
No SKU names, colors, labels or scores from different encoder scales are mixed.
"""
from elfbar_consensus import select


def select_guarded(base, fallback, base_threshold, fallback_threshold, minimum_pp_gap):
    hits, reason = select(base, fallback, base_threshold, fallback_threshold)
    if reason != 'agreement':
        return hits, reason
    competitor = next((hit for hit in base[1:] if hit['productId'] != base[0]['productId']), None)
    if competitor is None:
        return [], 'insufficientCompetitors'
    if base[0]['score'] - competitor['score'] < minimum_pp_gap:
        return [], 'ambiguousPP'
    return hits, 'guardedAgreement'
