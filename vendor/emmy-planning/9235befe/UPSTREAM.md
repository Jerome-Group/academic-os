# Emmy planning verification dependency

Repository: [jerome-queck/emmy](https://github.com/jerome-queck/emmy).
The exact reviewed local source commit is `9235befe03916b776ba40c6234d9e83716667b3f`.
GitHub's commit lookup returned no commit for that hash during dependency review;
it is not a publicly reachable upstream ref. Files come from the reviewed retained
compact runtime, not a fresh checkout of the repository's moving branch.

`runtime/` retains all 16 manifest-listed source files and the unchanged
`planning-source-manifest.json`. Its SHA-256 is
`21ab6319f4bafecdf55d920cecdc72f1b8c1d7c313aa9102a4e89c54343c40a3`.
The manifest records every source file's original path, size and SHA-256, entrypoint,
Node requirement and unchanged dependency base
`aef45b9bd76b5a8bfd2acf6ac1ae304562b21f54`.
The adapter verifies that exact closure before running its private copy.

The MIT notice is preserved verbatim in sibling `LICENSE` (1069 bytes, SHA-256
`58755b8e71337177b1dfe00e0fe5d502ca8263743613816f6645c23767a6584e`).
It sits outside the validated release root, which rejects unlisted files.

Two unchanged synthetic helpers from retained fixture commit
`aef45b9bd76b5a8bfd2acf6ac1ae304562b21f54` live under
`test/support/emmy-planning-fixtures/verification/`. Their original paths and pins:

| Upstream path | Bytes | SHA-256 |
|---|---:|---|
| `verification/academic-os-plan-fixtures.mjs` | 3663 | `1a5408b97b9ca870b8a641d09afef5d4edef29034b81f110ee0f4d499f8f48ca` |
| `verification/academic-os-planning-fixtures.mjs` | 1466 | `a0f4b768b60de9571c80bc12fde4b40c4aab06cca13f83a3f3cf1d43c454ae81` |

`test/support/emmy-planning-source.ts` pins the manifest, helpers and bundled license.
Both producer suites use these defaults and fail on absent or changed inputs.
`ACADEMIC_OS_TEST_EMMY_RELEASE` and `ACADEMIC_OS_TEST_EMMY_FIXTURES` retain explicit
private path overrides for the same reviewed source and helper pins.
No production configuration, policy catalog, credential or Owner data is included.
The installed service still requires its own explicit producer and private source configuration.

Upstream bytes are excluded from Biome rewriting. To change this dependency, review a new
bounded source closure and its license, retain new exact pins and provenance, and rerun the
real-producer suites with zero skips. Do not refresh timestamps or turn synthetic policy into
installed authority.
