# Native inventory boundary

`migration inventory --root <physical-root> --json` observes native representation for later preservation and stale-source checks.
It grants no copy admission, migration, application or cutover authority.
Mounted audit remains a separate conformance observation with its existing exclusions and digest protocol.

The versioned owner is `src/migration/native-inventory/`. Its committed JSON Schemas generate the TypeScript declarations through `npm run controls:generate`.
Raw relative paths, symlink targets, xattr names and retained payloads use lowercase hexadecimal bytes.
The root entry has an empty relative path. Sorting compares raw bytes, with no Unicode normalization or academic classification.
Every observed native entry participates, including dot files, scratch directories, `.DS_Store` and `Icon\r`.

## Native observations

The macOS adapter records complete membership, explicit entry kinds, regular-file SHA-256, raw link targets and hardlink relationships.
Stat evidence includes device, inode, device identifier, full mode, owner, group, link count, flags and nanosecond modification, change, birth and access times.
ACL payloads retain Darwin `acl_copy_ext` bytes and their SHA-256 under the named encoding.
Xattr payloads retain exact bytes and SHA-256, including Finder information, resource forks and compression attributes exposed by `XATTR_SHOWCOMPRESSION`.
An absent ACL is represented by an empty payload. An unreadable ACL or attribute is represented by `null` and diagnostics.

`sourceFingerprint` hashes the versioned ordered source representation and root locator.
It includes source device, inode and change time, so it is not a copy-preservation equality digest.
Access times remain observed evidence but are excluded from this fingerprint because reads may advance them.
Copies naturally change device, inode, change time and some platform provenance. A later bound preservation policy must define those comparisons explicitly.
No preservation-equality or canonical-record conversion is implemented here.

## Safety and limits

The adapter requires a quiescent source on a cooperating local filesystem.
It opens each root ancestor without following symbolic links, pins directory descriptors, compares opened identities and observes two complete walks.
It checks directory identity after descendants and root ancestry after each walk.
Different membership, identities, bytes or retained metadata between walks refuse the observation.
This is an explicitly non-atomic observation. It cannot prove one simultaneous filesystem state or protect against arbitrary hostile swaps between syscalls.
A later snapshot or writer-pause protocol remains necessary when authoritative migration requires stronger coherence.

Symlinks are observed through Darwin link descriptors and are never traversed.
Known special files are never opened. Their unavailable ACL and xattr observations prevent completeness.
Dataless entries are refused before content reads, preventing intentional placeholder hydration.
Cross-device entries and regular files with links outside complete root membership refuse.
Unknown entry kinds, unsupported metadata, unreadable entries and collection limits prevent a complete result.

The adapter permits 256 levels, one million entries, 32 MiB per retained attribute and 256 MiB each for helper output and the serialized result.
The helper process is killed after 120 seconds or output overflow. Such failures and oversized serialized results return incomplete diagnostics, never a truncated successful manifest.
Diagnostics retain at most 128 entries with an explicit omitted count.
`observed` exits zero. `incomplete` and `refused` exit two.

The optional `--log` creates an exclusive mode-0600 file in an existing private owner directory outside the source and repository.
Log ancestors must be physical directories. No source bytes, metadata, controls or provider state are intentionally written.
Filesystem access-time updates remain possible.

## Build and portability

`npm run build` compiles the bundled C source with the macOS Command Line Tools into owned `dist` output.
Inventory never compiles code or accepts a caller-supplied helper path.
The build binds compiler identification, source SHA-256, executable SHA-256 and architecture.
Runtime verifies the bundled source and executable against that binding before execution.
This binds build artifacts together. It does not attest the compiler or defend a compromised installation.

Other platforms return `unsupported-platform` with `complete: false`.
Portable tests exercise schema boundaries, raw bytes, stable aggregation, hardlink and membership checks, diagnostics and unsupported execution.
Native macOS fixtures exercise the compiled CLI against actual filesystem metadata. Linux CI does not establish Darwin metadata coverage.
