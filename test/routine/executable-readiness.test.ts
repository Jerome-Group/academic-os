import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { inspectRoutineExecutables } from "../../src/routine/executable-readiness.js";

it("reports stale installation paths and permissions without invoking executables or exposing paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "academic-os-executables-"));
  try {
    const executable = join(root, "codex");
    await writeFile(executable, "#!/bin/sh\nexit 99\n");
    await chmod(executable, 0o700);
    assert.deepEqual(
      await inspectRoutineExecutables({
        codexPath: executable,
        ghPath: join(root, "missing"),
      }),
      [
        { tool: "codex", status: "ready" },
        { tool: "gh", status: "missing" },
      ],
    );
    await chmod(executable, 0o600);
    assert.deepEqual(
      await inspectRoutineExecutables({ codexPath: executable, ghPath: root }),
      [
        { tool: "codex", status: "not-executable" },
        { tool: "gh", status: "not-executable" },
      ],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
