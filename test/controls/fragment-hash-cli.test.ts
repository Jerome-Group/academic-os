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
import type { Fragment } from "../../src/controls/generated/module-verification-1.js";
import { moduleCode, sha } from "./fixtures.js";
import {
  syntheticQuestion,
  verificationControls,
  verificationFixture,
} from "./module-verification-fixtures.js";

const cli = fileURLToPath(new URL("../../src/cli.js", import.meta.url));
const recipes = [
  "utf8-identity/1",
  "pdf-text/1",
  "docx-text/1",
] as const satisfies readonly Fragment["extractor"]["recipe"][];
const variants = [
  "full",
  "full-corrupt",
  "empty",
  "empty-corrupt",
  "end-empty",
  "end-empty-corrupt",
  "subrange",
  "page-same-length",
  "page-empty",
  "page-empty-corrupt",
  "page-end-empty",
  "page-end-empty-corrupt",
  "observed-subrange",
  "observed-subrange-corrupt",
] as const;

for (const recipe of recipes)
  for (const variant of variants) {
    const observed = variant.startsWith("observed-");
    if (observed && recipe !== "utf8-identity/1") continue;
    it(`validates ${recipe} fragment ${variant} through actual module validate`, async (context) => {
      const controls = verificationControls();
      const records = controls.find(
        (value) => value.role === "learning-records",
      );
      assert.ok(
        records?.role === "learning-records" && records.schemaVersion === 2,
      );
      const review = records.assessments[0];
      assert.ok(review && "recordVersion" in review);
      const criterion = review.criteria[0];
      assert.ok(
        criterion.applicability === "applies" &&
          criterion.basis.kind === "inferred",
      );
      const fragment = criterion.basis.sources[0];
      assert.ok(fragment);
      const extraction =
        recipe === "utf8-identity/1"
          ? syntheticQuestion
          : Buffer.from(
              `Synthetic ${recipe} extraction differs from original.\n`,
            );
      fragment.extractor.recipe = recipe;
      fragment.extraction = {
        byteLength: extraction.length,
        byteSha256: sha(extraction),
      };
      fragment.location = {
        kind: "utf8-bytes",
        start: 0,
        length: extraction.length,
      };
      fragment.fragmentSha256 = sha(extraction);
      if (variant.includes("empty")) {
        fragment.location.start = variant.includes("end")
          ? extraction.length
          : 0;
        fragment.location.length = 0;
        fragment.fragmentSha256 = sha(Buffer.alloc(0));
      }
      if (variant.includes("subrange")) {
        fragment.location.start = 1;
        fragment.location.length = 2;
        fragment.fragmentSha256 = sha(extraction.subarray(1, 3));
      }
      const page = variant.startsWith("page-");
      if (page) {
        fragment.location = {
          ...fragment.location,
          kind: "page-text",
          page: 2,
        };
        if (variant === "page-same-length")
          fragment.fragmentSha256 = sha(Buffer.alloc(extraction.length, "p"));
      }
      if (variant.endsWith("corrupt"))
        fragment.fragmentSha256 =
          variant === "full-corrupt" && recipe !== "utf8-identity/1"
            ? fragment.original.byteSha256
            : "f".repeat(64);
      if (observed) {
        const evidence = controls.find((value) => value.role === "evidence");
        assert.ok(evidence?.role === "evidence");
        const source = evidence.entries.find(
          (entry) => entry.id === fragment.source.id,
        );
        assert.ok(source?.locator.kind === "retained-original");
        source.locator.path = "docs/synthetic-source.md";
      }
      const files = verificationFixture(controls).flatMap((file) =>
        file.path === ".academic-os/legacy/source.md"
          ? observed
            ? [{ ...file, path: "docs/synthetic-source.md" }]
            : []
          : [file],
      );
      const directory = await mkdtemp(
        join(await realpath(tmpdir()), "verification-fragment-hash-"),
      );
      await chmod(directory, 0o700);
      const root = join(directory, moduleCode);
      const before = [];
      for (const file of files) {
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
      const expectedExit =
        variant.endsWith("corrupt") || (page && recipe === "utf8-identity/1")
          ? 2
          : 0;
      await writeFile(
        join(directory, "result.json"),
        JSON.stringify(
          {
            recipe,
            variant,
            fragment,
            observed,
            args,
            pid: child.pid,
            exit: child.status,
            expectedExit,
            signal: child.signal,
            aliveAfter,
            before,
            after,
            report,
          },
          null,
          2,
        ),
      );
      context.diagnostic(`Retained fragment hash fixture ${directory}`);
      assert.equal(aliveAfter, false);
      assert.deepEqual(after, before);
      assert.equal(child.status, expectedExit, child.stdout);
      if (expectedExit === 0) {
        assert.equal(report.kind, "canonical");
        assert.equal(report.readiness.verification, "not-implemented");
      } else {
        assert.equal(report.kind, "unsupported");
        assert.ok(
          report.diagnostics.some(
            (finding: { code: string }) =>
              finding.code === "invalid-verification-binding",
          ),
        );
      }
    });
  }
