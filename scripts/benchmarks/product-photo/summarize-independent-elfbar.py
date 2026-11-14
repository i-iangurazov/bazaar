"""Report frozen baseline/guarded policies on development and new photos separately."""
import hashlib
import json
from pathlib import Path
from elfbar_consensus import select
from elfbar_guarded_consensus import select_guarded
from elfbar_metrics import counts, leave_target_out


def evaluate(base, fallback, policy):
    result = {}
    for method in ['pp', 'agreement', 'guarded']:
        rows = []
        for query in base:
            other = next(row for row in fallback if row['id'] == query['id'])
            assert query['expectedId'] == other['expectedId']
            def choose(key):
                a, b = query[key], other[key]
                if method == 'pp':
                    return [hit for hit in a if hit['score'] >= policy['baseThreshold']], 'baseOnly'
                parameters = [a, b, policy['baseThreshold'], policy['fallbackThreshold']]
                return select(*parameters) if method == 'agreement' else select_guarded(*parameters, policy['minimumPpProductGap'])
            hits, reason = choose('matches')
            absent, absent_reason = choose('absentMatches')
            rows.append({**{key: query.get(key) for key in ['id', 'expectedId', 'expectedSku', 'expectedFlavor', 'shootGroup', 'photographerGroup', 'multiObject', 'hard', 'labelVisible']},
                'matches': hits, 'reason': reason, 'absentMatches': absent, 'absentReason': absent_reason})
        def admitted(selected):
            return {key: value for key, value in counts(selected, -1).items() if not key.startswith('raw')}
        summary = {'knownSingle': admitted([row for row in rows if row['expectedId'] and not row['multiObject']]),
            'knownMultiple': admitted([row for row in rows if row['expectedId'] and row['multiObject']]),
            'absent': admitted([row for row in rows if not row['expectedId']]),
            'leaveTargetOut': leave_target_out(rows, -1),
            'hardEight': admitted([row for row in rows if row['hard']]),
            'wrongKnown': [row['id'] for row in rows if row['expectedId'] and row['matches'] and row['matches'][0]['productId'] != row['expectedId']],
            'absentErrors': [{'query': row['id'], 'returnedSku': row['matches'][0]['sku']} for row in rows if not row['expectedId'] and row['matches']],
            'removedTargetErrorsSingle': [{'query': row['id'], 'removedSku': row['expectedSku'], 'returnedSku': row['absentMatches'][0]['sku']} for row in rows if row['expectedId'] and not row['multiObject'] and row['absentMatches']]}
        groups = {}
        for row in rows:
            if row['shootGroup']:
                groups.setdefault(row['shootGroup'], []).append(row)
        summary['byShootGroup'] = {key: {'photos': len(group), 'known': admitted([row for row in group if row['expectedId']]),
            'absent': admitted([row for row in group if not row['expectedId']]), 'leaveTargetOut': leave_target_out(group, -1)} for key, group in groups.items()}
        result[method] = {'summary': summary, 'rows': rows}
    return result


def main():
    root = Path('.local/elfbar-independent')
    protocol_path = Path('scripts/qa/fixtures/elfbar-independent-evaluation.json')
    protocol_hash = hashlib.sha256(protocol_path.read_bytes()).hexdigest()
    protocol = json.loads(protocol_path.read_text())
    policy = json.loads(Path('scripts/qa/fixtures/elfbar-independent-policy.json').read_text())
    assert hashlib.sha256(Path('scripts/qa/fixtures/elfbar-independent-policy.json').read_bytes()).hexdigest() == protocol['policySha256']
    data = json.loads((root/'frozen-inputs.json').read_text())
    assert hashlib.sha256((root/'frozen-inputs.json').read_bytes()).hexdigest() == protocol['frozenInputSha256']
    models = {}
    allowed = {product['id'] for product in data['products']}
    expected = {query['id']: query for query in data['queries']}
    for model in ['ppshitu', 'dinov2-224']:
        row = json.loads((root/f'{model}.json').read_text())
        assert row['protocolSha256'] == protocol_hash and row['frozenInputSha256'] == protocol['frozenInputSha256']
        assert row['databaseWrites'] is False and row['runtimeChanged'] is False
        assert {q['id'] for q in row['test']} == set(expected) and len(row['test']) == len(expected)
        for query in row['test']:
            assert query['expectedId'] == expected[query['id']]['expectedId']
            assert query['sha256'] == expected[query['id']]['sha256']
            for key in ['matches', 'absentMatches']:
                assert len({hit['productId'] for hit in query[key]}) == len(query[key])
                assert all(hit['productId'] in allowed for hit in query[key])
            if query['expectedId']:
                assert all(hit['productId'] != query['expectedId'] for hit in query['absentMatches'])
        models[model] = row
    previous = Path('.local/elfbar-model-comparison/results')
    old = {model: json.loads((previous/f'{model}.json').read_text()) for model in models}
    development = evaluate([q for q in old['ppshitu']['test'] if q['mode'] == 'auto'],
        [q for q in old['dinov2-224']['test'] if q['mode'] == 'auto'], policy)
    new = evaluate(models['ppshitu']['test'], models['dinov2-224']['test'], policy)
    result = {'schema': 1, 'protocolSha256': protocol_hash, 'policy': policy,
        'development': development, 'newPhotographs': new,
        'cohort': {'photos': len(expected), 'shootGroups': len({q['shootGroup'] for q in data['queries']}),
            'photographerGroups': len({q['photographerGroup'] for q in data['queries']}),
            'knownFlavors': sorted({q['expectedFlavor'] for q in data['queries'] if q['expectedId']}),
            'absentFlavors': sorted({q['expectedFlavor'] for q in data['queries'] if not q['expectedId']})},
        'resource': {model: {'encodingMs': row['encodingMs'], 'peakQueryRssMiB': row['phases']['queries']['peak_rss_mib']} for model, row in models.items()},
        'limits': json.loads(Path('scripts/qa/fixtures/elfbar-independent-photos.json').read_text())['limits']}
    (root/'summary.json').write_text(json.dumps(result, indent=2)+'\n')
    for split in ['development', 'newPhotographs']:
        print(split)
        for method, row in result[split].items():
            s = row['summary']
            print(json.dumps({'method': method, 'knownCorrect': s['knownSingle']['acceptedCorrectFirst'],
                'knownWrong': s['knownSingle']['acceptedWrongFirst'], 'knownTotal': s['knownSingle']['queries'],
                'absentFalse': s['absent']['withCandidates'], 'absentTotal': s['absent']['queries'],
                'removedTargetFalse': s['leaveTargetOut']['knownSingle']['withCandidates'],
                'removedTargetTotal': s['leaveTargetOut']['knownSingle']['queries'], 'hardRecovered': s['hardEight']['acceptedCorrectFirst']}))


if __name__ == '__main__':
    main()
