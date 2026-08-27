import {
  appendProvedRegisterLines,
  type PendingRegisterAppend,
} from "./append-proved-register-lines.js";
import { openCurationRegisterJournal } from "./curation-register-journal.js";
import type {
  CohortCurationRegisters,
  CurationIdentityPlan,
  CurationIdentityReport,
  ModuleCurationIdentityPlan,
} from "./types.js";

export async function executeCurationIdentityMigration(input: {
  plan: CurationIdentityPlan;
  cohort: CohortCurationRegisters;
  mode: "preview" | "apply";
}): Promise<CurationIdentityReport> {
  const summary = {
    schemaVersion: 1,
    command: "curation migrate",
    mode: input.mode,
    counts: input.plan.counts,
    modules: input.plan.modules.map((module) => publicModule(module)),
    unresolved: input.cohort.unresolved,
  } as const;
  const pending = input.plan.modules.filter(
    ({ migrations }) => migrations.length > 0,
  );

  if (input.mode === "preview" || pending.length === 0) {
    return {
      ...summary,
      outcome: input.plan.outcome,
      appended: 0,
      refusals: [],
    };
  }

  let journalPath: string | undefined;
  const outcome = await appendProvedRegisterLines({
    pending: pending.map(pendingAppend),
    roots: input.cohort,
    journal: async () => {
      const journal = await openCurationRegisterJournal({
        stateRoot: input.cohort.stateRoot,
        kind: "curation-identity",
      });
      journalPath = journal.path;
      return journal;
    },
  });

  if (outcome.refusals.length > 0) {
    return {
      ...summary,
      // Earlier registers in this run already carry their new lines, and no rollback can unwrite
      // them without holding every original. The journal is the record of how far it got.
      outcome: outcome.appended === 0 ? "refused" : "partially-migrated",
      counts: migratedCounts(input.plan, outcome.written),
      modules: input.plan.modules.map((module) =>
        publicModule(module, outcome.written.has(module.module)),
      ),
      appended: outcome.appended,
      refusals: outcome.refusals,
      ...(journalPath === undefined ? {} : { journal: journalPath }),
    };
  }
  return {
    ...summary,
    outcome: "contract-v4",
    counts: migratedCounts(input.plan, outcome.written),
    modules: input.plan.modules.map((module) => publicModule(module, true)),
    appended: outcome.appended,
    refusals: [],
    ...(journalPath === undefined ? {} : { journal: journalPath }),
  };
}

function pendingAppend(
  module: ModuleCurationIdentityPlan,
): PendingRegisterAppend {
  return {
    module: module.module,
    semester: module.semester,
    observedSha256: module.observedSha256,
    sources: module.migrations.map(({ sourceLocation, sha256 }) => ({
      location: sourceLocation,
      sha256,
    })),
    lines: module.migrations.map(({ line }) => line),
  };
}

function publicModule(module: ModuleCurationIdentityPlan, migrated = false) {
  const { migrations, observedSha256: _observed, ...rest } = module;
  return {
    ...rest,
    counts: migrated ? migratedModuleCounts(module) : module.counts,
    migrations: migrations.map(({ line: _line, ...migration }) => migration),
  };
}

function migratedModuleCounts(
  module: ModuleCurationIdentityPlan,
): ModuleCurationIdentityPlan["counts"] {
  return {
    ...module.counts,
    "contract-v4": module.counts["contract-v4"] + module.counts.migrating,
    migrating: 0,
  };
}

// After a run that stopped part-way, `migrating` has to mean what is still owed rather than what
// the plan started with — the modules already appended to are counted as the contract-v4 they now
// carry, and a reader can tell how much is left.
function migratedCounts(
  plan: CurationIdentityPlan,
  migrated: ReadonlySet<string>,
): CurationIdentityPlan["counts"] {
  const done = plan.modules
    .filter(({ module }) => migrated.has(module))
    .reduce((total, { counts }) => total + counts.migrating, 0);
  return {
    ...plan.counts,
    "contract-v4": plan.counts["contract-v4"] + done,
    migrating: plan.counts.migrating - done,
  };
}
