import assert from "node:assert/strict";
import {
  glob,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { parse } from "yaml";

it("both TeX jobs reuse completed packages without apt transient state", async () => {
  const workflow: {
    jobs: Record<
      string,
      { steps: { uses?: string; with?: { path?: string } }[] }
    >;
  } = parse(await readFile(".github/workflows/ci.yml", "utf8"));
  const root = await mkdtemp(join(tmpdir(), "academic-tex-cache-"));
  try {
    const source = workflow.jobs["rule-coverage"]?.steps.find((step) =>
      step.uses?.startsWith("actions/cache@"),
    )?.with?.path;
    assert.ok(source !== undefined);
    assert.ok(source.startsWith("~/"));
    const folder = source.slice(2).split("/")[0];
    assert.ok(folder);
    const archives = join(root, folder);
    await mkdir(join(archives, "partial"), { recursive: true });
    await writeFile(join(archives, "lock"), "apt lock");
    await writeFile(join(archives, "partial", "unfinished.deb"), "incomplete");
    const packages = ["first.deb", "second.deb"].map((name) =>
      join(archives, name),
    );
    for (const path of packages) await writeFile(path, "complete package");
    for (const jobName of ["rule-coverage", "templates"]) {
      const job = workflow.jobs[jobName];
      assert.ok(job);
      const configured = job.steps.find((step) =>
        step.uses?.startsWith("actions/cache@"),
      )?.with?.path;
      assert.ok(configured !== undefined);
      assert.ok(configured.startsWith("~/"));
      const selected: string[] = [];
      for await (const path of glob(join(root, configured.slice(2))))
        selected.push(path);
      assert.deepEqual(selected.sort(), packages.sort(), jobName);
    }
  } finally {
    await rm(root, { recursive: true });
  }
});
