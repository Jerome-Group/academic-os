import assert from "node:assert/strict";
import { it } from "node:test";
import {
  activityBytes,
  activitySupersessionSubject,
  deriveActivityCloseout,
  digest,
  encodeCanonicalJson,
  freezeBytes,
  parseActivity,
  resolveActivityPreparation,
  standingActivityCoverage,
  validateControlTransition,
} from "../../src/controls/index.js";
import { validateGeneratedBundle } from "../../src/controls-publication/index.js";
import { createModuleActivityTools } from "../../src/module-activity/actions.js";
import type { Target } from "../../src/module-activity/generated/workflow.js";
import { encodeActivityPacket } from "../../src/module-activity/index.js";
import { createMcpDispatcher } from "../../src/operations/dispatch-mcp-message.js";
import {
  activityFixture,
  activityJudgment,
  activitySubmission,
} from "./fixtures.js";

const releaseDigest = "a".repeat(64);
function preparation() {
  const fixture = activityFixture();
  const prep = resolveActivityPreparation({
    before: fixture.before,
    releaseDigest,
    request: {
      candidateId: "candidate-synthetic",
      selection: {
        kind: "exact",
        target: {
          kind: "revision",
          unit: { kind: "unit", id: "unit:one" },
          topics: [{ kind: "topic", id: "topic:one" }],
        },
      },
      requested: { kind: "official" },
    },
  });
  return { fixture, prep };
}

it("reconstructs raw closeout evidence and exact append regions from the actual predecessor", () => {
  const { fixture, prep } = preparation();
  const submitted = activitySubmission(prep);
  const derived = deriveActivityCloseout(submitted);
  const proposed = validateGeneratedBundle({
    bundleBytes: encodeCanonicalJson(derived.bundle),
    aggregate: {
      kind: "module",
      module: fixture.identity.module,
      moduleCode: fixture.identity.moduleCode,
    },
  });
  assert.equal(proposed.kind, "validated", JSON.stringify(proposed));
  if (proposed.kind !== "validated") return;
  const request = {
    candidateId: prep.candidateId,
    requestId: submitted.requestId,
    releaseDigest,
  };
  assert.deepEqual(
    validateControlTransition({
      before: fixture.before,
      proposed: {
        moduleCode: fixture.identity.moduleCode,
        files: proposed.files,
      },
      request,
    }),
    [],
  );
  assert.equal(derived.logicalResult.sessionStatus, "complete");
  assert.equal(derived.logicalResult.understanding.kind, "unassessed");
  assert.equal(derived.exactWrites.preservedRoles.length, 16);
  assert.equal(derived.exactWrites.regions.length, 8);
  assert.match(
    validateControlTransition({
      before: undefined,
      proposed: {
        moduleCode: fixture.identity.moduleCode,
        files: proposed.files,
      },
      request,
    })[0]?.evidence ?? "",
    /Direct initial protocol enablement requires empty/,
  );
  const changed = structuredClone(derived.bundle);
  const records = changed.controls.find((c) => c.role === "learning-records");
  assert.ok(records);
  const value = JSON.parse(
    Buffer.from(activityBytes(records.bytes)).toString(),
  );
  value.activityCloseouts[0].logicalResult.checks[
    "selected-byte-closure"
  ].subjectDigest = "0".repeat(64);
  records.bytes = freezeBytes(encodeCanonicalJson(value));
  const forged = validateGeneratedBundle({
    bundleBytes: encodeCanonicalJson(changed),
    aggregate: {
      kind: "module",
      module: fixture.identity.module,
      moduleCode: fixture.identity.moduleCode,
    },
  });
  assert.equal(forged.kind, "validated");
  if (forged.kind !== "validated") return;
  assert.match(
    validateControlTransition({
      before: fixture.before,
      proposed: {
        moduleCode: fixture.identity.moduleCode,
        files: forged.files,
      },
      request,
    })[0]?.evidence ?? "",
    /fully rederived/,
  );
});

