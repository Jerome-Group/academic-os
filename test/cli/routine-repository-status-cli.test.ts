import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { runCli } from "../support/run-cli.js";

it("discovers repository recovery status without running tools or writing state", async () => {
  const root = await mkdtemp(join(tmpdir(), "academic-repository-status-"));
  try {
    const driveMount = join(root, "drive");
    const stateRoot = join(root, "state");
    await mkdir(driveMount);
    await mkdir(stateRoot);
    const config = join(root, "config.json");
    await writeFile(
      config,
      JSON.stringify({
        driveMount,
        stateRoot,
        activeSemester: "SYNTHETIC",
        semesters: {
          SYNTHETIC: { root: "Semester", status: "active", modules: [] },
        },
      }),
    );
    const invoke = () =>
      runCli("routine", "repository-status", "--config", config, "--json");
    const absent = await invoke();
    assert.equal(absent.exitCode, 2, absent.stdout);
    assert.equal(JSON.parse(absent.stdout).outcome, "unobserved");
    const directory = join(stateRoot, "repository-repair");
    await mkdir(directory, { mode: 0o700 });
    const evidence = join(directory, "synthetic-run");
    await mkdir(evidence, { mode: 0o700 });
    const path = join(directory, "state.json");
    for (const [stage, rolledOut, exitCode] of [
      ["healthy", undefined, 0],
      ["awaiting-checks", undefined, 1],
      ["finished", false, 1],
      ["finished", true, 0],
    ] as const) {
      const text = JSON.stringify({
        stage,
        id: "synthetic-run",
        rolledOut,
        evidence,
        ...(stage === "finished"
          ? {
              mergeCommit: "a".repeat(40),
              pullRequest: 43,
              issue: 42,
              postmergeVerified: true,
            }
          : {}),
      });
      const receipt = {
        ...JSON.parse(text),
        observedAt: "2000-01-01T00:00:00Z",
        ...(stage === "healthy"
          ? { baseline: { passed: true, actions: [{ exitCode: 0 }] } }
          : {}),
      };
      await writeFile(
        join(evidence, `${stage}.json`),
        JSON.stringify(receipt),
        { mode: 0o600 },
      );
      await writeFile(path, text, { mode: 0o600 });
      const result = await invoke();
      assert.equal(result.exitCode, exitCode, result.stdout);
      assert.equal(JSON.parse(result.stdout).stage, stage);
      assert.equal(JSON.parse(result.stdout).evidenceScope, "historical");
      assert.equal(JSON.parse(result.stdout).observedAt, receipt.observedAt);
      assert.equal(await readFile(path, "utf8"), text);
    }
    const falseProof = JSON.stringify({
      stage: "finished",
      id: "synthetic-run",
      evidence,
      rolledOut: true,
      mergeCommit: "a".repeat(40),
      pullRequest: 43,
      issue: 42,
    });
    await writeFile(path, falseProof);
    await writeFile(
      join(evidence, "finished.json"),
      JSON.stringify({
        ...JSON.parse(falseProof),
        observedAt: "2000-01-01T00:00:00Z",
      }),
    );
    const unverified = await invoke();
    assert.equal(unverified.exitCode, 1);
    assert.equal(JSON.parse(unverified.stdout).outcome, "blocked");
    await rm(join(evidence, "finished.json"));
    assert.equal((await invoke()).exitCode, 1);
    await writeFile(path, "malformed synthetic JSON");
    const malformed = await invoke();
    assert.equal(malformed.exitCode, 1);
    assert.equal(JSON.parse(malformed.stdout).outcome, "blocked");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
