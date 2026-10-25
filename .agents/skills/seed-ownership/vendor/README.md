# Pinned TLC artifact

`tla2tools.jar` is the unmodified official standalone TLA+ Tools prerelease built from
[`2ef2af8c767b76e5db5cba2878f027ac07aad36c`](https://github.com/tlaplus/tlaplus/commit/2ef2af8c767b76e5db5cba2878f027ac07aad36c),
source tree `a3d7aaebdc236b69cc0d9059a6a42006ae43aa5f`.
The authoritative admitted identity and exact banner live in [`../tlc-toolchain.mjs`](../tlc-toolchain.mjs).
This artifact has 4,502,259 bytes and SHA-256 `d15655eeaff4b3f7b3d65c46b838bc0f35d131b2ef4b1e473689b62c98d4726f`.
It was retained from official GitHub release asset
[`670958559`](https://api.github.com/repos/tlaplus/tlaplus/releases/assets/670958559),
published under the moving [v1.8.0 release](https://github.com/tlaplus/tlaplus/releases/tag/v1.8.0).
That channel is replaced by upstream automation. It is not a stable 1.8.0 release pin.

The 4.3 MiB nonacademic tool is tracked so a cold checkout verifies offline.
Ordinary execution neither downloads nor builds it. `TLA2TOOLS_JAR` selects another location
for exactly the same bytes. Preparation copies verified bytes alone into a fresh owned
read-only directory because the unchanged upstream manifest names the optional neighbors
`CommunityModules-deps.jar` and `CommunityModules.jar`.
The Java environment excludes inherited classpath, library and agent injection.
The selected Java executable, verifier source and same-user filesystem trust remain premises.

The [upstream MIT license](https://github.com/tlaplus/tlaplus/blob/2ef2af8c767b76e5db5cba2878f027ac07aad36c/LICENSE)
is copied as [`LICENSE`](LICENSE). All embedded third-party notices remain in the unmodified jar,
including JavaMail, JLine and Commons Math licenses.

Upstream [`6fde5a9ea3967191118ce18b27878a9b4b24f77f`](https://github.com/tlaplus/tlaplus/commit/6fde5a9ea3967191118ce18b27878a9b4b24f77f)
removes the fingerprint set's RMI-exporting superclass and unexport calls.
The pinned prerelease therefore completes ordinary BFS inside the existing repository sandbox
without a TCP listener grant. The upgrade spans 1,676 upstream commits from the former 1.7.4 pin.
All nineteen unchanged finite configurations matched that former tool's generated, distinct and
queued state counts and expected invariant identities during adoption. This is bounded
compatibility evidence, not equivalence for arbitrary specifications or distributed TLC.

An independent build of this immutable upstream source also matched all nineteen outcomes and
state counts. Follow the revision's [build instructions](https://github.com/tlaplus/tlaplus/blob/2ef2af8c767b76e5db5cba2878f027ac07aad36c/DEVELOPING.md)
to investigate replacements. The normal Ant build varies manifest and ZIP metadata; the
source-build experiment does not establish one universal reproducible whole-jar hash.
Replacement bytes require a deliberate identity update, native sandbox controls, unchanged
nineteen-case comparison and the complete runtime, mutation and restoration gate.
