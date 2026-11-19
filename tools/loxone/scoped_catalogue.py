"""Edit explicitly selected LoxAPP3 controls without rewriting unknown entries."""
import json

DECODER = json.JSONDecoder()


def members(text, start):
    def ws(i):
        while i < len(text) and text[i].isspace():
            i += 1
        return i
    i = ws(start)
    if text[i] != '{':
        raise ValueError('Expected JSON object')
    i = ws(i + 1)
    entries = []
    while text[i] != '}':
        begin = i
        key, end = DECODER.raw_decode(text, i)
        if not isinstance(key, str):
            raise ValueError('Expected string key')
        i = ws(end)
        if text[i] != ':':
            raise ValueError('Expected colon')
        value_start = ws(i + 1)
        value, value_end = DECODER.raw_decode(text, value_start)
        entries.append((key, begin, value_start, value_end, value))
        i = ws(value_end)
        if text[i] == '}':
            break
        if text[i] != ',':
            raise ValueError('Expected comma')
        i = ws(i + 1)
    if len({e[0] for e in entries}) != len(entries):
        raise ValueError('Duplicate JSON keys')
    return entries, i


def update(raw, replacements, modified):
    text = raw.decode('utf-8')
    root_start = 1 if text.startswith('\ufeff') else 0
    root, _ = members(text, root_start)
    root_map = {e[0]: e for e in root}
    controls = root_map['controls']
    entries, end = members(text, controls[2])
    existing = {e[0]: e[4] for e in entries}
    for key, value in replacements.items():
        if not key.startswith('U:'):
            raise ValueError('Expected U: control key')
        if value is not None and value.get('uuidAction') != key[2:]:
            raise ValueError('Control key and action UUID differ')
        if value is None and key not in existing:
            raise ValueError('Cannot remove absent control')
    changed = {key: value for key, value in replacements.items() if existing.get(key) != value}
    if not changed:
        return raw
    values = []
    for key, begin, value_start, value_end, value in entries:
        if key not in changed:
            values.append(text[begin:value_end])
        elif changed[key] is not None:
            values.append(json.dumps(key) + ':' + json.dumps(changed[key], ensure_ascii=False, separators=(',', ':')))
    for key, value in changed.items():
        if key not in existing:
            values.append(json.dumps(key) + ':' + json.dumps(value, ensure_ascii=False, separators=(',', ':')))
    edits = [(controls[2], end + 1, '{' + ',\n'.join(values) + '}')]
    last = root_map['lastModified']
    edits.append((last[2], last[3], json.dumps(modified)))
    for a, b, value in sorted(edits, reverse=True):
        text = text[:a] + value + text[b:]
    result = text.encode('utf-8')
    before = json.loads(raw.decode('utf-8-sig'))
    after = json.loads(result.decode('utf-8-sig'))
    expected = dict(before['controls'])
    for key, value in changed.items():
        if value is None:
            del expected[key]
        else:
            expected[key] = value
    assert after['controls'] == expected
    assert {k: v for k, v in before.items() if k not in ('controls', 'lastModified')} == {
        k: v for k, v in after.items() if k not in ('controls', 'lastModified')}
    return result
