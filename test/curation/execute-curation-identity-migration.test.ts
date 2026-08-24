import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { md5Bytes, sha256Bytes } from "../../src/checksum.js";
import { writtenControlPaths } from "../../src/conformance/control-paths.js";
import {
  type CohortCurationRegisters,
  executeCurationIdentityMigration,
  type ObservedModuleRegister,
  planCurationIdentityMigration,
} from "../../src/curation/index.js";

const registerPath = writtenControlPaths.curationRegister;
const sourcePath = "03 Materials/02 Graph Theory/handout.pdf";
const placedBytes = Buffer.from("The handout exactly as it arrived.\n", "utf8");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

const legacyRegister = `${JSON.stringify({
  schema_version: 1,
  source_id: "1DriveFileIdentifier",
  integration: "ntulearn",
  role: "handout",
  source_path: sourcePath,
  checksum: `md5:${md5Bytes(placedBytes)}`,
  decision: "curated",
  destination: "10 Learning Materials/handout.pdf",
  evidence: "Follows the standing precedent for handouts.",
  timestamp: "2026-01-04T02:00:00.000Z",
})}\n`;

function observation(register: string): ObservedModuleRegister {
  return {
    module: "CC0006",
    semester: "Y2S1",
    register,
    integrations: ["ntulearn"],
    sources: new Map([
      [
        "ntulearn/Materials/Graph Theory/handout.pdf",
        {
          sourcePath,
          location: `NTULearn/${sourcePath}`,
          sha256: sha256Bytes(placedBytes),
          md5: md5Bytes(placedBytes),
        },
      ],
    ]),
    ambiguousSources: new Set(),
  };
}

async function cohort(
  onDisk: string,
  sourceOnDisk: Buffer = placedBytes,
): Promise<CohortCurationRegisters> {
  // Resolved, because a mounted write proves containment against `realpath` and macOS puts a
  // temporary directory behind a symlink.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "academic-os-curation-exec-")),
  );
  temporaryRoots.push(root);
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "state");
  const moduleRoot = join(driveMount, "Modules", "Y2S1", "CC0006");
  await mkdir(stateRoot, { recursive: true });
  const target = join(moduleRoot, registerPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, onDisk, "utf8");
  const source = join(moduleRoot, "NTULearn", sourcePath);
  await mkdir(dirname(source), { recursive: true });
  await writeFile(source, sourceOnDisk);
  return {
    driveMount,
    stateRoot,
    modules: [],
    moduleRoots: new Map([["CC0006", moduleRoot]]),
    unresolved: [],
  };
}

describe("executeCurationIdentityMigration", () => {
  it("refuses the run when the register moved after the preview read it", async () => {
    const observed = await cohort("Something else entirely wrote here.\n");

    const report = await executeCurationIdentityMigration({
      plan: planCurationIdentityMigration({
        modules: [observation(legacyRegister)],
        now: "2026-08-24T06:00:00.000Z",
      }),
      cohort: observed,
      mode: "apply",
    });

    assert.equal(report.outcome, "refused");
    assert.equal(report.appended, 0);
    assert.match(report.refusals[0] ?? "", /changed after it was read/u);
    assert.equal(
      await readFile(
        join(observed.moduleRoots.get("CC0006") ?? "", registerPath),
        "utf8",
      ),
      "Something else entirely wrote here.\n",
    );
  });

  it("refuses the run when the source moved after the preview hashed it", async () => {
    const observed = await cohort(
      legacyRegister,
      Buffer.from("The handout, reissued between preview and apply.\n", "utf8"),
    );

    const report = await executeCurationIdentityMigration({
      plan: planCurationIdentityMigration({
        modules: [observation(legacyRegister)],
        now: "2026-08-24T06:00:00.000Z",
      }),
      cohort: observed,
      mode: "apply",
    });

    assert.equal(report.outcome, "refused");
    assert.equal(report.appended, 0);
    assert.match(report.refusals[0] ?? "", /the source changed/u);
    assert.equal(
      await readFile(
        join(observed.moduleRoots.get("CC0006") ?? "", registerPath),
        "utf8",
      ),
      legacyRegister,
    );
  });

  it("terminates a history whose last line was never terminated before appending", async () => {
    const unterminated = legacyRegister.trimEnd();
    const observed = await cohort(unterminated);

    const report = await executeCurationIdentityMigration({
      plan: planCurationIdentityMigration({
        modules: [observation(unterminated)],
        now: "2026-08-24T06:00:00.000Z",
      }),
      cohort: observed,
      mode: "apply",
    });

    assert.equal(report.outcome, "contract-v4");
    const written = await readFile(
      join(observed.moduleRoots.get("CC0006") ?? "", registerPath),
      "utf8",
    );
    assert.ok(written.startsWith(`${unterminated}\n`));
    assert.equal(written.split("\n").filter(Boolean).length, 2);
  });
});
