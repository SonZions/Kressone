import struct
import unittest
from scoped_permissions import groups, merge


def group(n, principal=0):
    uuid = struct.pack('<IHH', n, 1, n) + b'\xff\xffABCDEF'
    principal_uuid = struct.pack('<IHH', principal, 2, 0) + b'\xff\xffABCDEF'
    return uuid + b'\xfe' * 16 + b'\xfc' * 16 + principal_uuid + b'\xff' * 16


def uid(raw):
    return groups(raw)[0][0]


class ScopedPermissionsTest(unittest.TestCase):
    def test_preserves_native_unknown_groups_and_corrects_only_allowed(self):
        unknown, old, new = group(1, 9), group(2, 3), group(3, 5)
        updated = old[:32] + group(99)[:16] + old[32:]
        original = unknown + old
        result = merge(original, old, updated + new, [uid(old), uid(new)])
        self.assertEqual(result, unknown + updated + new)

    def test_unsupported_affected_baseline_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'reproduce affected'):
            merge(group(1, 9), group(1, 8), group(1, 7), [uid(group(1))])

    def test_unlisted_candidate_change_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'outside the allowlist'):
            merge(group(1) + group(2), group(1) + group(2), group(1, 3) + group(2), [uid(group(2))])

    def test_deletes_only_allowed_group(self):
        self.assertEqual(merge(group(1) + group(2), group(2), b'', [uid(group(2))]), group(1))

    def test_ambiguous_affected_uuid_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'ambiguous'):
            merge(group(1) * 2, group(1), group(1), [uid(group(1))])

    def test_existing_principal_change_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'principal assignments'):
            merge(group(1, 2), group(1, 2), group(1, 3), [uid(group(1))])

    def test_truncated_input_is_rejected(self):
        with self.assertRaises(ValueError):
            groups(group(1)[:-16])
        with self.assertRaises(ValueError):
            groups(group(1)[:-1])


if __name__ == '__main__':
    unittest.main()
