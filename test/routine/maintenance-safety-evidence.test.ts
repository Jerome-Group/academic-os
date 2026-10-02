import assert from "node:assert/strict";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { sha256Bytes } from "../../src/checksum.js";
import {
  stageMaintenanceSafetyEvidence,
  verifyMaintenanceSafetyEvidence,
} from "../../src/routine/maintenance-safety-evidence.js";
import { learningWorkspacePaths } from "../fixtures/learning-workspace.js";
import {
  moduleControlContents,
  validModuleControls,
} from "../fixtures/module-controls.js";
import { universalPaths } from "../fixtures/universal-structure.js";

it("takes exact procedure bytes exclusively and refuses missing, altered or writable evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "academic-os-safety-evidence-"));
  try {
    const source = pathToFileURL(join(root, "source.md"));
    await writeFile(source, "# Synthetic safety procedure\n");
    const evidence = await stageMaintenanceSafetyEvidence({
      artifacts: root,
      source,
    });
    assert.equal((await stat(evidence.snapshotPath)).mode & 0o777, 0o400);
    assert.equal(evidence.sha256, sha256Bytes(await readFile(source)));
    assert.ok(
      (await readFile(source)).equals(await readFile(evidence.snapshotPath)),
    );
    await assert.rejects(
      stageMaintenanceSafetyEvidence({ artifacts: root, source }),
      { code: "EEXIST" },
    );
    await writeFile(source, "changed procedure\n");
    await assert.rejects(
      verifyMaintenanceSafetyEvidence(evidence, source),
      /source or snapshot changed/u,
    );
    await writeFile(source, "# Synthetic safety procedure\n");
    await chmod(evidence.snapshotPath, 0o600);
    await assert.rejects(
      verifyMaintenanceSafetyEvidence(evidence, source),
      /read-only/u,
    );
    await writeFile(evidence.snapshotPath, "tampered snapshot\n");
    await chmod(evidence.snapshotPath, 0o400);
    await assert.rejects(
      verifyMaintenanceSafetyEvidence(evidence, source),
      /source or snapshot changed/u,
    );
    await rm(evidence.snapshotPath);
    await assert.rejects(verifyMaintenanceSafetyEvidence(evidence, source), {
      code: "ENOENT",
    });
    await rm(source);
    await assert.rejects(
      stageMaintenanceSafetyEvidence({ artifacts: root, source }),
      /canonical.*unavailable/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("fails the production session before model invocation when its canonical procedure is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "academic-os-safety-production-"));
  try {
    const clone = join(root, "runtime");
    await mkdir(join(clone, "dist"), { recursive: true });
    await cp(
      fileURLToPath(new URL("../../src/", import.meta.url)),
      join(clone, "dist/src"),
      { recursive: true },
    );
    await cp(
      fileURLToPath(new URL("../../../seed-templates/", import.meta.url)),
      join(clone, "seed-templates"),
      { recursive: true },
    );
    await symlink(
      fileURLToPath(new URL("../../../node_modules/", import.meta.url)),
      join(clone, "node_modules"),
    );
    await writeFile(join(clone, "package.json"), '{"type":"module"}\n');
    const { createCodexModuleSession } = await import(
      pathToFileURL(join(clone, "dist/src/routine/codex-module-session.js"))
        .href
    );
    const driveMount = join(root, "drive");
    const stateRoot = join(root, "state");
    await mkdir(stateRoot);
    const moduleRoot = join(driveMount, "Semester", "MH2100");
    const controls = moduleControlContents(validModuleControls());
    for (const [path, kind] of [...universalPaths, ...learningWorkspacePaths]) {
      const target = join(moduleRoot, path);
      if (kind === "directory") await mkdir(target, { recursive: true });
      else {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, controls.get(path) ?? "fixture\n");
      }
    }
    let invoked = false;
    const session = createCodexModuleSession({
      config: {
        driveMount,
        stateRoot,
        activeSemester: "Y2S1",
        semesters: {
          Y2S1: { root: "Semester", status: "active", modules: ["MH2100"] },
        },
      },
      codexPath: "/private/synthetic-unused-codex",
      date: "2026-08-23",
      runner: async () => {
        invoked = true;
        return 0;
      },
    });
    const report = await session.run({ semester: "Y2S1", module: "MH2100" });
    assert.equal(invoked, false);
    assert.ok(
      report.failures.some(({ message }: { message: string }) =>
        /canonical.*unavailable/u.test(message),
      ),
    );
    await readFile(
      join(
        report.artifacts,
        "original-controls/00 Module Admin/10 Module Definition.yaml",
      ),
    );
    assert.equal(
      await readFile(
        join(report.artifacts, "write-journal/operations.jsonl"),
        "utf8",
      ),
      "",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
