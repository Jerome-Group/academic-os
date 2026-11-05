import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  readControls,
  type ModuleDataControl,
} from "../../src/controls/index.js";
import { moduleCode, moduleId, canonicalFixture, file } from "./fixtures.js";
import {
  controlFor,
  evidence,
  evidenceRef,
  moduleDataControls,
  moduleDataFixture,
  unknown,
} from "./module-data-fixtures.js";

function required<T>(value: T | undefined): T {
  assert.ok(value !== undefined);
  return value;
}

function read(controls: readonly ModuleDataControl[] = moduleDataControls()) {
  return readControls({ moduleCode, files: moduleDataFixture(controls) });
}
function rejects(edit: (controls: ModuleDataControl[]) => void, code: string) {
  const controls = moduleDataControls();
  edit(controls);
  const result = read(controls);
  assert.equal(result.kind, "unsupported", JSON.stringify(result.diagnostics));
  assert.ok(
    result.diagnostics.some((item) => item.code === code),
    JSON.stringify(result.diagnostics),
  );
  assert.ok(result.diagnostics.every((item) => item.path && item.remediation));
  return result;
}

describe("complete canonical module data through the public owner", () => {
  it("rejects unknown fields, unsupported schema versions and role/schema mismatches after binding their real bytes", () => {
    const controls = moduleDataControls();
    for (const transform of [
      (value: ModuleDataControl) => ({
        ...value,
        undocumented: "ignored by no reader",
      }),
      (value: ModuleDataControl) => ({ ...value, schemaVersion: 2 }),
      (value: ModuleDataControl) =>
        value.role === "profile" ? controlFor(controls, "terms") : value,
    ]) {
      const result = readControls({
        moduleCode,
        files: moduleDataFixture(controls, transform),
      });
      assert.equal(result.kind, "unsupported");
      assert.ok(
        result.diagnostics.some((item) =>
          ["invalid-control-schema", "conflicting-control-role"].includes(
            item.code,
          ),
        ),
      );
      assert.equal(
        result.diagnostics.some(
          (item) => item.code === "canonical-hash-mismatch",
        ),
        false,
      );
    }
  });

  it("preserves explicit unknown historical Source Maps and rejects invented legacy coverage", () => {
    const controls = moduleDataControls();
    const map = controlFor(controls, "source-map");
    map.availability = unknown("No historical Source Map exists");
    map.units = [];
    map.teachingWeeks = [];
    const records = controlFor(controls, "learning-records");
    records.records = records.records.filter(
      (record) => record.kind === "legacy-evidence",
    );
    assert.equal(read(controls).kind, "canonical");
    rejects((controls) => {
      const record = required(
        controlFor(controls, "learning-records").records[0],
      );
      assert.ok(record.kind === "legacy-evidence");
      record.established.push("exact-single-topic-coverage");
    }, "invalid-legacy-coverage-claim");
  });

  it("retains native raw names, ACLs, resource forks and known/unknown metadata independently", () => {
    const controls = moduleDataControls();
    const artifact = required(controlFor(controls, "artifacts").artifacts[0]);
    const entry = required(artifact.representation.entries[0]);
    entry.pathBytesBase64 = Buffer.from([0xff, 0x61]).toString("base64");
    entry.acl = {
      kind: "known",
      value: ["opaque retained ACL entry"],
      evidence: evidence(),
    };
    entry.xattrs = {
      kind: "known",
      entries: [
        {
          nameBytesBase64: Buffer.from("com.example.metadata").toString(
            "base64",
          ),
          valueSha256: "1".repeat(64),
          byteLength: 8,
        },
      ],
      evidence: evidence(),
    };
    entry.resourceFork = {
      kind: "present",
      byteSha256: "2".repeat(64),
      byteLength: 12,
      evidence: evidence(),
    };
    entry.hardlinkGroup = {
      kind: "known",
      value: "retained-group-1",
      evidence: evidence(),
    };
    const result = read(controls);
    assert.equal(result.kind, "canonical", JSON.stringify(result.diagnostics));
  });
  it("validates every role, preserves selected bytes and retains unknown history without claiming workflow or migration readiness", () => {
    const files = moduleDataFixture();
    const result = readControls({ moduleCode, files });
    assert.equal(result.kind, "canonical", JSON.stringify(result.diagnostics));
    if (result.kind !== "canonical") return;
    assert.equal(result.coverage, "validated-module-data");
    assert.deepEqual(result.readiness, {
      publication: "not-implemented",
      workflows: "not-implemented",
      moduleConformance: "not-implemented",
      migration: "not-implemented",
    });
    assert.equal(result.controls.length, 18);
    assert.deepEqual(result.unsupportedReads, [
      "publication",
      "workflows",
      "module-conformance",
      "migration-readiness",
    ]);
    const records = result.controls.find(
      (item) =>
        item.value &&
        "role" in item.value &&
        item.value.role === "learning-records",
    )?.value;
    assert.ok(
      records && "role" in records && records.role === "learning-records",
    );
    assert.equal(records.records[0]?.kind, "legacy-evidence");
    assert.equal(records.records[1]?.kind, "current");
    for (const retained of result.evidence)
      assert.deepEqual(
        Buffer.from(retained.bytesBase64, "base64"),
        files.find((file) => file.path === retained.path)?.bytes,
      );
    assert.equal(result.shape.head.module, moduleId);
  });

  it("keeps identity-only generation1 readable and partial", () => {
    const result = readControls({ moduleCode, files: canonicalFixture() });
    assert.ok(
      result.kind === "canonical" &&
        result.coverage === "incomplete-module-contract",
    );
  });

  it("requires every full-bundle role and rejects conflicting module identities", () => {
    rejects((controls) => {
      controls.splice(
        controls.findIndex((control) => control.role === "terms"),
        1,
      );
    }, "missing-module-data-role");
    rejects((controls) => {
      controlFor(controls, "profile").module = "module:other";
    }, "canonical-identity-conflict");
  });

  it("rejects duplicate stable IDs and missing or wrong-kind references", () => {
    rejects((controls) => {
      const map = controlFor(controls, "source-map");
      map.units[1]?.topics.push({
        id: "topic:a",
        title: "Duplicate topic",
        evidence: evidence(),
      });
    }, "duplicate-control-id");
    rejects((controls) => {
      required(controlFor(controls, "terms").entries[0]).decision.id =
        "decision:absent";
    }, "missing-control-reference");
    rejects((controls) => {
      required(controlFor(controls, "terms").entries[0]).decision.id =
        "source:issued";
    }, "wrong-kind-control-reference");
  });

  it("rejects supersession cycles, self references and an unaccepted standing decision", () => {
    rejects((controls) => {
      required(controlFor(controls, "decisions").entries[0]).supersedes = [
        { kind: "decision", id: "decision:terms" },
      ];
    }, "control-supersession-cycle");
    rejects((controls) => {
      const records = controlFor(controls, "learning-records").records;
      required(records[0]).supersedes = [
        { kind: "learning-record", id: "learning-record:current" },
      ];
    }, "control-supersession-cycle");
    rejects((controls) => {
      required(controlFor(controls, "decisions").entries[0]).status =
        "proposed";
    }, "unaccepted-control-decision");
  });

  for (const topics of [
    ["topic:a", "topic:c"],
    ["topic:b", "topic:a"],
    ["topic:c", "topic:d"],
    ["topic:d"],
  ])
    it(`rejects a noncontiguous, reordered or cross-unit revision target ${topics.join(",")}`, () => {
      rejects((controls) => {
        const record = controlFor(controls, "learning-records").records[1];
        assert.ok(
          record?.kind === "current" && record.target.kind === "revision",
        );
        const [first, ...rest] = topics;
        assert.ok(first);
        record.target.topics = [
          { kind: "topic", id: first },
          ...rest.map((id) => ({ kind: "topic" as const, id })),
        ];
      }, "invalid-learning-target");
    });

  it("rejects a tutorial block from another unit and inconsistent source ownership", () => {
    rejects((controls) => {
      const record = controlFor(controls, "learning-records").records[1];
      assert.ok(record?.kind === "current");
      record.target = {
        kind: "tutorial",
        unit: { kind: "unit", id: "unit:2" },
        block: { kind: "tutorial-block", id: "tutorial-block:one" },
      };
    }, "invalid-learning-target");
    rejects((controls) => {
      const artifacts = controlFor(controls, "artifacts");
      const original = artifacts.sources[0];
      assert.ok(original);
      artifacts.sources.push({ ...original, id: "source:another" });
      const source = controlFor(controls, "source-map").units[0]?.lectures[0];
      assert.ok(source);
      source.source.id = "source:another";
    }, "conflicting-source-reference");
  });

  it("accepts coverage without an understanding claim, plus independently evidenced understanding and provisional assessment", () => {
    const controls = moduleDataControls();
    const records = controlFor(controls, "learning-records");
    const record = records.records[1];
    assert.ok(record?.kind === "current");
    record.understanding = {
      kind: "agent-assessed",
      judgment: "needs-work",
      ownerAttempt: evidence(),
      independentReview: evidence(),
      reasoning: "The attempt omitted one case.",
      limitations: ["Provisional assessment"],
    };
    records.assessments.push({
      id: "assessment:one",
      kind: "provisional",
      official: false,
      submission: { kind: "artifact", id: "artifact:questions" },
      question: evidenceRef,
      authority: unknown(),
      criteria: [
        {
          label: "Case coverage",
          maximum: "2.5",
          estimated: "1.25",
          source: evidenceRef,
          observations: evidence(),
          reasoning: "One case omitted",
          uncertainty: unknown(),
        },
      ],
      independentReference: evidenceRef,
      limitations: ["No issued rubric"],
    });
    record.assessments = [{ kind: "assessment", id: "assessment:one" }];
    assert.equal(read(controls).kind, "canonical");
    rejects((controls) => {
      controlFor(controls, "learning-records").assessments = [
        {
          ...required(records.assessments[0]),
          criteria: [
            {
              label: "Impossible marks",
              maximum: "0.25",
              estimated: "0.2501",
              source: evidenceRef,
              observations: evidence(),
              reasoning: "Invalid",
              uncertainty: unknown(),
            },
          ],
        },
      ];
    }, "invalid-assessment-marks");
  });

  it("supports all target variants, independent teaching weeks, empty terms and evidence-backed disputed facts", () => {
    for (const target of [
      { kind: "lecture", unit: { kind: "unit", id: "unit:10" } },
      {
        kind: "tutorial",
        unit: { kind: "unit", id: "unit:10" },
        block: { kind: "tutorial-block", id: "tutorial-block:one" },
      },
      {
        kind: "past-paper",
        paper: { kind: "artifact", id: "artifact:questions" },
        questions: ["1"],
      },
    ] as const) {
      const controls = moduleDataControls();
      const record = controlFor(controls, "learning-records").records[1];
      assert.ok(record?.kind === "current");
      record.target =
        target.kind === "past-paper"
          ? { ...target, questions: [...target.questions] }
          : target;
      controlFor(controls, "terms").entries = [];
      controlFor(controls, "definition").offering.timezone = {
        kind: "disputed",
        alternatives: [
          { value: "UTC", evidence: evidence(), reasoning: "Older schedule" },
          {
            value: "Asia/Singapore",
            evidence: evidence(),
            reasoning: "Later schedule",
          },
        ],
      };
      assert.equal(read(controls).kind, "canonical");
    }
  });

  it("rejects provider duplicates without turning provider completion into learning understanding", () => {
    rejects((controls) => {
      const mirror = controlFor(controls, "provider-mirrors").entries[0];
      assert.ok(mirror?.provider === "google-tasks");
      mirror.items.push(...mirror.items);
    }, "duplicate-provider-item");
    const controls = moduleDataControls();
    const record = controlFor(controls, "learning-records").records[1];
    assert.ok(record?.kind === "current");
    assert.equal(record.understanding.kind, "unassessed");
    assert.equal(
      controlFor(controls, "provider-mirrors").entries[0]?.items[0]?.status
        .kind,
      "known",
    );
    assert.equal(read(controls).kind, "canonical");
  });

  it("rejects unsafe paths, invalid native byte paths and native-kind contradictions", () => {
    rejects((controls) => {
      const artifact = required(controlFor(controls, "artifacts").artifacts[0]);
      artifact.representation.bundleMembers = [
        { kind: "artifact", id: artifact.id },
      ];
    }, "invalid-native-bundle-membership");
    rejects((controls) => {
      required(controlFor(controls, "artifacts").artifacts[0]).path =
        "../escape";
    }, "unsafe-module-data-path");
    rejects((controls) => {
      required(
        required(controlFor(controls, "artifacts").artifacts[0]).representation
          .entries[0],
      ).pathBytesBase64 = Buffer.from("../escape").toString("base64");
    }, "invalid-native-path-bytes");
    rejects((controls) => {
      required(
        required(controlFor(controls, "artifacts").artifacts[0]).representation
          .entries[0],
      ).kind = "symlink";
    }, "conflicting-native-entry-kind");
  });

  it("retains curation history and rejects deletion-like withdrawal or unsupported empty placement", () => {
    rejects((controls) => {
      const event = controlFor(controls, "curation").events[0];
      assert.ok(event);
      event.decision = "withdrawn";
      event.supersedes = [{ kind: "curation-event", id: event.id }];
    }, "invalid-withdrawal-supersession");
    rejects((controls) => {
      required(controlFor(controls, "curation").events[0]).artifacts = [];
    }, "missing-curation-artifact");
  });

  it("uses strict byte JSON for every full control and refuses stale selected bytes", () => {
    const files = moduleDataFixture();
    const selected = files.find((file) => file.path.endsWith("terms.json"));
    assert.ok(selected);
    const changed = files.map((item) =>
      item === selected
        ? file(item.path, '{"role":"terms","role":"terms"}')
        : item,
    );
    const result = readControls({ moduleCode, files: changed });
    assert.equal(result.kind, "unsupported");
    assert.ok(
      result.diagnostics.some(
        (item) => item.code === "canonical-hash-mismatch",
      ),
    );
    assert.ok(
      result.diagnostics.some((item) => item.code === "invalid-json-bytes"),
    );
  });
});
