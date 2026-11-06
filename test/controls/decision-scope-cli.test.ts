import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { moduleCode, moduleId, sha } from "./fixtures.js";
import {
  controlFor,
  moduleDataControls,
  moduleDataFixture,
} from "./module-data-fixtures.js";
import {
  syntheticFragment,
  verificationControls,
  verificationFixture,
} from "./module-verification-fixtures.js";
import type { ControlObservation } from "../../src/controls/index.js";

const cli = fileURLToPath(new URL("../../src/cli.js", import.meta.url));
async function validate(name: string, files: ControlObservation[]) {
  const directory = await mkdtemp(
    join(await realpath(tmpdir()), "verification-decision-scope-"),
  );
  await chmod(directory, 0o700);
  const root = join(directory, moduleCode);
  const before = [];
  for (const file of files) {
    assert.equal(file.kind, "file");
    if (file.kind !== "file") continue;
    const path = join(root, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.bytes);
    before.push({
      path,
      byteLength: file.bytes.byteLength,
      sha256: sha(file.bytes),
    });
  }
  const args = [cli, "module", "validate", "--root", root, "--json"];
  const child = spawnSync(process.execPath, args, {
    encoding: "utf8",
    timeout: 20_000,
  });
  await writeFile(join(directory, "stdout.json"), child.stdout);
  await writeFile(join(directory, "stderr.txt"), child.stderr);
  const report = JSON.parse(child.stdout);
  const after = await Promise.all(
    before.map(async (file) => {
      const bytes = await readFile(file.path);
      return {
        path: file.path,
        byteLength: bytes.byteLength,
        sha256: sha(bytes),
      };
    }),
  );
  let aliveAfter = false;
  try {
    process.kill(child.pid, 0);
    aliveAfter = true;
  } catch {}
  await writeFile(
    join(directory, "result.json"),
    JSON.stringify(
      {
        name,
        args,
        pid: child.pid,
        exit: child.status,
        signal: child.signal,
        aliveAfter,
        before,
        after,
        outcome: report.outcome,
        diagnostics: report.diagnostics,
      },
      null,
      2,
    ),
  );
  assert.equal(aliveAfter, false);
  assert.deepEqual(after, before);
  return { directory, child, report };
}

for (const mode of ["excluded", "rubric", "adaptation", "check"] as const)
  for (const scope of ["local", "foreign-module", "foreign-component"] as const)
    it(`validates ${mode} decision ${scope} scope through actual module validate`, async (context) => {
      const controls = verificationControls();
      const records = controls.find(
        (value) => value.role === "learning-records",
      );
      const verification = controls.find(
        (value) => value.role === "verification",
      );
      const decisions = controls.find((value) => value.role === "decisions");
      assert.ok(
        records?.role === "learning-records" && records.schemaVersion === 2,
      );
      assert.ok(
        verification?.role === "verification" &&
          verification.schemaVersion === 2,
      );
      assert.ok(decisions?.role === "decisions");
      const review = records.assessments[0];
      const decision = decisions.entries[0];
      assert.ok(review && "recordVersion" in review && decision);
      decision.scope.subjects =
        scope === "local"
          ? [moduleId, review.component]
          : [
              scope === "foreign-module"
                ? "module:other"
                : "assessment-component:other",
            ];
      if (mode === "excluded")
        review.criteria = [
          {
            applicability: "excluded",
            id: "criterion:grammar",
            fragment: syntheticFragment,
            decision: { kind: "decision", id: decision.id },
            reason: "Explicit exclusion, no score or penalty.",
          },
        ];
      if (mode === "rubric") {
        review.kind = "rubric-linked";
        const criterion = review.criteria[0];
        assert.ok(criterion.applicability === "applies");
        criterion.basis = {
          kind: "rubric",
          fragment: syntheticFragment,
          applicabilityDecision: { kind: "decision", id: decision.id },
        };
      }
      if (mode === "adaptation")
        verification.adaptationDecisions = [
          { kind: "decision", id: decision.id },
        ];
      if (mode === "check") {
        const check = verification.checks[0];
        assert.ok(check.kind === "assessment");
        check.applicabilityDecisions = [{ kind: "decision", id: decision.id }];
      }
      const result = await validate(
        `${mode}-${scope}`,
        verificationFixture(controls),
      );
      context.diagnostic(`Retained decision scope fixture ${result.directory}`);
      assert.equal(
        result.child.status,
        scope === "local" ? 0 : 2,
        result.child.stdout,
      );
      if (scope === "local") {
        assert.equal(result.report.kind, "canonical");
        assert.equal(result.report.readiness.verification, "not-implemented");
      } else {
        assert.equal(result.report.kind, "unsupported");
        assert.ok(
          result.report.diagnostics.some(
            (finding: { code: string }) =>
              finding.code === "invalid-verification-binding",
          ),
        );
      }
    });

it("preserves v1 decision scope behavior through actual module validate", async (context) => {
  const controls = moduleDataControls();
  const decision = controlFor(controls, "decisions").entries[0];
  assert.ok(decision);
  decision.scope.subjects = ["module:other", "assessment-component:other"];
  const result = await validate("v1-unchanged", moduleDataFixture(controls));
  context.diagnostic(`Retained v1 decision scope fixture ${result.directory}`);
  assert.equal(result.child.status, 0, result.child.stdout);
  assert.equal(result.report.kind, "canonical");
  assert.equal("verification" in result.report.readiness, false);
});
