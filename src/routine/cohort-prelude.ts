import {
  type AcademicConfig,
  resolveShelfRoot,
  resolveTasksConfig,
} from "../config/index.js";
import {
  cohortTaskTargets,
  createGoogleTaskRefreshReader,
  refreshTaskRegisters,
  type TaskRefreshModuleReport,
} from "../tasks/index.js";
import {
  createFileShelfIndexStore,
  createFileShelfReader,
  executeShelfCatchUp,
  planShelfCatchUp,
} from "../textbooks/index.js";
import type { MorningPreludePort, PreludeStepReport } from "./types.js";

// The prelude is the part of the morning that needs no judgment, so it is the part that runs before
// any session: the shelf reaches the index, then every cohort register catches up with its live
// list. Both are pull-only — the routine reads Google and writes nothing back to it.
export function createCohortPrelude(
  config: AcademicConfig,
): MorningPreludePort {
  return {
    catchUpShelf: async () => {
      const shelfRoot = await resolveShelfRoot(config);
      const store = createFileShelfIndexStore(shelfRoot);
      const report = await executeShelfCatchUp({
        plan: await planShelfCatchUp({
          reader: createFileShelfReader(shelfRoot),
          index: await store.read(),
        }),
        store,
        mode: "apply",
      });
      return {
        step: "textbook-shelf-catch-up",
        outcome: report.outcome,
        parked: report.counts.parked,
        detail: [
          `${report.counts.books} on the shelf, ${report.counts.indexed} already indexed, ${report.counts.appends} appended`,
          ...report.appends.map(({ key, file }) => `Appended ${key} — ${file}`),
          ...report.parked.map(
            (book) => `Parked ${book.file} — ${book.reason}; ${book.note}`,
          ),
        ],
      };
    },
    pullTaskRegisters: async () => {
      const report = await refreshTaskRegisters({
        targets: cohortTaskTargets(config),
        reader: createGoogleTaskRefreshReader(
          resolveTasksConfig(config).credentials.scheduledRead,
        ),
      });
      const failed = report.modules.filter(
        (module) => module.failure !== undefined,
      );
      return {
        step: "task-register-pull",
        outcome: report.outcome,
        parked: 0,
        detail: report.modules.map(
          (module) =>
            `${module.module} (${module.semester}): ${module.freshness}; ${module.changes.added} added, ${module.changes.updated} updated, ${module.changes.cancelled} newly cancelled`,
        ),
        ...pullFailure(failed),
      } satisfies PreludeStepReport;
    },
  };
}

// A module only reads stale when its own pull threw, so it always carries the reason: the prelude
// hands the Owner that reason rather than the word "stale", which says nothing they can act on.
function pullFailure(
  failed: readonly TaskRefreshModuleReport[],
): Pick<PreludeStepReport, "failure"> {
  return failed.length === 0
    ? {}
    : {
        failure: {
          code: "stale-task-register",
          message: failed
            .map((module) => `${module.module}: ${module.failure?.message}`)
            .join("; "),
        },
      };
}
