import {
  MAINTENANCE_DOMAINS,
  MAINTENANCE_STATUSES,
  maintenanceDomainLabel,
} from "./maintenance-domains.js";
import type { ModulePassReport, PreludeStepReport } from "./types.js";

const publicFailureCodes = new Set([
  "ENOENT",
  "EACCES",
  "EPERM",
  "ETIMEDOUT",
  "invalid-config",
  "operational-failure",
  "prelude-failed",
  "session-failed",
  "session-runner-failed",
  "session-result-unreadable",
  "session-exit",
  "post-audit-regression",
  "post-audit-residual",
  "post-audit-unreadable",
  "import-status-invalid",
  "import-status-noncurrent",
  "import-status-unavailable",
  "stale-task-register",
  "incomplete-maintenance-coverage",
  "invalid-maintenance-domain",
  "duplicate-maintenance-domain",
  "invalid-maintenance-entry",
  "unreadable-bucket",
  "unreadable-entry",
  "write-journal-unreadable",
  "write-journal-operation-incomplete",
  "write-journal-invalid",
]);
const preludeTitles = {
  "import-status": "Importer health",
  "textbook-shelf-catch-up": "Textbook shelf catch-up",
  "task-register-pull": "Task register pull",
} as const;
const outcomes = new Set([
  "current",
  "attention",
  "invalid",
  "unavailable",
  "previewed",
  "requires-decision",
  "noncurrent",
  "caught-up",
  "parked",
  "refreshed",
  "partially-refreshed",
  "stale",
  "failed",
]);

// Public issues expose fixed labels and counts; source prose and paths remain in private reports.
export function renderPublicMorningReport(input: {
  date: string;
  prelude: readonly PreludeStepReport[];
  modules: readonly ModulePassReport[];
}): string {
  return [
    `# Morning report ${input.date}`,
    "",
    "Detailed evidence is retained in the private local morning report.",
    "",
    "## Prelude",
    "",
    ...input.prelude.map(
      (step) =>
        `- ${preludeTitles[step.step]} — ${outcomes.has(step.outcome) ? step.outcome : "requires review"}; parked ${step.parked}; failures ${step.failure === undefined ? 0 : 1}`,
    ),
    "",
    "## Maintenance",
    "",
    ...input.modules.flatMap((module, index) => [
      `### Target ${index + 1}`,
      "",
      `- Maintenance coverage — ${module.maintenance.length}`,
      ...module.maintenance.map(
        (entry) =>
          `  - ${MAINTENANCE_DOMAINS.some((domain) => domain.id === entry.domain) ? maintenanceDomainLabel(entry.domain) : "Unknown domain"} — ${MAINTENANCE_STATUSES.includes(entry.status) ? entry.status : "requires review"}`,
      ),
      ...(
        [
          "curated",
          "rederived",
          "superseded",
          "withdrawn",
          "parked",
          "docWrites",
          "noted",
        ] as const
      ).map((key) => `- ${key} — ${module[key].length}`),
      `- Failures — ${module.failures.length}`,
      ...module.failures.map(
        ({ code }) =>
          `  - ${publicFailureCodes.has(code) ? code : "maintenance-failure"}`,
      ),
      "",
    ]),
  ].join("\n");
}