it("refuses metadata rebinding, unknown effects, invalid understanding and uncovered supersession", () => {
  const { prep } = preparation();
  const rebound = activitySubmission(structuredClone(prep));
  rebound.preparation.orderedSources.reverse();
  rebound.preparation.official.governingUnit = {
    kind: "unknown",
    reason: "Tampered",
  };
  assert.throws(() => deriveActivityCloseout(rebound), /rebound/);
  const understanding = activitySubmission(prep);
  understanding.evidence.understanding = {
    kind: "agent-assessed",
    judgment: activityJudgment("unaided-understanding", digest(prep)),
    attemptEvidenceId: "missing",
    independentReview: activityJudgment("unaided-understanding", digest(prep)),
    scope: ["topic:one"],
    status: "unaided-demonstrated",
  };
  assert.throws(
    () => deriveActivityCloseout(understanding),
    /understanding-evidence-missing/,
  );
  const coverage = activitySubmission(prep);
  coverage.evidence.coverage.coveredMembers = [];
  assert.throws(
    () => deriveActivityCloseout(coverage),
    /coverage-scope-mismatch/,
  );
  const foreign = activitySubmission(prep);
  foreign.supersedes = ["foreign"];
  assert.throws(() => deriveActivityCloseout(foreign), /existing active/);
  const unsupported = { ...activitySubmission(prep), ownerAuthorized: true };
  assert.throws(
    () => parseActivity(unsupported, "SubmitInput"),
    /additional properties/,
  );
});

it("bounds complete native and wire packets before base64 allocation", () => {
  const { prep } = preparation();
  assert.throws(
    () =>
      encodeActivityPacket({
        preparation: prep,
        padding: "x".repeat(8_388_608),
      }),
    /limit 8388608/,
  );
  const input = activitySubmission(prep);
  input.evidence.packets[0].bytes = {
    byteLength: 8_388_609,
    byteSha256: "0".repeat(64),
    bytesBase64: "AAAA",
  };
  assert.throws(
    () => parseActivity(input, "SubmitInput"),
    /exact decoded length/,
  );
});

it("transports real output schemas and preserves old string tools", async () => {
  const dispatcher = createMcpDispatcher({
    tools: [
      ...createModuleActivityTools(),
      {
        name: "legacy",
        title: "Legacy",
        description: "Legacy",
        fields: [],
        async call() {
          return { report: { legacy: true }, failed: false };
        },
      },
    ],
    serverInfo: { name: "test", title: "test", version: "1" },
  });
  const listed = await dispatcher({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  });
  assert.ok(
    listed?.result &&
      typeof listed.result === "object" &&
      "tools" in listed.result,
  );
  const tools = listed.result.tools;
  assert.ok(Array.isArray(tools));
  assert.equal(tools.filter((t) => t.outputSchema).length, 3);
  const legacy = await dispatcher({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "legacy", arguments: {} },
  });
  assert.match(JSON.stringify(legacy), /legacy/);
  const invalid = await dispatcher({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "module_activity_submit", arguments: {} },
  });
  assert.match(JSON.stringify(invalid), /invalid-packet/);
});

it("separates complete requested subsets and unfinished extensions from official coverage", () => {
  const fixture = activityFixture(true);
  const target = {
    kind: "revision" as const,
    unit: { kind: "unit" as const, id: "unit:one" },
    topics: [
      { kind: "topic" as const, id: "topic:one" },
      { kind: "topic" as const, id: "topic:two" },
      { kind: "topic" as const, id: "topic:three" },
    ],
  } satisfies Target;
  const grouped = activityJudgment(
    "grouping",
    digest(target),
    "evidence:synthetic",
  );
  const selection = resolveActivityPreparation({
    before: fixture.before,
    releaseDigest,
    request: {
      candidateId: "candidate-synthetic",
      selection: { kind: "exact", target: structuredClone(target) },
      requested: {
        kind: "selection",
        members: ["topic:one"],
        membership: activityJudgment(
          "scope-membership",
          digest({ target, members: ["topic:one"] }),
          "evidence:synthetic",
        ),
      },
      sessionInstructions: [grouped],
    },
  });
  const subset = activitySubmission(selection, "subset");
  subset.evidence.coverage.coveredMembers = ["topic:one"];
  subset.evidence.coverage.official = "partial";
  subset.evidence.coverage.judgment.subjectDigest = digest({
    preparationDigest: digest(selection),
    coveredMembers: ["topic:one"],
  });
  const selected = deriveActivityCloseout(subset);
  assert.equal(selected.logicalResult.coverage.requested, "covered");
  assert.equal(selected.logicalResult.coverage.official, "partial");
  const selectedRecords = selected.bundle.controls.find(
    (c) => c.role === "learning-records",
  );
  assert.ok(selectedRecords);
  const record = JSON.parse(
    Buffer.from(activityBytes(selectedRecords.bytes)).toString(),
  ).records[0];
  assert.equal(record.coverage, "partial");
  const additional = [
    {
      evidenceId: "evidence:synthetic",
      locator: "Synthetic extension locator",
    },
  ] as [{ evidenceId: string; locator: string }];
  const extended = resolveActivityPreparation({
    before: fixture.before,
    releaseDigest,
    request: {
      candidateId: "candidate-synthetic",
      selection: { kind: "exact", target: structuredClone(target) },
      requested: {
        kind: "extension",
        official: "whole-target",
        additional,
        request: activityJudgment(
          "requested-extension",
          digest({ target, additional }),
          "evidence:synthetic",
        ),
      },
      sessionInstructions: [grouped],
    },
  });
  const extension = activitySubmission(extended, "extension");
  extension.evidence.coverage.requested = "partial";
  const finishedOfficial = deriveActivityCloseout(extension);
  assert.equal(finishedOfficial.logicalResult.coverage.official, "covered");
  assert.equal(finishedOfficial.logicalResult.coverage.requested, "partial");
  assert.equal(finishedOfficial.logicalResult.sessionStatus, "partial");
});

