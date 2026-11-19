#!/usr/bin/env python3
"""Merge explicitly allowed permission groups; preserve unrelated native bytes.

Inputs are produced locally from the same backed-up program. This is an offline
artifact check, not a native compiler or an authorization to deploy.
"""
from __future__ import annotations
import argparse
import collections
import json
import pathlib
import struct

MARKERS = {bytes([n]) * 16 for n in (0xFB, 0xFC, 0xFD, 0xFE, 0xFF)}
END = b'\xff' * 16


def uuid_of(raw):
    a, b, c = struct.unpack('<IHH', raw[:8])
    return f'{a:08x}-{b:04x}-{c:04x}-{raw[8:].hex()}'


def groups(data):
    if len(data) % 16:
        raise ValueError('Permission file has a partial record')
    result, start = [], 0
    for pos in range(0, len(data), 16):
        record = data[pos:pos + 16]
        if pos == start:
            if record in MARKERS:
                raise ValueError('Expected object UUID')
            if data[pos + 16:pos + 32] != b'\xfe' * 16:
                raise ValueError('Missing states marker')
        if record == END:
            raw = data[start:pos + 16]
            if b'\xfc' * 16 not in [raw[i:i + 16] for i in range(0, len(raw), 16)]:
                raise ValueError('Missing principals marker')
            state = 'states'
            for j in range(32, len(raw), 16):
                token = raw[j:j + 16]
                if token == b'\xfc' * 16 and state == 'states':
                    state = 'principals'
                elif token == b'\xfb' * 16 and state == 'principals':
                    pass
                elif token == b'\xfd' * 16 and state == 'principals':
                    state = 'end'
                elif token == END and state in ('principals', 'end') and j == len(raw) - 16:
                    state = 'complete'
                elif token in MARKERS or state in ('end', 'complete'):
                    raise ValueError('Invalid permission marker order')
            if state != 'complete':
                raise ValueError('Incomplete permission group')
            result.append((uuid_of(raw[:16]), raw))
            start = pos + 16
    if start != len(data):
        raise ValueError('Unterminated permission group')
    return result


def merge(original, baseline_generated, candidate_generated, allowed):
    """Reject unsupported affected groups; never regenerate other objects."""
    old, baseline, candidate = map(groups, (original, baseline_generated, candidate_generated))
    allowed = set(allowed)
    counts = [collections.Counter(u for u, _ in gs) for gs in (old, baseline, candidate)]
    for u in allowed:
        if any(c[u] > 1 for c in counts):
            raise ValueError(f'Affected UUID is ambiguous: {u}')
    old_map, baseline_map, candidate_map = map(dict, (old, baseline, candidate))
    for u in allowed:
        if u in old_map and baseline_map.get(u) != old_map[u]:
            raise ValueError(f'Generator cannot reproduce affected original group: {u}')
        if u not in old_map and u in baseline_map:
            raise ValueError(f'Original and baseline disagree on new UUID: {u}')
        if u not in old_map and u not in candidate_map:
            raise ValueError(f'Allowed UUID is absent from original and candidate: {u}')
    def principal_records(raw):
        records = [raw[i:i + 16] for i in range(0, len(raw), 16)]
        return records[records.index(b'\xfc' * 16):]
    for u in allowed & old_map.keys() & candidate_map.keys():
        if principal_records(old_map[u]) != principal_records(candidate_map[u]):
            raise ValueError(f'Existing principal assignments changed: {u}')
    # An unlisted generated change must never disappear behind the preserved
    # baseline differences: compare generator outputs to one another as well.
    def outside(gs):
        return [(u, raw) for u, raw in gs if u not in allowed]
    if outside(baseline) != outside(candidate):
        raise ValueError('Candidate generator changed a permission group outside the allowlist')
    output = [(u, candidate_map[u]) if u in allowed else (u, raw)
              for u, raw in old if u not in allowed or u in candidate_map]
    # Put added groups next to their generated predecessor, leaving every
    # original unrelated group's bytes and relative order intact.
    for i, (u, raw) in enumerate(candidate):
        if u not in allowed or u in old_map:
            continue
        previous = {v for v, _ in candidate[:i]}
        preceding = [j for j, (v, _) in enumerate(output) if v in previous]
        output.insert(preceding[-1] + 1 if preceding else 0, (u, raw))
    if outside(output) != outside(old):
        raise AssertionError('Unrelated original permissions changed')
    result = b''.join(raw for _, raw in output)
    if groups(result) != output:
        raise AssertionError('Permission roundtrip failed')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('original', 'baseline_generated', 'candidate_generated', 'allowed_json', 'output'):
        parser.add_argument(name, type=pathlib.Path)
    a = parser.parse_args()
    if a.output.exists():
        raise SystemExit('Refusing to overwrite an existing output')
    allowed = json.loads(a.allowed_json.read_text())
    if not isinstance(allowed, list) or not all(isinstance(u, str) for u in allowed):
        raise SystemExit('Allowlist must be a JSON array of UUID strings')
    result = merge(a.original.read_bytes(), a.baseline_generated.read_bytes(),
                   a.candidate_generated.read_bytes(), allowed)
    with a.output.open('xb') as f:
        f.write(result)
    a.output.chmod(0o600)
    print(json.dumps({'bytes': len(result), 'groups': len(groups(result)),
                      'allowed_objects': len(set(allowed))}))


if __name__ == '__main__':
    main()
