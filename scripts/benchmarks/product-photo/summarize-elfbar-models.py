"""Validate comparison records and summarize the separately labelled agreement trial."""
import hashlib
import json
from pathlib import Path
from elfbar_metrics import summarize, counts, leave_target_out
from elfbar_consensus import select
from metrics import rejection_threshold


def main():
    root = Path('.local/elfbar-model-comparison')
    protocol_bytes = Path('scripts/qa/fixtures/elfbar-model-comparison.json').read_bytes()
    protocol = json.loads(protocol_bytes)
    protocol_hash = hashlib.sha256(protocol_bytes).hexdigest()
    data = json.loads((root/'frozen-inputs.json').read_text())
    outputs = {}
    for model in protocol['models']:
        row = json.loads((root/'results'/f'{model}.json').read_text())
        assert row['protocolSha256'] == protocol_hash
        assert row['inputSha256'] == protocol['frozenInputSha256']
        assert row['databaseWrites'] is False and row['runtimeChanged'] is False
        assert len(row['calibration']) == 11 and len(row['test']) == 40
        negatives = [query['absentMatches'][0]['score'] for query in row['calibration']]
        assert row['threshold'] == rejection_threshold(negatives, max_false_accept=0)
        for split in ['calibration', 'test']:
            allowed = {product['id'] for product in data[split]['products']}
            expected = {query['id']: query for query in data[split]['queries']}
            for query in row[split]:
                assert query['expectedId'] == expected[query['id']]['expectedId']
                for key in ['matches', 'absentMatches']:
                    assert len({hit['productId'] for hit in query[key]}) == len(query[key])
                    assert all(hit['productId'] in allowed for hit in query[key])
                if query['expectedId']:
                    assert all(hit['productId'] != query['expectedId'] for hit in query['absentMatches'])
        outputs[model] = row
    policy = json.loads(Path('scripts/qa/fixtures/elfbar-model-consensus.json').read_text())
    assert policy['baseProtocolSha256'] == protocol_hash
    base, fallback = outputs[policy['base']], outputs[policy['fallback']]
    consensus_rows = []
    for query in base['test']:
        other = next(row for row in fallback['test'] if row['id'] == query['id'] and row['mode'] == query['mode'])
        assert query['expectedId'] == other['expectedId']
        hits, source = select(query['matches'], other['matches'], policy['baseThreshold'], fallback['threshold'])
        absent, absent_source = select(query['absentMatches'], other['absentMatches'], policy['baseThreshold'], fallback['threshold'])
        consensus_rows.append({**{key: query[key] for key in ['id', 'mode', 'expectedId', 'expectedSku', 'multiObject', 'hard']},
            'matches': hits, 'source': source, 'absentMatches': absent, 'absentSource': absent_source})
    consensus = {'schema': 1, 'policy': policy, 'fallbackThreshold': fallback['threshold'], 'test': consensus_rows}
    (root/'results/consensus.json').write_text(json.dumps(consensus, indent=2)+'\n')
    def admitted(rows):
        # These lists were already filtered by per-model thresholds. Do not call
        # their ranks "raw", and never average scores from the two encoders.
        result = counts(rows, -1)
        return {key: value for key, value in result.items() if not key.startswith('raw')}
    consensus_modes = {}
    reference_modes = {}
    for mode in ['auto', 'manual']:
        rows = [row for row in consensus_rows if row['mode'] == mode]
        reference = [row for row in base['test'] if row['mode'] == mode]
        consensus_modes[mode] = {'knownSingle': admitted([row for row in rows if row['expectedId'] and not row['multiObject']]),
            'hardEight': admitted([row for row in rows if row['hard']]), 'absent': admitted([row for row in rows if not row['expectedId']]),
            'leaveTargetOut': leave_target_out(rows, -1)}
        reference_modes[mode] = {'knownSingle': counts([row for row in reference if row['expectedId'] and not row['multiObject']], policy['baseThreshold']),
            'hardEight': counts([row for row in reference if row['hard']], policy['baseThreshold']),
            'absent': counts([row for row in reference if not row['expectedId']], policy['baseThreshold']),
            'leaveTargetOut': leave_target_out(reference, policy['baseThreshold'])}
    result = {'schema': 1, 'protocolSha256': protocol_hash, 'inputSha256': protocol['frozenInputSha256'],
        'models': [summarize(outputs[name]) for name in protocol['models']],
        'currentPPThresholdReference': {'threshold': policy['baseThreshold'], 'modes': reference_modes},
        'exploratoryConsensus': {'policy': policy, 'modes': consensus_modes,
            'recoveredHardAuto': [row['id'] for row in consensus_rows if row['mode'] == 'auto' and row['hard'] and row['matches'] and row['matches'][0]['productId'] == row['expectedId']],
            'absentErrorsAuto': [{'query': row['id'], 'removedSku': row['expectedSku'], 'returnedSku': row['absentMatches'][0]['sku']} for row in consensus_rows if row['mode'] == 'auto' and row['expectedId'] and row['absentMatches']]},
        'limits': protocol['limits']}
    (root/'summary.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps([{'model': row['model'], 'rawTop1': row['modes']['auto']['knownSingle']['rawTop1'],
        'acceptedCorrectFirst': row['modes']['auto']['knownSingle']['acceptedCorrectFirst'],
        'hardFound': row['modes']['auto']['hardEight']['acceptedCorrectFirst'],
        'removedTargetFalse': row['modes']['auto']['leaveTargetOut']['withCandidates']} for row in result['models']], indent=2))


if __name__ == '__main__':
    main()
