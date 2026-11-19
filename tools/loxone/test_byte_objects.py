import unittest
from byte_objects import get, replace, spans


class ByteObjectsTest(unittest.TestCase):
    def test_invalid_unrelated_encoding_is_preserved(self):
        before = b'<Root><C U="a" Title="20\xb0C"/><C U="b" Title="ok"/></Root>'
        after = replace(before, {'b': b'<C U="b" Title="new"/>'})
        self.assertEqual(after, before.replace(b'Title="ok"', b'Title="new"'))
        with self.assertRaises(UnicodeDecodeError):
            get(before, 'a')

    def test_overlapping_edits_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Overlapping'):
            replace(b'<C U="a"><C U="b"/></C>', {'a': b'<C U="a"/>', 'b': b'<C U="b"/>'})

    def test_quote_aware_self_closing_tag_and_utf8_offsets(self):
        raw = '<Root><!-- ä --><C U="a" Title="x>y"/><C U="b"/></Root>'.encode()
        a, b = spans(raw)['a']
        self.assertEqual(raw[a:b], b'<C U="a" Title="x>y"/>')
        self.assertEqual(replace(raw, {'a': raw[a:b]}), raw)

    def test_malformed_new_xml_is_rejected(self):
        with self.assertRaises(Exception):
            replace(b'<Root><C U="a"/></Root>', {'a': b'<C U="a">'})


if __name__ == '__main__':
    unittest.main()
