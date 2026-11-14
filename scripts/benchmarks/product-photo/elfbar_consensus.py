"""Exploratory agreement gate. Scores of different encoders are never averaged."""


def select(base, fallback, base_threshold, fallback_threshold):
    accepted = [hit for hit in base if hit['score'] >= base_threshold]
    if accepted:
        return accepted, 'base'
    if (base and fallback and fallback[0]['score'] >= fallback_threshold
            and fallback[0]['productId'] == base[0]['productId']):
        return fallback[:1], 'agreement'
    return [], 'rejected'
