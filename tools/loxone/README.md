# Offline permission preservation

`scoped_permissions.py` is an offline artifact helper. It does not connect to a
Miniserver, compile a project, or approve an upload.

A complete permission regeneration with `loxone-config` 0.21.0 did not reproduce
this installation's main program: 412 of 418 native groups matched, two audio
server groups were absent, and four other groups differed. The secondary
program's 54 groups reproduced exactly. Therefore do not replace the complete
native permission file with an unchecked generated file.

The helper takes the original native file, a generated baseline, a generated
candidate, and an explicit UUID allowlist. Each affected existing group must
first reproduce exactly in the baseline. It rejects generated changes outside
the allowlist, rejects changes to existing principal assignments, and preserves
every unrelated original group, including unknown
native groups, byte for byte and in its original relative order. Duplicate
UUIDs are rejected when affected; unrelated native duplicates are preserved.

```sh
python3 tools/loxone/scoped_permissions.py original.bin baseline-generated.bin \
  candidate-generated.bin allowed-uuids.json candidate-permissions.bin
python3 -m unittest discover -s tools/loxone -p 'test_*.py'
```

This helper alone does not validate UUID references, app catalogue semantics,
new device definitions, or the PLC program. It must be combined with complete
catalogue/program generation, native validation, fresh backups, and verified
upload/readback before production deployment. Private project archives and
permission files must stay outside this repository.

`byte_objects.py` splices only explicitly selected XML objects. Its parsing view
keeps original byte offsets despite legacy invalid UTF-8; the view is never
written back. `scoped_catalogue.py` changes selected app controls and the update
time, preserving unrelated native entries verbatim. These helpers do not infer
or invent native block schemas.
