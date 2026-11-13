# External operational storage

Use this procedure when installing an Academic OS LaunchAgent whose operational state must stay on a designated external volume. The policy is a private JSON file outside git. Each installer accepts `--storage-policy <absolute-path>`; without it, existing host behavior applies. Once installed with a policy, every reinstall must supply one; the installer refuses an unguarded replacement. A guarded job refuses to start its child when the required mount, UUID, or disk-image backing is unavailable.

## Inventory and boundary

| Owner | Write path | Configuration |
|---|---|---|
| CLI state, mirrors, journals, morning reports and state-refresh status | `stateRoot` | Private application config |
| Morning and state-refresh launcher receipts | `stateRoot/morning-launcher`, `stateRoot/state-refresh-launcher` | Same config |
| Guarded child temporary files | `tempRoot` | Private storage policy; sets `TMPDIR`, `TMP`, `TEMP`, `SQLITE_TMPDIR` |
| Guarded child caches | `cacheRoot` | Policy; sets `XDG_CACHE_HOME`, `npm_config_cache`, `UV_CACHE_DIR`, `PIP_CACHE_DIR` |
| Guarded child state | `stateRoot` | Policy; sets `XDG_STATE_HOME` |
| Guarded Operations server log | `logRoot/operations-server.log` | Policy; opened after storage validation |
| Runtime, build output and dependencies | Checkout and installed toolchain paths | Choose external checkout/toolchain paths for host migration |
| Verification and retained evidence | Run-specific proof roots | Set explicitly outside the system volume |

LaunchAgent plists stay in macOS's `~/Library/LaunchAgents`; launchd, authentication tools, and the OS may write their own files. The guard does not redirect `HOME` or control an arbitrary descendant's hardcoded path. Audit those owners separately before claiming a system-volume-free host. In guarded plists, launchd opens only `/dev/null` for standard output and error. The wrapper opens the Operations log after validation.

## Private policy

Create the file with owner-only permissions. Precreate every named path. Use exact mounted paths and UUIDs reported by `diskutil info -plist`; for an attached disk image, also identify its physical backing volume with `hdiutil info -plist`.

```json
{
  "schemaVersion": 1,
  "configPath": "/Volumes/EXTERNAL/config/academic-os.config.json",
  "stateRoot": "/Volumes/EXTERNAL/state/academic-os",
  "tempRoot": "/Volumes/EXTERNAL/tmp/academic-os",
  "cacheRoot": "/Volumes/EXTERNAL/cache/academic-os",
  "logRoot": "/Volumes/EXTERNAL/logs/academic-os",
  "requiredVolumes": [
    { "mountPoint": "/Volumes/EXTERNAL", "volumeUUID": "EXPECTED-UUID" }
  ]
}
```

For a disk image, add its mounted volume to `requiredVolumes` with `backing`:

```json
{
  "mountPoint": "/Volumes/IMAGE",
  "volumeUUID": "IMAGE-UUID",
  "backing": {
    "mountPoint": "/Volumes/PHYSICAL",
    "volumeUUID": "PHYSICAL-UUID"
  }
}
```

List the physical volume too when it holds the config or other policy roots. The guard resolves every policy path, confirms its filesystem device matches a required mounted UUID, checks the config's `stateRoot`, and checks an image's attached device and backing file's filesystem device. A directory left behind at the mount path on the system volume does not satisfy the mount check. Precreate the roots; the runner creates only its named cache subdirectories after validation.

## Migrate and verify

1. Capture current service identities, configuration, state and evidence roots. Stop affected jobs before copying. Preserve original state, journals, locks, receipts and logs.
2. Copy with metadata preserved to the designated volume. Compare a complete source and destination inventory, file content hashes, symlink targets and protected metadata before changing the config. Resolve interrupted copies before cutover; keep the source recovery copy. If an opaque OS attribute is normalized by the copy, retain a complete immutable archive of original raw metadata and every payload, then independently verify the archive, fresh source and exact live differences under an explicitly named archival-recovery gate. Keep physical metadata equality marked failed; do not infer private attribute restoration semantics.
3. Update private `stateRoot` and policy paths together. Precreate the policy roots with owner-only permissions. Build from the chosen external checkout and preview each installer with `--config ... --storage-policy ... --dry-run`. For a stopped, unloaded old LaunchAgent, back up and verify the exact stale descriptor and its unloaded state before retiring that descriptor for reinstall; retain bootout errors and backup evidence. Keep the installer's guard checks intact.
4. Install with the same paths, inspect the loaded plist and kickstart the exact service. Confirm the child's configured state, receipt or Operations log on the designated volume. Check service behavior through its public health/readback route.
5. Test a missing mount and a wrong UUID in an isolated fixture or stopped service. Both must fail before child start or new state/temp/cache/log creation. Restore the correct mount and verify service recovery. Retain source evidence until the new copy and service have been read back.

Do not delete a source tree merely because a copy command exited zero. A protected directory, FIFO fixture, registered worktree or active service state needs explicit ownership and content verification before any removal.
