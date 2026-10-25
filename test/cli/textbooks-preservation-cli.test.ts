import assert from "node:assert/strict";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { Document } from "yaml";

import { shelfReviewSheetPath } from "../../src/textbooks/index.js";
import { runCli, runCliWithEnvironment } from "../support/run-cli.js";
import {
  compileShelfInterposer,
  latestShelfRun,
  releaseShelfBarrier,
  shelfProcessFixture,
  waitShelfBarrier,
  type ShelfProcessFixture,
} from "../support/shelf-process-fixture.js";

const fixtures: ShelfProcessFixture[] = [];
afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((f) => rm(f.root, { recursive: true, force: true })),
  );
});

describe("Shelf CLI preservation and recovery", () => {
  for (const command of ["catch-up", "migrate"]) {
    for (const json of [true, false]) {
      it(`${command} reports partial publication and exits nonzero in ${json ? "JSON" : "human"} output`, async () => {
        const f = await shelfProcessFixture({
          existingIndex: true,
          migration: command === "migrate",
        });
        fixtures.push(f);
        const config = join(f.root, "config.json");
        await writeFile(
          config,
          JSON.stringify({
            driveMount: f.driveMount,
            stateRoot: f.stateRoot,
            textbooks: { shelfRoot: "shelf" },
          }),
        );
        if (command === "migrate") {
          const request = JSON.parse(await readFile(f.request, "utf8"));
          await mkdir(join(f.stateRoot, "textbooks"));
          await writeFile(
            shelfReviewSheetPath(f.stateRoot),
            new Document({
              schemaVersion: 1,
              shelf: await realpath(f.shelfRoot),
              books: request.review.books,
            }).toString(),
          );
        }
        const library = await compileShelfInterposer(f.root);
        const running = runCliWithEnvironment(
          {
            NODE_OPTIONS: `--import=${f.preload}`,
            SHELF_TEST_CONTROL: f.control,
            SHELF_TEST_TARGET: "00 Index.yaml",
            SHELF_TEST_INTERPOSER: library,
          },
          "textbooks",
          command,
          "--config",
          config,
          "--apply",
          ...(json ? ["--json"] : []),
        );
        await waitShelfBarrier(f);
        await writeFile(
          join(f.shelfRoot, "00 Index.yaml"),
          "late: cli-preserved\nbooks: {}\n",
        );
        await releaseShelfBarrier(f);
        const result = await running;
        assert.equal(result.exitCode, 2, result.stderr);
        if (json) {
          const report = JSON.parse(result.stdout);
          assert.equal(report.outcome, "partial");
          assert.equal(report.index, "published-unconfirmed");
          assert.match(
            await readFile(report.mutation.captures[0], "utf8"),
            /late: cli-preserved/u,
          );
        } else {
          assert.match(result.stdout, /: partial\n/u);
          assert.match(result.stdout, /Index: published-unconfirmed/u);
          assert.match(result.stdout, /Retained index capture\/proposal:/u);
          assert.match(result.stdout, /Recovery:/u);
        }
        const run = await latestShelfRun(f);
        const reconciled = await runCli(
          "textbooks",
          "reconcile",
          "--config",
          config,
          "--run",
          run.runId,
          "--json",
        );
        assert.equal(reconciled.exitCode, 2, reconciled.stderr);
        assert.equal(JSON.parse(reconciled.stdout).state, "partial");
        assert.equal(JSON.parse(reconciled.stdout).runId, run.runId);
        assert.match(
          JSON.stringify(JSON.parse(reconciled.stdout).paths),
          /academic-os-shelf-index/u,
        );
      });
    }
  }
});
