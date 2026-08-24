import type {
  CuratedItem,
  ModulePassReport,
  PreludeStepName,
  PreludeStepReport,
  RetentionPurge,
  RoutineFailure,
} from "./types.js";

const preludeStepTitles: Record<PreludeStepName, string> = {
  "textbook-shelf-catch-up": "Textbook shelf catch-up",
  "task-register-pull": "Task register pull",
};

// Every section and every bucket is present on every morning, empty or not: a reader comparing two
// mornings is comparing the same document, and a missing heading means the run stopped, not that the
// heading had nothing to say.
export function renderMorningReport(input: {
  date: string;
  prelude: readonly PreludeStepReport[];
  modules: readonly ModulePassReport[];
  purge: RetentionPurge;
}): string {
  return [
    `# Morning report ${input.date}`,
    "",
    "## Prelude",
    "",
    ...input.prelude.flatMap(renderPreludeStep),
    "",
    "## Modules",
    "",
    ...(input.modules.length === 0
      ? ["_No modules in the monitoring cohort._", ""]
      : input.modules.flatMap(renderModulePass)),
    "## Retention purge",
    "",
    ...bucket("Session artifacts", input.purge.sessions, (date) => date),
    ...bucket("Reports", input.purge.reports, (date) => date),
    "",
  ].join("\n");
}

function renderPreludeStep(step: PreludeStepReport): string[] {
  return [
    `- ${preludeStepTitles[step.step]} — ${step.outcome}`,
    ...step.detail.map((line) => `  - ${line}`),
    `  - Parked — ${step.parked}`,
    ...(step.failure === undefined
      ? []
      : [`  - Failed — ${renderFailure(step.failure)}`]),
  ];
}

function renderModulePass(module: ModulePassReport): string[] {
  return [
    `### ${module.module} — ${module.semester}`,
    "",
    ...bucket("Curated", module.curated, renderPlacement),
    ...bucket(
      "Rederived",
      module.rederived,
      (item) => `${item.item} → ${item.derived.join(", ")}`,
    ),
    ...bucket("Superseded", module.superseded, (item) =>
      item.destination === undefined
        ? item.item
        : `${item.item} → ${item.destination}`,
    ),
    ...bucket(
      "Parked",
      module.parked,
      (item) => `${item.item} — ${item.reason}; evidence: ${item.evidence}`,
    ),
    ...bucket(
      "Doc writes",
      module.docWrites,
      (write) => `${write.file} — ${write.summary}`,
    ),
    ...bucket("Failures", module.failures, renderFailure),
    `- Artifacts — ${module.artifacts}`,
    "",
  ];
}

function bucket<Entry>(
  title: string,
  entries: readonly Entry[],
  render: (entry: Entry) => string,
): string[] {
  return [
    `- ${title} — ${entries.length}`,
    ...entries.map((entry) => `  - ${render(entry)}`),
  ];
}

function renderPlacement(item: CuratedItem): string {
  return `${item.item} → ${item.destination}`;
}

function renderFailure(failure: RoutineFailure): string {
  return `${failure.code}: ${failure.message}`;
}
