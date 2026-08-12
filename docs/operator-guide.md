# V1 operator guide

V1 has two user commands: `seed` and `audit`. It does not execute repairs, manage a recovery
vault, schedule weekly LLM work or edit module instructions autonomously.

## Configure

Copy `academic-os.config.example.json` to the gitignored `academic-os.config.json`. Set the Drive
mount, a private state root outside both Drive and this repository, exactly one active semester,
and explicit semester/module mappings. Add `seedTarget` only for the approved module to seed.
Optional Drive API inventory needs an exact module-folder ID and read-only application-default
credentials; mounted inventory remains the baseline.

## Seed

Supply an approved Profile and Definition. The default is a non-mutating preview:

```sh
node dist/src/cli.js seed --config academic-os.config.json \
  --profile /path/to/approved-profile.md \
  --definition /path/to/approved-definition.yaml
```

Review every operation, then add `--apply`. Apply is additive: any conflict blocks publication;
existing content is never overwritten, moved, renamed or removed. A new module becomes visible at
its final code only through one atomic rename of its complete validated staging tree. An
interrupted apply retains its append-only journal under `stateRoot`. Rerun without `--resume` to
recheck the target and show completed/remaining operations; continue only when it reports
`safely-resumable`, using `--apply --resume`. Keep that journal as recovery evidence until the
result is settled.

## Audit

`audit --config academic-os.config.json` selects only the configured active cohort. Name both
`--semester` and `--module` for an explicit read-only target, including a past module used for
acceptance evidence. Add `--migration` only when a configured past module should receive
historical-migration interpretation; it never enrols or changes the module.

Human output is the default. `--json` emits the versioned report used by automation. Both expose
the same findings, applicability, evidence and enforcement:

| Exit | Meaning |
|---:|---|
| 0 | Conformant or advisory-only |
| 1 | Contract deviation |
| 2 | Unsafe/incomplete inventory, configuration or operation |
| 3 | Human decision or manual review required |

Every audit appends a complete private observation under `stateRoot`; reports and observations
contain metadata and filenames, so do not commit them. Current mismatch is a **deviation**. Only a
change between compatible observations is **drift**. A historical contract gap or contract-version
upgrade is migration evidence, not permission to repair or change the contract.

## Operate safely

- Preview is non-mutating; apply requires the explicit flag.
- Audit has no repair path and no write-capable Drive API dependency.
- A contract change edits `docs/module-folder-contract.md`; a repair changes a real module only
  through a separately approved future workflow.
- Run `npm run check`, `npm run rule-coverage:check` and `npm run privacy:check` before publication.
- Follow `docs/agents/safe-drive-testing.md` before any Drive write or integration test.
