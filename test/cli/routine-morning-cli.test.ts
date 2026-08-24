import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { runCli } from "../support/run-cli.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function configFile(contents: Record<string, unknown>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-routine-cli-"));
  temporaryRoots.push(root);
  const path = join(root, "config.json");
  await writeFile(path, JSON.stringify(contents));
  return path;
}

describe("academic-os routine morning", () => {
  it("states its usage when no config is named", async () => {
    const result = await runCli("routine", "morning", "--json");

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.equal(JSON.parse(result.stdout).error.code, "invalid-arguments");
  });

  it("requires the cohort configuration", async () => {
    const path = await configFile({
      driveMount: "/drive",
      stateRoot: "/state",
      semester: "Y2S1",
      module: "AB1234",
    });

    const result = await runCli(
      "routine",
      "morning",
      "--config",
      path,
      "--json",
    );

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    const { error } = JSON.parse(result.stdout);
    assert.equal(error.code, "invalid-config");
    assert.match(error.message, /cohort configuration/u);
  });

  it("requires the paths of the tools it runs at 06:00", async () => {
    const path = await configFile({
      driveMount: "/drive",
      stateRoot: "/state",
      activeSemester: "Y2S1",
      semesters: {
        Y2S1: { root: "Y2S1", status: "active", modules: ["AB1234"] },
      },
    });

    const result = await runCli(
      "routine",
      "morning",
      "--config",
      path,
      "--json",
    );

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    const { error } = JSON.parse(result.stdout);
    assert.equal(error.code, "invalid-config");
    assert.match(error.message, /routine configuration/u);
  });
});
