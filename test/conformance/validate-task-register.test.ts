import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateTaskRegister } from "../../src/conformance/index.js";
import { seededTaskRegister } from "../fixtures/task-register.js";
import { recordFindingEvidence } from "../support/rule-evidence.js";

const provisioned = `list_id: MDkxMjM0
tasks:
  - task_id: bGl2ZS0x
    title: Read the Week 03 notes
    do_date: 2026-08-21
    status: open
    notes: Chapter 14 first
    provenance:
      assessment: Midterm
      source: NTULearn/Course.md
      milestone: Midterm week
  - title: Draft the summary
    status: cancelled
`;

describe("validateTaskRegister", () => {
  it("accepts the seeded skeleton and a provisioned register [MF-TASKS-001]", () => {
    const seeded = validateTaskRegister(seededTaskRegister);
    const mirrored = validateTaskRegister(provisioned);

    assert.equal(seeded.status, "pass");
    assert.match(
      seeded.evidence,
      /mirrors 0 tasks of a list provisioning has/u,
    );
    assert.equal(mirrored.status, "pass");
    assert.match(mirrored.evidence, /mirrors 2 tasks of list MDkxMjM0/u);
    recordFindingEvidence([seeded, mirrored], "MF-TASKS-001");
  });

  it("reports a provenance source that walks into the importer's interior", () => {
    const numbered = validateTaskRegister(
      provisioned.replace(
        "source: NTULearn/Course.md",
        "source: NTULearn/03 Lectures/slides.pdf",
      ),
    );

    assert.equal(numbered.status, "fail");
    assert.match(numbered.evidence, /cite the file name slides\.pdf/u);
  });

  it("reports an absent, unparseable, or shapeless register", () => {
    const absent = validateTaskRegister(undefined);
    const unparseable = validateTaskRegister("tasks: [\n");
    const shapeless = validateTaskRegister("list_id: MDkxMjM0\n");

    assert.deepEqual(
      [absent, unparseable, shapeless].map(({ ruleId, status, path }) => ({
        ruleId,
        status,
        path,
      })),
      Array.from({ length: 3 }, () => ({
        ruleId: "MF-TASKS-001",
        status: "fail",
        path: "00 Module Admin/30 Task Register.yaml",
      })),
    );
    assert.match(absent.evidence, /No readable control/u);
    assert.match(unparseable.evidence, /YAML parser reported/u);
    assert.match(shapeless.evidence, /requires a tasks sequence/u);
  });

  it("reports a register holding rows without the list they mirror", () => {
    const unnamed = validateTaskRegister(
      "tasks:\n  - title: Read the notes\n    status: open\n",
    );
    const blankHeader = validateTaskRegister(
      "list_id:\ntasks:\n  - title: Read the notes\n    status: open\n",
    );
    const empty = validateTaskRegister('list_id: ""\ntasks: []\n');

    for (const finding of [unnamed, blankHeader]) {
      assert.equal(finding.status, "fail");
      assert.match(
        finding.evidence,
        /holds tasks without naming the list they mirror/u,
      );
    }
    assert.equal(empty.status, "fail");
    assert.match(empty.evidence, /list_id must be a non-empty string/u);
  });

  it("reports a do-date carrying a time of day", () => {
    const timed = validateTaskRegister(
      provisioned.replace("do_date: 2026-08-21", "do_date: 2026-08-21T09:00"),
    );
    const undated = validateTaskRegister(
      provisioned.replace("do_date: 2026-08-21", "do_date: next Friday"),
    );

    assert.equal(timed.status, "fail");
    assert.match(timed.evidence, /Task 1 do_date .* carries a time of day/u);
    assert.equal(undated.status, "fail");
    assert.match(undated.evidence, /is not a YYYY-MM-DD date/u);
  });

  it("mirrors an empty title rather than reporting the module for Google's", () => {
    const emptyTitle = validateTaskRegister(
      provisioned.replace("title: Draft the summary", 'title: ""'),
    );

    assert.equal(emptyTitle.status, "pass");
  });

  it("reports an unknown status, a titleless row, and malformed provenance", () => {
    const status = validateTaskRegister(
      provisioned.replace("status: cancelled", "status: deferred"),
    );
    const titleless = validateTaskRegister(
      provisioned.replace("title: Draft the summary", "task_id: bGl2ZS0y"),
    );
    const provenance = validateTaskRegister(
      provisioned.replace("      assessment: Midterm", "      assessment: 7"),
    );

    assert.equal(status.status, "fail");
    assert.match(
      status.evidence,
      /Task 2 status "deferred" is not open, completed, or cancelled/u,
    );
    assert.equal(titleless.status, "fail");
    assert.match(titleless.evidence, /Task 2 requires a title/u);
    assert.equal(provenance.status, "fail");
    assert.match(
      provenance.evidence,
      /Task 1 provenance assessment must be a non-empty string/u,
    );
  });
});
