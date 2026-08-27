import {
  appendProvedRegisterLines,
  type PendingRegisterAppend,
} from "./append-proved-register-lines.js";
import { openCurationRegisterJournal } from "./curation-register-journal.js";
import type {
  CohortCurationRederivations,
  CurationRederivationPlan,
  CurationRederivationReport,
  ModuleCurationRederivationPlan,
} from "./rederivation-types.js";

export async function executeCurationRederivation(input: {
  plan: CurationRederivationPlan;
  cohort: CohortCurationRederivations;
  mode: "preview" | "apply";
}): Promise<CurationRederivationReport> {
  const summary = {
    schemaVersion: 1,
    command: "curation rederive",
    mode: input.mode,
    counts: input.plan.counts,
    modules: input.plan.modules.map((module) => publicModule(module)),
    unresolved: input.cohort.unresolved,
  } as const;
  const pending = input.plan.modules.filter(
    ({ rederivations }) => rederivations.length > 0,
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
        kind: "curation-rederivation",
      });
      journalPath = journal.path;
      return journal;
    },
  });

  if (outcome.refusals.length > 0) {
    return {
      ...summary,
      outcome: outcome.appended === 0 ? "refused" : "partially-corrected",
      counts: correctedCounts(input.plan, outcome.written),
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
    outcome: "settled",
    counts: correctedCounts(input.plan, outcome.written),
    modules: input.plan.modules.map((module) => publicModule(module, true)),
    appended: outcome.appended,
    refusals: [],
    ...(journalPath === undefined ? {} : { journal: journalPath }),
  };
}

function pendingAppend(
  module: ModuleCurationRederivationPlan,
): PendingRegisterAppend {
  return {
    module: module.module,
    semester: module.semester,
    observedSha256: module.observedSha256,
    sources: module.rederivations.map(({ sourceLocation, sha256 }) => ({
      location: sourceLocation,
      sha256,
    })),
    lines: module.rederivations.map(({ line }) => line),
  };
}

function publicModule(
  module: ModuleCurationRederivationPlan,
  corrected = false,
) {
  const { rederivations, observedSha256: _observed, ...rest } = module;
  return {
    ...rest,
    counts: corrected ? correctedModuleCounts(module) : module.counts,
    rederivations: rederivations.map(
      ({ line: _line, ...correction }) => correction,
    ),
  };
}

function correctedModuleCounts(
  module: ModuleCurationRederivationPlan,
): ModuleCurationRederivationPlan["counts"] {
  return {
    ...module.counts,
    settled: module.counts.settled + module.counts.rederiving,
    rederiving: 0,
  };
}

// After a run that stopped part-way, `rederiving` has to mean what is still owed rather than what
// the plan started with — the modules already appended to are counted as the settled they now are,
// and a reader can tell how much is left.
function correctedCounts(
  plan: CurationRederivationPlan,
  corrected: ReadonlySet<string>,
): CurationRederivationPlan["counts"] {
  const done = plan.modules
    .filter(({ module }) => corrected.has(module))
    .reduce((total, { counts }) => total + counts.rederiving, 0);
  return {
    ...plan.counts,
    settled: plan.counts.settled + done,
    rederiving: plan.counts.rederiving - done,
  };
}
