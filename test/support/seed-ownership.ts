import assert from "node:assert/strict";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";

import type { SeedExecutionOptions } from "../../src/mounted/types.js";

interface Fixture {
  parentRoot: string;
  targetRoot: string;
  stateRoot: string;
  run(
    options?: SeedExecutionOptions,
  ): Promise<{ outcome: string; evidence: string[] }>;
}

export function seedOwnershipTests(
  createFixture: () => Promise<Fixture>,
): void {
  for (const substitution of [
    "symlink",
    "unclaimed",
    "replacement",
    "foreign-child",
    "changed-file",
    "missing",
  ] as const) {
    it(`preserves unsafe ${substitution} staging on inspection and resume`, async () => {
      const fixture = await createFixture();
      const beforeCreation =
        substitution === "symlink" || substitution === "unclaimed";
      await assert.rejects(
        fixture.run({
          checkpoint: async ({ checkpoint }) => {
            if (
              checkpoint ===
              (beforeCreation ? "before-staging" : "before-publication")
            )
              throw new Error("ownership interruption");
          },
        }),
        /ownership interruption/u,
      );
      const journalRoot = join(fixture.stateRoot, "journals", "seeds");
      const journal = JSON.parse(
        (
          await readFile(
            join(journalRoot, (await readdir(journalRoot))[0] ?? "missing"),
            "utf8",
          )
        ).split("\n")[0] ?? "null",
      ) as { stagingRoot: string };
      const stage = journal.stagingRoot;
      const outside = join(fixture.stateRoot, "outside");
      await mkdir(outside);
      const sentinel = Buffer.from([0, 255, 10, 42]);
      let preserved: string | undefined;
      if (substitution === "symlink") await symlink(outside, stage, "dir");
      if (substitution === "unclaimed") await mkdir(stage);
      if (substitution === "replacement") {
        await rename(stage, `${stage}-parked`);
        await mkdir(stage);
      }
      if (
        ["unclaimed", "replacement", "foreign-child"].includes(substitution)
      ) {
        preserved = join(stage, "foreign.txt");
        await writeFile(preserved, sentinel);
      }
      if (substitution === "changed-file") {
        preserved = join(stage, "AGENTS.md");
        await writeFile(preserved, sentinel);
      }
      if (substitution === "missing") await rm(stage, { recursive: true });
      for (const resume of [false, true]) {
        const report = await fixture.run({ resume });
        assert.equal(report.outcome, "blocked");
        assert.match(report.evidence.join("\n"), /stag/iu);
        if (preserved !== undefined)
          assert.deepEqual(await readFile(preserved), sentinel);
        assert.deepEqual(await readdir(outside), []);
        await assert.rejects(access(fixture.targetRoot), /ENOENT/u);
      }
    });
  }
  for (const substitution of ["symlink", "directory"] as const) {
    it(`refuses a nested publication ancestor replaced by a ${substitution}`, async () => {
      const fixture = await createFixture();
      const outside = join(fixture.stateRoot, "outside");
      await mkdir(outside);
      let parked: string | undefined;
      const report = await fixture.run({
        checkpoint: async ({ checkpoint, operation }) => {
          if (
            checkpoint !== "during-publication" ||
            operation?.kind !== "directory" ||
            parked !== undefined
          )
            return;
          const ancestor = join(fixture.targetRoot, operation.path);
          parked = join(fixture.stateRoot, "parked");
          await rename(ancestor, parked);
          if (substitution === "symlink")
            await symlink(outside, ancestor, "dir");
          else await mkdir(ancestor);
        },
      });
      assert.equal(report.outcome, "blocked");
      assert.deepEqual(await readdir(outside), []);
      assert.ok(parked !== undefined);
      assert.deepEqual(await readdir(parked), []);
    });
  }
}
