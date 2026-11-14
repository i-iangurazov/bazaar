"""Keep raw ranking, rejection, absent targets and retained candidates distinct."""


def counts(rows, threshold):
    result = {'queries': len(rows), 'rawTop1': 0, 'rawTop5': 0,
        'acceptedCorrectFirst': 0, 'acceptedWrongFirst': 0, 'acceptedCorrectTop5': 0,
        'withCandidates': 0, 'empty': 0}
    for row in rows:
        target, hits = row['expectedId'], row['matches']
        accepted = [hit for hit in hits if hit['score'] >= threshold]
        correct = bool(target and hits and hits[0]['productId'] == target)
        result['rawTop1'] += correct
        result['rawTop5'] += bool(target and any(hit['productId'] == target for hit in hits[:5]))
        result['withCandidates'] += bool(accepted)
        result['empty'] += not accepted
        result['acceptedCorrectFirst'] += bool(correct and accepted)
        result['acceptedWrongFirst'] += bool(target and accepted and accepted[0]['productId'] != target)
        result['acceptedCorrectTop5'] += bool(target and any(hit['productId'] == target for hit in accepted[:5]))
    return result


def leave_target_out(rows, threshold):
    known = [row for row in rows if row['expectedId']]
    def group(selected):
        return {'queries': len(selected), 'withCandidates': sum(bool(row['absentMatches'] and row['absentMatches'][0]['score'] >= threshold) for row in selected)}
    return {**group(known),
        'knownSingle': group([row for row in known if not row['multiObject']]),
        'knownMultiple': group([row for row in known if row['multiObject']])}


def summarize(result):
    threshold = result['threshold']
    modes = {}
    for mode in ['auto', 'manual']:
        rows = [row for row in result['test'] if row['mode'] == mode]
        known = [row for row in rows if row['expectedId']]
        modes[mode] = {
            'knownSingle': counts([row for row in known if not row['multiObject']], threshold),
            'knownMultiple': counts([row for row in known if row['multiObject']], threshold),
            'hardEight': counts([row for row in known if row['hard']], threshold),
            'absent': counts([row for row in rows if not row['expectedId']], threshold),
            'leaveTargetOut': leave_target_out(rows, threshold),
        }
    cases = []
    for row in result['test']:
        if not row['hard'] or row['mode'] != 'auto':
            continue
        rank = next((index+1 for index, hit in enumerate(row['matches']) if hit['productId'] == row['expectedId']), None)
        target = next((hit for hit in row['matches'] if hit['productId'] == row['expectedId']), None)
        cases.append({'query': row['id'], 'expectedSku': row['expectedSku'], 'rawFirstSku': row['matches'][0]['sku'],
            'targetRank': rank, 'targetScore': target['score'] if target else None,
            'acceptedFirstSku': row['matches'][0]['sku'] if row['matches'][0]['score'] >= threshold else None})
    return {'model': result['model'], 'description': result['description'], 'dimension': result['dimension'],
        'threshold': threshold, 'modes': modes, 'hardCases': cases,
        'autoEncodingMs': result['autoEncodingMs'], 'peakQueryRssMiB': result['phases']['test_queries']['peak_rss_mib'],
        'modelLoadSeconds': result['phases']['model_load']['wall_seconds']}