it("appends multi-record supersession while preserving unknown history and prior coverage", () => {
  const fixture = activityFixture(true);
  const binding = fixture.bundle.controls.find(
    (c) => c.role === "learning-records",
  );
  assert.ok(binding);
  const records = JSON.parse(
    Buffer.from(activityBytes(binding.bytes)).toString(),
  );
  records.records = [
    {
      id: "learning-record:unknown",
      kind: "legacy-evidence",
      original: { kind: "evidence", id: "evidence:synthetic" },
      parsedTarget: { kind: "unknown", reason: "Missing historical target" },
      observedStatus: {
        kind: "unknown",
        reason: "Missing historical status",
        evidence: [],
      },
      established: [],
      missing: ["target", "status"],
      supersedes: [],
      evidence: [{ kind: "evidence", id: "evidence:synthetic" }],
    },
    ...["one", "two", "three"].map((topic) => ({
      id: `learning-record:${topic}`,
      kind: "current",
      date: {
        kind: "unknown",
        reason: "Historical date missing",
        evidence: [],
      },
      target: {
        kind: "revision",
        unit: { kind: "unit", id: "unit:one" },
        topics: [{ kind: "topic", id: `topic:${topic}` }],
      },
      coverage: "requested-target-covered",
      understanding: { kind: "unassessed", reason: "No attempt" },
      sources: [],
      produced: [],
      assessments: [],
      evidence: [{ kind: "evidence", id: "evidence:synthetic" }],
      supersedes: [],
    })),
  ];
  binding.bytes = freezeBytes(encodeCanonicalJson(records));
  const validated = validateGeneratedBundle({
    bundleBytes: encodeCanonicalJson(fixture.bundle),
    aggregate: {
      kind: "module",
      module: fixture.identity.module,
      moduleCode: fixture.identity.moduleCode,
    },
  });
  assert.equal(validated.kind, "validated");
  if (validated.kind !== "validated") return;
  const target = {
    kind: "revision" as const,
    unit: { kind: "unit" as const, id: "unit:one" },
    topics: [
      { kind: "topic" as const, id: "topic:one" },
      { kind: "topic" as const, id: "topic:two" },
      { kind: "topic" as const, id: "topic:three" },
    ],
  } satisfies Target;
  const prep = resolveActivityPreparation({
    before: { moduleCode: fixture.identity.moduleCode, files: validated.files },
    releaseDigest,
    request: {
      candidateId: "candidate-synthetic",
      selection: { kind: "exact", target: structuredClone(target) },
      requested: { kind: "official" },
      sessionInstructions: [
        activityJudgment("grouping", digest(target), "evidence:synthetic"),
      ],
    },
  });
  const submission = activitySubmission(prep, "consolidate");
  submission.supersedes = [
    "learning-record:one",
    "learning-record:two",
    "learning-record:three",
  ];
  submission.supersessionJudgment = activityJudgment(
    "supersession",
    activitySupersessionSubject(
      records.records,
      submission.supersedes,
      prep.official,
    ),
    submission.evidence.packets[0].id,
  );
  const derived = deriveActivityCloseout(submission);
  const derivedRecords = derived.bundle.controls.find(
    (c) => c.role === "learning-records",
  );
  assert.ok(derivedRecords);
  const after = JSON.parse(
    Buffer.from(activityBytes(derivedRecords.bytes)).toString(),
  );
  assert.deepEqual(after.records.slice(0, 4), records.records);
  assert.equal(after.records.length, 5);
  assert.equal(standingActivityCoverage(after.records).size, 3);
  const unknown = structuredClone(submission);
  unknown.supersedes = ["learning-record:unknown"];
  assert.throws(() => deriveActivityCloseout(unknown), /erase unknown/);
});
