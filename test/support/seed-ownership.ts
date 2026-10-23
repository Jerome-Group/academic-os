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
  directoryPath: string;
  filePath: string;
  run(
    options?: SeedExecutionOptions,
  ): Promise<{ outcome: string; evidence: string[] }>;
}

export function seedOwnershipTests(
  createFixture: () => Promise<Fixture>,
): void {
  it("refuses a concurrent resume before journal or mounted effects", async () => {
    const fixture = await createFixture();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const owner = fixture.run({
      checkpoint: async ({ checkpoint }) => {
        if (checkpoint !== "before-staging") return;
        entered.resolve();
        await release.promise;
      },
    });
    await entered.promise;
    try {
      const directory = join(fixture.stateRoot, "journals", "seeds");
      const path = join(directory, (await readdir(directory))[0] ?? "missing");
      const before = await readFile(path);
      const mountedBefore = await readdir(fixture.parentRoot);
      const loser = await fixture.run({ resume: true });
      assert.equal(loser.outcome, "blocked");
      assert.match(loser.evidence.join(" "), /another invocation owns/iu);
      assert.deepEqual(await readFile(path), before);
      assert.deepEqual(await readdir(fixture.parentRoot), mountedBefore);
    } finally {
      release.resolve();
      await owner;
    }
    assert.equal((await fixture.run({ resume: true })).outcome, "completed");
  });
  for (const substitution of [
    "symlink",
    "unclaimed",
    "replacement",
    "foreign-child",
    "changed-file",
    "missing",
    "missing-file",
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
      if (substitution === "missing-file") await rm(join(stage, "AGENTS.md"));
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
  it("refuses completion when published approved bytes change", async () => {
    const fixture = await createFixture();
    const path = join(fixture.targetRoot, fixture.filePath);
    const report = await fixture.run({
      checkpoint: async ({ checkpoint }) => {
        if (checkpoint === "after-publication")
          await writeFile(path, "changed after publication\n");
      },
    });
    assert.equal(report.outcome, "blocked");
    assert.equal(await readFile(path, "utf8"), "changed after publication\n");
  });
  it("refuses to recreate an approved existing directory removed after approval", async () => {
    const fixture = await createFixture();
    await mkdir(join(fixture.targetRoot, fixture.directoryPath), {
      recursive: true,
    });
    const report = await fixture.run({
      checkpoint: async ({ checkpoint }) => {
        if (checkpoint === "before-staging")
          await rm(join(fixture.targetRoot, fixture.directoryPath), {
            recursive: true,
          });
      },
    });
    assert.equal(report.outcome, "blocked");
    await assert.rejects(
      access(join(fixture.targetRoot, fixture.directoryPath)),
      /ENOENT/u,
    );
  });
  it("refuses a changed configured parent before claiming the publication root", async () => {
    const fixture = await createFixture();
    const outside = join(fixture.stateRoot, "outside");
    await mkdir(outside);
    const parked = join(fixture.stateRoot, "parked-parent");
    const report = await fixture.run({
      checkpoint: async ({ checkpoint }) => {
        if (checkpoint !== "before-publication") return;
        await rename(fixture.parentRoot, parked);
        await symlink(outside, fixture.parentRoot, "dir");
      },
    });
    assert.equal(report.outcome, "blocked");
    assert.deepEqual(await readdir(outside), []);
    assert.ok(
      (await readdir(parked)).some((name) =>
        name.startsWith(".academic-os-stage-"),
      ),
    );
  });
  it("retains the complete stage when final cleanup finds unrelated bytes", async () => {
    const fixture = await createFixture();
    let sentinel: string | undefined;
    const report = await fixture.run({
      checkpoint: async ({ checkpoint }) => {
        if (checkpoint !== "after-publication") return;
        const root = join(fixture.stateRoot, "journals", "seeds");
        const started = JSON.parse(
          (
            await readFile(
              join(root, (await readdir(root))[0] ?? "missing"),
              "utf8",
            )
          ).split("\n")[0] ?? "null",
        ) as { stagingRoot: string };
        sentinel = join(started.stagingRoot, "foreign.txt");
        await writeFile(sentinel, "unrelated bytes\n");
      },
    });
    assert.equal(report.outcome, "blocked");
    assert.match(report.evidence.join("\n"), /preserved.*cleanup refused/iu);
    assert.doesNotMatch(
      report.evidence.join("\n"),
      /staging.*were removed|failure removed temporary/iu,
    );
    assert.ok(sentinel !== undefined);
    assert.equal(await readFile(sentinel, "utf8"), "unrelated bytes\n");
    assert.ok((await readdir(join(sentinel, ".."))).length > 1);
  });
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
