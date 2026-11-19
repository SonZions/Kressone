"""Lossless XML object splices; unrelated bytes including invalid UTF-8 survive."""
from xml.parsers import expat
from xml.etree import ElementTree as ET


def spans(raw):
    # Substitute invalid byte sequences only in a disposable parsing view.
    # Every substituted surrogate corresponds to one original byte, so byte
    # offsets remain valid. The view is never serialized or returned.
    view = ''.join('?' if 0xdc80 <= ord(c) <= 0xdcff else c
                   for c in raw.decode('utf-8', errors='surrogateescape')).encode('utf-8')
    assert len(view) == len(raw)
    parser = expat.ParserCreate()
    stack, found = [], {}
    def start(name, attrs):
        pos = parser.CurrentByteIndex
        quote = None
        close = pos
        for i in range(pos, len(raw)):
            c = raw[i]
            if quote is not None:
                if c == quote:
                    quote = None
            elif c in (34, 39):
                quote = c
            elif c == 62:
                close = i + 1
                break
        if close == pos:
            raise ValueError('Unterminated start tag')
        stack.append((name, attrs.get('U'), pos, close, raw[pos:close].rstrip().endswith(b'/>')))
    def end(name):
        tag, uuid, begin, close, short = stack.pop()
        assert name == tag
        finish = close if short else raw.index(b'>', parser.CurrentByteIndex) + 1
        if tag == 'C' and uuid:
            if uuid in found:
                raise ValueError('Duplicate object UUID')
            found[uuid] = (begin, finish)
    parser.StartElementHandler, parser.EndElementHandler = start, end
    parser.Parse(view, True)
    return found


def get(raw, uuid):
    a, b = spans(raw)[uuid]
    # Affected object must itself be valid UTF-8; replacement decoding is forbidden.
    return ET.fromstring(raw[a:b].decode('utf-8'))


def replace(raw, objects):
    positions = spans(raw)
    changes = sorted((positions[u][0], positions[u][1], value) for u, value in objects.items())
    for (a, b, _), (c, d, _) in zip(changes, changes[1:]):
        if b > c:
            raise ValueError('Overlapping object edits')
    result = bytearray(); end = 0
    for a, b, value in changes:
        if value:
            ET.fromstring(value.decode('utf-8'))
        result += raw[end:a] + value
        end = b
    result += raw[end:]
    # Existing encoding defects remain untouched; the same parser still accepts structure.
    spans(bytes(result))
    return bytes(result)
