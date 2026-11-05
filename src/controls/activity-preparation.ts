import type {
  Judgment,
  Preparation,
  PrepareInput,
  RequestedScope,
  StoredCloseout,
  Target,
} from "../module-activity/generated/workflow.js";
import {
  type ActivityClosure,
  readActivityClosure,
  sameValue,
} from "./activity-closure.js";
import { activityRefusal } from "./activity-failure.js";
import {
  activityProcedureRegistry,
  activityRegistryDigest,
} from "./activity-registry.js";
import { digest } from "./canonical-json.js";
import type { LearningRecord } from "./generated/module-data-1.js";
import type { ControlReadInput } from "./types.js";

export const activityWrites = [
  "learning-records:append",
  "evidence:append",
  "retained-inputs:create",
] as const;

export function recognizeActivityProtocol(closure: ActivityClosure) {
  const protocol = closure.control("learning-workspace").activityProtocol;
  if (!protocol)
    activityRefusal(
      "missing-prerequisite",
      "Activity protocol absent; controls remain readable.",
      "unsupported",
    );
  const bytes = closure.evidenceBytes(protocol.procedureEvidenceId);
  const preferences = closure.control("preferences");
  const binding = activityProcedureRegistry.find(
    (b) =>
      b.bindingId === protocol.bindingId &&
      b.procedureSha256 === bytes.byteSha256,
  );
  if (
    !binding ||
    binding.moduleCode !== closure.read.shape.head.moduleCode ||
    protocol.profileRegistryDigest !== activityRegistryDigest
  )
    activityRefusal(
      "unsupported-procedure",
      "Exact full procedure and registry binding is unrecognized.",
      "unsupported",
    );
  const shared = preferences.sharedBundle;
  if (
    shared.id !== binding.sharedId ||
    shared.version !== binding.sharedVersion ||
    shared.byteSha256 !== binding.sharedSha256
  )
    activityRefusal(
      "preference-conflict",
      "Exact shared preference combination is unrecognized.",
      "needs-judgment",
    );
  if (preferences.refinements.length)
    activityRefusal(
      "preference-conflict",
      "Local refinement meaning is unrecognized; accepted author strings do not establish authority.",
      "needs-judgment",
    );
  return { protocol, bytes, binding };
}

export function resolveActivityPreparation(input: {
  before: ControlReadInput;
  request: PrepareInput;
  releaseDigest: string;
}): Preparation {
  const closure = readActivityClosure(input.before);
  return prepareFromClosure(closure, input.request, input.releaseDigest);
}

export function prepareFromClosure(
  closure: ActivityClosure,
  request: PrepareInput,
  releaseDigest: string,
): Preparation {
  const recognized = recognizeActivityProtocol(closure);
  const map = closure.control("source-map");
  if (map.availability.kind !== "mapped")
    activityRefusal(
      "missing-prerequisite",
      "Declared ordered Source Map is unavailable.",
      "needs-judgment",
    );
  const selection = request.selection;
  let target: Target;
  if (selection.kind === "exact") target = selection.target;
  else {
    if (selection.activity !== "revision")
      activityRefusal(
        "unsupported-native-source",
        "Native activity sources and output owner are unavailable.",
        "unsupported",
      );
    if (recognized.binding.revisionRule === "contiguous-block-revision")
      activityRefusal(
        "grouping-required",
        "Choose an exact revision span with retained grouping judgment; source order alone cannot decide a useful block.",
        "needs-judgment",
      );
    const learning = closure.control("learning-records");
    const covered = standingActivityCoverage(
      learning.records,
      learning.activityCloseouts,
    );
    const next = map.units
      .flatMap((unit) => unit.topics.map((topic) => ({ unit, topic })))
      .find(({ unit, topic }) => !covered.has(`${unit.id}\0${topic.id}`));
    if (!next)
      activityRefusal(
        "missing-prerequisite",
        "No uncovered declared revision topic remains.",
        "needs-judgment",
      );
    target = {
      kind: "revision",
      unit: { kind: "unit", id: next.unit.id },
      topics: [{ kind: "topic", id: next.topic.id }],
    };
  }
  if (target.kind !== "revision")
    activityRefusal(
      "unsupported-native-source",
      `${target.kind} requires admitted native sources, attempts and conditional output verification.`,
      "unsupported",
    );
  const unit = map.units.find((u) => u.id === target.unit.id);
  if (!unit)
    activityRefusal(
      "foreign-target",
      "Target unit does not belong to this Module.",
    );
  const topics = target.topics.map((t) => t.id);
  const positions = topics.map((id) =>
    unit.topics.findIndex((t) => t.id === id),
  );
  if (
    positions.some(
      (n, i) => n < 0 || (i > 0 && n !== (positions[i - 1] ?? -2) + 1),
    ) ||
    new Set(topics).size !== topics.length
  )
    activityRefusal(
      "foreign-target",
      "Revision topics must be exact ordered contiguous members of one unit.",
    );
  if (
    recognized.binding.revisionRule === "single-topic-revision" &&
    topics.length !== 1
  )
    activityRefusal(
      "unsupported-procedure",
      "This exact full procedure permits only one revision topic.",
      "unsupported",
    );
  const instructions = request.sessionInstructions ?? [];
  for (const instruction of instructions) {
    if (instruction.kind !== "grouping")
      activityRefusal(
        "preference-conflict",
        "Session instruction meaning is unsupported; it cannot create standing authority.",
        "needs-judgment",
      );
    checkActivityJudgment(closure, instruction, "grouping", digest(target));
  }
  if (topics.length > 1 && !instructions.some((j) => j.kind === "grouping"))
    activityRefusal(
      "grouping-required",
      "Multi-topic revision requires a retained grouping judgment binding this exact target.",
      "needs-judgment",
    );
  const selected = topics.map((id) => {
    const topic = unit.topics.find((t) => t.id === id);
    if (!topic) throw new Error("Resolved topic disappeared.");
    return topic;
  });
  const evidenceIds = [
    ...new Set(selected.flatMap((topic) => topic.evidence.map((e) => e.id))),
  ];
  const first = evidenceIds[0];
  if (!first)
    activityRefusal(
      "missing-prerequisite",
      "Target lacks retained source evidence.",
      "needs-judgment",
    );
  for (const id of evidenceIds) closure.evidenceBytes(id);
  checkRequestedScope(closure, target, topics, request.requested);
  const preferences = closure.control("preferences").sharedBundle;
  const unsigned: Omit<Preparation, "preparationId"> = {
    schemaVersion: 1,
    kind: "module-activity-preparation",
    candidateId: request.candidateId,
    moduleId: closure.read.shape.head.module,
    releaseDigest,
    baseHeadByteSha256: closure.head.bytes.byteSha256,
    baseGenerationId: closure.read.shape.generation.generationId,
    files: closure.files,
    procedure: {
      profile: recognized.binding.revisionRule,
      evidenceId: recognized.protocol.procedureEvidenceId,
      bytes: recognized.bytes,
      profileRegistryDigest: activityRegistryDigest,
      bindingId: recognized.binding.bindingId,
    },
    preferences: {
      sharedId: preferences.id,
      sharedVersion: preferences.version,
      sharedByteSha256: preferences.byteSha256,
      local: { kind: "absent" },
      sessionInstructions: instructions,
    },
    official: {
      target,
      membership: {
        kind: "declared",
        orderedMembers: [topics[0] ?? "", ...topics.slice(1)],
        evidenceIds: [first, ...evidenceIds.slice(1)],
      },
      governingUnit: {
        kind: "known",
        unitId: unit.id,
        evidenceIds: [first, ...evidenceIds.slice(1)],
      },
    },
    requested: request.requested,
    orderedSources: selected.flatMap((topic) =>
      topic.evidence.map((e) => ({ evidenceId: e.id, locator: topic.id })),
    ),
    writes: [...activityWrites],
  };
  return {
    preparationId: `preparation:${digest({ encoding: "academic-os-activity-preparation/1", preparation: unsigned })}`,
    ...unsigned,
  };
}

