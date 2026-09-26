import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { auditLatexBuilds } from "../../src/conformance/audit-latex-builds.js";
import type { Inventory } from "../../src/conformance/types.js";

describe("LaTeX source placement", () => {
  it("counts workspace sources outside each build subtree, including nested siblings", () => {
    const inventory: Inventory = {
      moduleCode: "MH2100",
      entries: [
        { path: "notes/build", kind: "directory" },
        { path: "notes/build/generated.tex", kind: "file" },
        { path: "notes/child/build", kind: "directory" },
        { path: "notes/child/sources/main.TEX", kind: "file" },
        { path: "isolated/build", kind: "directory" },
        { path: "isolated/build/generated.tex", kind: "file" },
        { path: "NTULearn/build", kind: "directory" },
        { path: ".scratch/build", kind: "directory" },
        { path: "build", kind: "directory" },
      ],
    };
    const findings = auditLatexBuilds(inventory, new Set(["NTULearn"]));
    assert.deepEqual(findings.map(({ path }) => path).sort(), [
      "build",
      "isolated/build",
    ]);
  });

  it("does not treat a non-file LaTeX entry as source", () => {
    const findings = auditLatexBuilds(
      {
        moduleCode: "MH2100",
        entries: [
          { path: "notes/build", kind: "directory" },
          { path: "notes/main.tex", kind: "symlink" },
        ],
      },
      new Set(),
    );
    assert.equal(findings[0]?.status, "fail");
  });
});
