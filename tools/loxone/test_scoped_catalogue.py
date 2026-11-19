import unittest
from scoped_catalogue import update


class CatalogueTest(unittest.TestCase):
    def test_unknown_entries_are_preserved_verbatim(self):
        native = b'"U:old" : {"uuidAction":"old","number":1.000,"nested":{"a":"}\\\""}}'
        before = b'{"lastModified":"before","controls":{' + native + b'},"unknown":[1.000]}'
        after = update(before, {'U:new': {'uuidAction': 'new', 'type': 'Pushbutton'}}, 'after')
        self.assertIn(native, after)
        self.assertIn(b'"unknown":[1.000]', after)
        self.assertIn(b'"lastModified":"after"', after)

    def test_noop_is_byte_identical(self):
        raw = b'\xef\xbb\xbf{ "lastModified":"a", "controls":{} }'
        self.assertEqual(update(raw, {}, 'b'), raw)

    def test_mismatched_identity_is_rejected(self):
        with self.assertRaises(ValueError):
            update(b'{"lastModified":"a","controls":{}}', {'U:a': {'uuidAction': 'b'}}, 'b')


if __name__ == '__main__':
    unittest.main()