function checkRequestedScope(
  closure: ActivityClosure,
  target: Target,
  official: string[],
  requested: RequestedScope,
): void {
  if (requested.kind === "official") return;
  if (requested.kind === "selection") {
    if (
      new Set(requested.members).size !== requested.members.length ||
      requested.members.some((id) => !official.includes(id))
    )
      activityRefusal(
        "foreign-target",
        "Requested selection contains foreign or repeated official members.",
      );
    if (
      !sameValue(
        requested.members,
        official.filter((id) => requested.members.includes(id)),
      )
    )
      activityRefusal(
        "scope-ambiguous",
        "Requested members must preserve official declaration order.",
      );
    checkActivityJudgment(
      closure,
      requested.membership,
      "scope-membership",
      digest({ target, members: requested.members }),
    );
  } else {
    if (
      new Set(requested.additional.map(digest)).size !==
      requested.additional.length
    )
      activityRefusal(
        "scope-ambiguous",
        "Repeated requested extension locator.",
      );
    for (const locator of requested.additional)
      closure.evidenceBytes(locator.evidenceId);
    checkActivityJudgment(
      closure,
      requested.request,
      "requested-extension",
      digest({ target, additional: requested.additional }),
    );
  }
}

export function checkActivityJudgment(
  closure: ActivityClosure,
  judgment: Judgment,
  kind: Judgment["kind"],
  subjectDigest: string,
  packets: readonly { id: string }[] = [],
): void {
  if (
    judgment.kind !== kind ||
    judgment.subjectDigest !== subjectDigest ||
    judgment.author.trim().length === 0
  )
    activityRefusal(
      "evidence-mismatch",
      `Attributed ${kind} judgment must bind the exact subject digest.`,
    );
  for (const id of judgment.evidenceIds)
    if (!packets.some((p) => p.id === id)) closure.evidenceBytes(id);
}

export function standingActivityCoverage(
  records: readonly LearningRecord[],
  closeouts: readonly StoredCloseout[] = [],
): ReadonlySet<string> {
  const inactive = new Set(
    records.flatMap((record) => record.supersedes.map((ref) => ref.id)),
  );
  const covered = new Set<string>();
  for (const record of records) {
    if (inactive.has(record.id)) continue;
    const target =
      record.kind === "current"
        ? record.target
        : record.parsedTarget.kind === "established" &&
            record.established.includes("exact-single-topic-coverage")
          ? record.parsedTarget.value
          : undefined;
    if (target?.kind !== "revision") continue;
    const closeout = closeouts.find(
      (c) => c.logicalResult.recordId === record.id,
    );
    if (
      record.kind === "current" &&
      record.coverage !== "requested-target-covered" &&
      !closeout
    )
      continue;
    for (const topic of target.topics)
      if (
        !closeout ||
        closeout.logicalResult.coverage.coveredMembers.includes(topic.id)
      )
        covered.add(`${target.unit.id}\0${topic.id}`);
  }
  return covered;
}

export const extensionActivityMember = (locator: unknown): string =>
  `extension:${digest(locator)}`;

export function activitySupersessionSubject(
  records: readonly LearningRecord[],
  ids: readonly string[],
  official: Preparation["official"],
): string {
  return digest({
    predecessors: ids.map((id) => ({
      id,
      byteSha256: digest(records.find((r) => r.id === id)),
    })),
    official,
  });
}
