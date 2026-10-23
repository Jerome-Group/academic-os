import assert from "node:assert/strict";
import {
  lstat,
  open,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  createFileShelfIndexReader,
  openFileShelf,
} from "../../src/textbooks/index.js";
import {
  compileShelfInterposer,
  latestShelfRun,
  releaseShelfBarrier,
  shelfBook,
  shelfProcessFixture,
  startShelfProcess,
  waitShelfBarrier,
  type ShelfProcessFixture,
} from "../support/shelf-process-fixture.js";

const fixtures: ShelfProcessFixture[] = [];
afterEach(async () => {
  await Promise.all(
    fixtures
      .splice(0)
      .map((fixture) => rm(fixture.root, { recursive: true, force: true })),
  );
});
async function fixture(input: Parameters<typeof shelfProcessFixture>[0] = {}) {
  const result = await shelfProcessFixture(input);
  fixtures.push(result);
  return result;
}

describe("real Shelf processes and native boundaries", () => {
  it("contends across cold canonical aliases and retry preserves both entries and Owner nodes", async () => {
    const f = await fixture({ existingIndex: true });
    const first = startShelfProcess(f, { phase: "started" });
    await waitShelfBarrier(f);
    await symlink(f.shelfRoot, join(f.root, "shelf-alias"));
    await symlink(f.stateRoot, join(f.root, "state-alias"));
    const request = JSON.parse(await readFile(f.request, "utf8"));
    await writeFile(
      f.request,
      JSON.stringify({
        ...request,
        shelfRoot: join(f.root, "shelf-alias"),
        stateRoot: join(f.root, "state-alias"),
      }),
    );
    const contender = await startShelfProcess(f).finished;
    assert.equal(contender.code, 0, contender.stderr);
    assert.equal(JSON.parse(contender.stdout).outcome, "refused");
    assert.match(
      JSON.parse(contender.stdout).mutation.reasons.join(" "),
      /Another invocation owns/u,
    );
    assert.equal(
      await readFile(join(f.shelfRoot, "00 Index.yaml"), "utf8"),
      "# Owner\nowner: retained\nbooks: {}\n",
    );
    await releaseShelfBarrier(f);
    const completed = await first.finished;
    assert.equal(completed.code, 0, completed.stderr);
    assert.equal(
      JSON.parse(completed.stdout).outcome,
      "caught-up",
      completed.stdout,
    );
    await writeFile(
      join(f.shelfRoot, "Analysis I Tao.pdf"),
      "second approved book",
    );
    const retry = await startShelfProcess(f).finished;
    assert.equal(retry.code, 0, retry.stderr);
    assert.equal(JSON.parse(retry.stdout).outcome, "caught-up", retry.stdout);
    assert.deepEqual(
      Object.keys(
        (await createFileShelfIndexReader(f.shelfRoot).read()).books,
      ).sort(),
      ["Axler", "Tao"],
    );
    assert.match(
      await readFile(join(f.shelfRoot, "00 Index.yaml"), "utf8"),
      /# Owner\nowner: retained/u,
    );
  });

  it("native exclusion preserves an arrival after the helper checked its source", async () => {
    const f = await fixture({ migration: true });
    const library = await compileShelfInterposer(f.root);
    const process = startShelfProcess(f, {
      interposer: library,
      target: shelfBook,
    });
    await waitShelfBarrier(f);
    await writeFile(join(f.shelfRoot, shelfBook), "foreign target arrival");
    await releaseShelfBarrier(f);
    const result = await process.finished;
    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "partial", result.stdout);
    assert.equal(report.index, "not-written");
    assert.equal(
      await readFile(join(f.shelfRoot, shelfBook), "utf8"),
      "foreign target arrival",
    );
    assert.equal(
      await readFile(join(f.shelfRoot, "old.pdf"), "utf8"),
      "approved book",
    );
    assert.equal((await readdir(f.shelfRoot)).includes("00 Index.yaml"), false);
  });

  it("negative control proves ordinary book rename clobbers the arrival and falsely reports success", async () => {
    const f = await fixture({ migration: true });
    const library = await compileShelfInterposer(f.root);
    const process = startShelfProcess(f, {
      interposer: library,
      target: shelfBook,
      unsafe: true,
    });
    await waitShelfBarrier(f);
    await writeFile(
      join(f.shelfRoot, shelfBook),
      "foreign bytes destroyed by control",
    );
    await releaseShelfBarrier(f);
    const result = await process.finished;
    assert.equal(JSON.parse(result.stdout).outcome, "migrated", result.stderr);
    assert.equal(
      await readFile(join(f.shelfRoot, shelfBook), "utf8"),
      "approved book",
    );
    assert.equal(
      (await readdir(f.shelfRoot)).some((name) => name.includes("foreign")),
      false,
    );
  });

  it("negative control proves ordinary index replacement destroys a late edit and leaves no captured original", async () => {
    const f = await fixture({ existingIndex: true });
    const library = await compileShelfInterposer(f.root);
    const process = startShelfProcess(f, {
      interposer: library,
      target: "00 Index.yaml",
      unsafe: true,
    });
    await waitShelfBarrier(f);
    await writeFile(
      join(f.shelfRoot, "00 Index.yaml"),
      "late: destroyed-by-control\nbooks: {}\n",
    );
    await releaseShelfBarrier(f);
    const result = await process.finished;
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "partial", result.stderr);
    assert.doesNotMatch(
      await readFile(join(f.shelfRoot, "00 Index.yaml"), "utf8"),
      /destroyed-by-control/u,
    );
    await assert.rejects(readFile(report.mutation.captures[0]));
  });

  it("detects a substituted source at the syscall boundary and withholds the entire index", async () => {
    const f = await fixture({ migration: true });
    const library = await compileShelfInterposer(f.root);
    const process = startShelfProcess(f, {
      interposer: library,
      target: shelfBook,
    });
    await waitShelfBarrier(f);
    await rename(
      join(f.shelfRoot, "old.pdf"),
      join(f.root, "approved-original.pdf"),
    );
    await writeFile(join(f.shelfRoot, "old.pdf"), "substituted source");
    await releaseShelfBarrier(f);
    const result = await process.finished;
    assert.equal(JSON.parse(result.stdout).outcome, "partial", result.stderr);
    assert.equal(JSON.parse(result.stdout).index, "not-written");
    assert.equal(
      await readFile(join(f.shelfRoot, shelfBook), "utf8"),
      "substituted source",
    );
    assert.equal(
      await readFile(join(f.root, "approved-original.pdf"), "utf8"),
      "approved book",
    );
    assert.equal((await readdir(f.shelfRoot)).includes("00 Index.yaml"), false);
  });

  it("detects an arrival at the vacated source after a real book move", async () => {
    const f = await fixture({ migration: true });
    const process = startShelfProcess(f, { phase: "book-observed" });
    await waitShelfBarrier(f);
    await writeFile(join(f.shelfRoot, "old.pdf"), "new source arrival");
    await releaseShelfBarrier(f);
    const result = await process.finished;
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "partial", result.stderr);
    assert.equal(report.index, "not-written");
    assert.equal(
      await readFile(join(f.shelfRoot, "old.pdf"), "utf8"),
      "new source arrival",
    );
    assert.equal(
      await readFile(join(f.shelfRoot, shelfBook), "utf8"),
      "approved book",
    );
    const fresh = await startShelfProcess(f).finished;
    assert.equal(JSON.parse(fresh.stdout).outcome, "refused", fresh.stderr);
    assert.equal((await readdir(f.shelfRoot)).includes("00 Index.yaml"), false);
  });

  for (const drift of ["changed", "missing"]) {
    it(`checks a later unchanged-name source ${drift} after planning before the first move`, async () => {
      const f = await fixture({ migration: true });
      const later = "Analysis I Tao.pdf";
      await writeFile(join(f.shelfRoot, later), "second approved");
      const request = JSON.parse(await readFile(f.request, "utf8"));
      const checksum = (
        await import("../support/shelf-process-fixture.js")
      ).shelfHash("second approved");
      request.review.books.push({ file: later, key: "Tao", sha256: checksum });
      await writeFile(f.request, JSON.stringify(request));
      const process = startShelfProcess(f, { phase: "started" });
      await waitShelfBarrier(f);
      if (drift === "changed")
        await writeFile(join(f.shelfRoot, later), "later changed bytes");
      else
        await rename(
          join(f.shelfRoot, later),
          join(f.root, "removed-later.pdf"),
        );
      await releaseShelfBarrier(f);
      const result = await process.finished;
      const report = JSON.parse(result.stdout);
      assert.equal(report.outcome, "partial", result.stderr);
      assert.equal(report.index, "not-written");
      assert.equal(
        await readFile(join(f.shelfRoot, "old.pdf"), "utf8"),
        "approved book",
      );
      assert.equal((await readdir(f.shelfRoot)).includes(shelfBook), false);
    });
  }

  it("rechecks catch-up bytes after planning and withholds stale hashes", async () => {
    const f = await fixture();
    const process = startShelfProcess(f, { phase: "started" });
    await waitShelfBarrier(f);
    await writeFile(join(f.shelfRoot, shelfBook), "changed catch-up bytes");
    await releaseShelfBarrier(f);
    const result = await process.finished;
    assert.equal(JSON.parse(result.stdout).outcome, "partial", result.stderr);
    assert.equal((await readdir(f.shelfRoot)).includes("00 Index.yaml"), false);
    assert.equal(
      await readFile(join(f.shelfRoot, shelfBook), "utf8"),
      "changed catch-up bytes",
    );
  });

  it("compares the exact planned listing with a new arrival before creating any mounted metadata", async () => {
    const f = await fixture();
    const process = startShelfProcess(f, {
      phase: "after-plan-read",
      target: shelfBook,
    });
    await waitShelfBarrier(f);
    await writeFile(
      join(f.shelfRoot, "Analysis I Tao.pdf"),
      "newly arriving book",
    );
    await releaseShelfBarrier(f);
    const result = await process.finished;
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "refused", result.stderr);
    assert.equal(report.index, "not-written");
    assert.deepEqual(
      (await readdir(f.shelfRoot)).sort(),
      ["Analysis I Tao.pdf", shelfBook].sort(),
    );
  });

  it("keeps already-indexed reviewed rows in a mixed retry's byte obligations", async () => {
    const f = await fixture({ existingIndex: true });
    const first = await startShelfProcess(f).finished;
    assert.equal(JSON.parse(first.stdout).outcome, "caught-up", first.stderr);
    await writeFile(join(f.shelfRoot, "old.pdf"), "next book");
    const hash = (await import("../support/shelf-process-fixture.js"))
      .shelfHash;
    const request = JSON.parse(await readFile(f.request, "utf8"));
    await writeFile(
      f.request,
      JSON.stringify({
        ...request,
        operation: "migrate",
        review: {
          books: [
            { file: shelfBook, key: "Axler", sha256: hash("approved book") },
            {
              file: "old.pdf",
              rename: "Analysis I Tao.pdf",
              key: "Tao",
              sha256: hash("next book"),
            },
          ],
        },
      }),
    );
    const process = startShelfProcess(f, { phase: "started" });
    await waitShelfBarrier(f);
    await writeFile(
      join(f.shelfRoot, shelfBook),
      "already-indexed bytes changed",
    );
    await releaseShelfBarrier(f);
    const result = await process.finished;
    assert.equal(JSON.parse(result.stdout).outcome, "partial", result.stderr);
    assert.equal(
      await readFile(join(f.shelfRoot, "old.pdf"), "utf8"),
      "next book",
    );
    assert.equal(
      (await createFileShelfIndexReader(f.shelfRoot).read()).books.Tao,
      undefined,
    );
  });

  it("withholds the whole index batch after final book digest drift", async () => {
    const f = await fixture({ migration: true });
    const process = startShelfProcess(f, { phase: "book-observed" });
    await waitShelfBarrier(f);
    await writeFile(
      join(f.shelfRoot, shelfBook),
      "final externally changed bytes",
    );
    await releaseShelfBarrier(f);
    const result = await process.finished;
    assert.equal(JSON.parse(result.stdout).outcome, "partial", result.stderr);
    assert.equal(JSON.parse(result.stdout).index, "not-written");
    assert.equal(
      await readFile(join(f.shelfRoot, shelfBook), "utf8"),
      "final externally changed bytes",
    );
    assert.equal((await readdir(f.shelfRoot)).includes("00 Index.yaml"), false);
  });

  for (const edit of ["in-place", "atomic", "old-descriptor"]) {
    it(`retains a late ${edit} Owner edit and reports published-unconfirmed`, async () => {
      const f = await fixture({ existingIndex: true });
      const library = await compileShelfInterposer(f.root);
      const descriptor = await open(join(f.shelfRoot, "00 Index.yaml"), "a");
      try {
        const process = startShelfProcess(
          f,
          edit === "old-descriptor"
            ? { phase: "after-exchange" }
            : { interposer: library, target: "00 Index.yaml" },
        );
        await waitShelfBarrier(f);
        const late = "# Late Owner\nlate: preserved\nbooks: {}\n";
        if (edit === "in-place")
          await writeFile(join(f.shelfRoot, "00 Index.yaml"), late);
        else if (edit === "atomic") {
          await writeFile(join(f.root, "replacement.yaml"), late);
          await rename(
            join(f.root, "replacement.yaml"),
            join(f.shelfRoot, "00 Index.yaml"),
          );
        } else {
          await descriptor.writeFile("late: preserved\n");
          await descriptor.sync();
        }
        await releaseShelfBarrier(f);
        const result = await process.finished;
        const report = JSON.parse(result.stdout);
        assert.equal(report.outcome, "partial", result.stderr);
        assert.equal(report.index, "published-unconfirmed");
        const capture = report.mutation.captures[0];
        assert.ok(typeof capture === "string");
        assert.match(await readFile(capture, "utf8"), /late: preserved/u);
        assert.match(
          await readFile(join(f.shelfRoot, "00 Index.yaml"), "utf8"),
          /Axler:/u,
        );
        assert.doesNotMatch(
          await readFile(join(f.shelfRoot, "00 Index.yaml"), "utf8"),
          /late:/u,
        );
        const fresh = await startShelfProcess(f).finished;
        assert.equal(JSON.parse(fresh.stdout).outcome, "refused", fresh.stderr);
        assert.match(await readFile(capture, "utf8"), /late: preserved/u);
      } finally {
        await descriptor.close();
      }
    });
  }

  it("exclusively publishes a missing index without clobbering an arriving canonical file", async () => {
    const f = await fixture();
    const library = await compileShelfInterposer(f.root);
    const process = startShelfProcess(f, {
      interposer: library,
      target: "00 Index.yaml",
    });
    await waitShelfBarrier(f);
    await writeFile(
      join(f.shelfRoot, "00 Index.yaml"),
      "foreign: arrival\nbooks: {}\n",
    );
    await releaseShelfBarrier(f);
    const result = await process.finished;
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "partial", result.stderr);
    assert.equal(
      await readFile(join(f.shelfRoot, "00 Index.yaml"), "utf8"),
      "foreign: arrival\nbooks: {}\n",
    );
    assert.match(
      await readFile(report.mutation.captures[0], "utf8"),
      /Axler:/u,
    );
  });

  it("reports proposal substitution after native identity checks as partial", async () => {
    const f = await fixture({ existingIndex: true });
    const library = await compileShelfInterposer(f.root);
    const process = startShelfProcess(f, {
      interposer: library,
      target: "00 Index.yaml",
    });
    await waitShelfBarrier(f);
    const run = await latestShelfRun(f);
    await rename(
      join(f.shelfRoot, run.proposal),
      join(f.root, "approved-proposal.yaml"),
    );
    await writeFile(join(f.shelfRoot, run.proposal), "foreign: proposal\n");
    await releaseShelfBarrier(f);
    const result = await process.finished;
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "partial", result.stderr);
    assert.equal(
      await readFile(join(f.shelfRoot, "00 Index.yaml"), "utf8"),
      "foreign: proposal\n",
    );
    assert.match(
      await readFile(join(f.shelfRoot, run.proposal), "utf8"),
      /owner: retained/u,
    );
    assert.match(
      await readFile(join(f.root, "approved-proposal.yaml"), "utf8"),
      /Axler:/u,
    );
  });

  it("pins proposal identity and intended bytes from the writer descriptor before pathname observation", async () => {
    const f = await fixture({ existingIndex: true });
    const process = startShelfProcess(f, { phase: "after-proposal-write" });
    await waitShelfBarrier(f);
    const run = await latestShelfRun(f);
    await rename(
      join(f.shelfRoot, run.proposal),
      join(f.root, "approved-proposal.yaml"),
    );
    await writeFile(
      join(f.shelfRoot, run.proposal),
      "owner: foreign-proposal\nbooks: {}\n",
    );
    await releaseShelfBarrier(f);
    const result = await process.finished;
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "partial", result.stderr);
    assert.equal(report.index, "not-written");
    assert.equal(
      await readFile(join(f.shelfRoot, "00 Index.yaml"), "utf8"),
      "# Owner\nowner: retained\nbooks: {}\n",
    );
    assert.equal(
      await readFile(join(f.shelfRoot, run.proposal), "utf8"),
      "owner: foreign-proposal\nbooks: {}\n",
    );
    assert.match(
      await readFile(join(f.root, "approved-proposal.yaml"), "utf8"),
      /Axler:/u,
    );
  });

  it("never adopts a substituted probe file as owned cleanup material", async () => {
    const f = await fixture({ migration: true });
    const process = startShelfProcess(f, { phase: "after-probe-write" });
    await waitShelfBarrier(f);
    const run = await latestShelfRun(f);
    const probe = join(
      f.shelfRoot,
      `.academic-os-shelf-probe-${run.runId}`,
      "a",
    );
    await rename(probe, join(f.root, "owned-probe-original"));
    await writeFile(probe, "foreign probe bytes");
    await releaseShelfBarrier(f);
    const result = await process.finished;
    assert.equal(JSON.parse(result.stdout).outcome, "partial", result.stderr);
    assert.equal(await readFile(probe, "utf8"), "foreign probe bytes");
    assert.equal(
      await readFile(join(f.shelfRoot, "old.pdf"), "utf8"),
      "approved book",
    );
    assert.equal((await readdir(f.shelfRoot)).includes("00 Index.yaml"), false);
  });

  it("pins native moves to the opened root and reports pathname replacement drift", async () => {
    const f = await fixture({ migration: true });
    const library = await compileShelfInterposer(f.root);
    const process = startShelfProcess(f, {
      interposer: library,
      target: shelfBook,
    });
    await waitShelfBarrier(f);
    await rename(f.shelfRoot, join(f.root, "moved-shelf"));
    await mkdir(f.shelfRoot);
    await writeFile(join(f.shelfRoot, "foreign.pdf"), "replacement root bytes");
    await releaseShelfBarrier(f);
    const result = await process.finished;
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "partial", result.stderr);
    assert.equal(
      await readFile(join(f.root, "moved-shelf", shelfBook), "utf8"),
      "approved book",
    );
    assert.equal(
      await readFile(join(f.shelfRoot, "foreign.pdf"), "utf8"),
      "replacement root bytes",
    );
    assert.match(
      JSON.stringify(report.mutation.recovery),
      /root identity changed/u,
    );
  });

  for (const fault of [
    "receipt",
    "readback",
    "missing",
    "malformed",
    "duplicate",
    "version",
    "native-sync",
    "native-signal",
  ]) {
    it(`reconciles ${fault} failure without a second exchange`, async () => {
      const f = await fixture({ existingIndex: true });
      const library = fault.startsWith("native-")
        ? await compileShelfInterposer(f.root)
        : undefined;
      if (library !== undefined) await releaseShelfBarrier(f);
      const result = await startShelfProcess(f, {
        fault,
        ...(library === undefined
          ? {}
          : { interposer: library, target: "00 Index.yaml" }),
      }).finished;
      const report = JSON.parse(result.stdout);
      assert.equal(report.outcome, "partial", result.stderr);
      const capture = report.mutation.captures[0];
      assert.ok(typeof capture === "string");
      const originalIdentity = await lstat(capture, { bigint: true });
      const shelf = await openFileShelf(f);
      const run = await latestShelfRun(f);
      assert.equal(
        (await shelf.reconcile({ runId: run.runId })).state,
        "applied",
      );
      const retry = await startShelfProcess(f).finished;
      assert.equal(JSON.parse(retry.stdout).outcome, "caught-up", retry.stderr);
      assert.equal(JSON.parse(retry.stdout).index, "not-written");
      assert.equal(
        (await lstat(capture, { bigint: true })).ino,
        originalIdentity.ino,
      );
      assert.match(await readFile(capture, "utf8"), /owner: retained/u);
    });
  }

  it("observes a timed-out helper's exact unapplied pair before a fresh owned retry", async () => {
    const f = await fixture({ existingIndex: true });
    const library = await compileShelfInterposer(f.root);
    const process = startShelfProcess(f, {
      interposer: library,
      target: "00 Index.yaml",
    });
    await waitShelfBarrier(f);
    const result = await process.finished;
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "partial", result.stderr);
    assert.equal(report.index, "not-written");
    const run = await latestShelfRun(f);
    assert.equal(
      (await (await openFileShelf(f)).reconcile({ runId: run.runId })).state,
      "unapplied",
    );
    const proposal = await readFile(join(f.shelfRoot, run.proposal), "utf8");
    const retry = await startShelfProcess(f).finished;
    assert.equal(JSON.parse(retry.stdout).outcome, "caught-up", retry.stderr);
    assert.equal(
      await readFile(join(f.shelfRoot, run.proposal), "utf8"),
      proposal,
    );
  });

  it("needs no compiler for preview/no-op, and refuses actual append before mounted effects without cc", async () => {
    const f = await fixture({ migration: true });
    const emptyPath = join(f.root, "empty-path");
    await mkdir(emptyPath);
    const refused = await startShelfProcess(f, { path: emptyPath }).finished;
    assert.equal(JSON.parse(refused.stdout).outcome, "refused", refused.stderr);
    assert.deepEqual(await readdir(f.shelfRoot), ["old.pdf"]);
    const request = JSON.parse(await readFile(f.request, "utf8"));
    await writeFile(f.request, JSON.stringify({ ...request, mode: "preview" }));
    const preview = await startShelfProcess(f, { path: emptyPath }).finished;
    assert.equal(
      JSON.parse(preview.stdout).outcome,
      "previewed",
      preview.stderr,
    );
    await writeFile(f.request, JSON.stringify(request));
    const completed = await startShelfProcess(f).finished;
    assert.equal(
      JSON.parse(completed.stdout).outcome,
      "migrated",
      completed.stderr,
    );
    const noop = await startShelfProcess(f, { path: emptyPath }).finished;
    assert.equal(JSON.parse(noop.stdout).outcome, "migrated", noop.stderr);
    assert.equal(JSON.parse(noop.stdout).index, "not-written");
  });

  it("refuses unsupported native operations before book effects and retains exact probe evidence", async () => {
    const f = await fixture({ migration: true });
    const library = await compileShelfInterposer(f.root);
    await releaseShelfBarrier(f);
    const result = await startShelfProcess(f, {
      fault: "unsupported",
      interposer: library,
      target: "b",
    }).finished;
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "partial", result.stderr);
    assert.equal(report.index, "not-written");
    assert.equal(
      await readFile(join(f.shelfRoot, "old.pdf"), "utf8"),
      "approved book",
    );
    assert.equal((await readdir(f.shelfRoot)).includes(shelfBook), false);
    assert.match(
      JSON.stringify(report.mutation.recovery),
      /capability probe needs exact-path inspection/u,
    );
  });

  it("daily prelude carries partial publication and exact recovery paths", async () => {
    const f = await fixture({ existingIndex: true });
    const request = JSON.parse(await readFile(f.request, "utf8"));
    await writeFile(
      f.request,
      JSON.stringify({ ...request, operation: "prelude" }),
    );
    const library = await compileShelfInterposer(f.root);
    const process = startShelfProcess(f, {
      interposer: library,
      target: "00 Index.yaml",
    });
    await waitShelfBarrier(f);
    await writeFile(
      join(f.shelfRoot, "00 Index.yaml"),
      "late: daily-preserved\nbooks: {}\n",
    );
    await releaseShelfBarrier(f);
    const result = await process.finished;
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "partial", result.stderr);
    assert.equal(report.failure.code, "shelf-mutation-incomplete");
    assert.match(report.detail.join("\n"), /index published-unconfirmed/u);
    assert.match(
      report.detail.join("\n"),
      /Retained index capture\/proposal:/u,
    );
    assert.match(report.detail.join("\n"), /Recovery:/u);
  });

  for (const phase of [
    "started",
    "book-intent",
    "book-observed",
    "publication-intent",
    "after-exchange",
    "observed",
    "before-terminal",
  ]) {
    it(`freshly reconciles SIGKILL at ${phase} and fences genuine partial work`, async () => {
      const f = await fixture({ existingIndex: true, migration: true });
      const process = startShelfProcess(f, { phase });
      await waitShelfBarrier(f);
      process.child.kill("SIGKILL");
      assert.equal((await process.finished).signal, "SIGKILL");
      const run = await latestShelfRun(f);
      const shelf = await openFileShelf(f);
      const observation = await shelf.reconcile({ runId: run.runId });
      const expected = ["started", "book-intent"].includes(phase)
        ? "unapplied"
        : ["book-observed", "publication-intent"].includes(phase)
          ? "partial"
          : "applied";
      assert.equal(observation.state, expected, JSON.stringify(observation));
      const captureBefore =
        expected === "applied"
          ? await readFile(join(f.shelfRoot, run.proposal), "utf8")
          : undefined;
      const fresh = await startShelfProcess(f).finished;
      const report = JSON.parse(fresh.stdout);
      assert.equal(
        report.outcome,
        expected === "partial" ? "refused" : "migrated",
        fresh.stderr,
      );
      if (captureBefore !== undefined)
        assert.equal(
          await readFile(join(f.shelfRoot, run.proposal), "utf8"),
          captureBefore,
        );
      if (expected === "partial")
        assert.equal(
          await readFile(join(f.shelfRoot, "00 Index.yaml"), "utf8"),
          "# Owner\nowner: retained\nbooks: {}\n",
        );
    });
  }
});
