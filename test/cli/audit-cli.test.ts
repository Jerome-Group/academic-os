import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { Finding } from "../../src/conformance/index.js";
import { validModuleControls } from "../fixtures/module-controls.js";
import { universalPaths } from "../fixtures/universal-structure.js";

const cliPath = fileURLToPath(new URL("../../src/cli.js", import.meta.url));
const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

interface CliRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface JsonReport {
  schemaVersion: 1;
  module: { code: string; semester: string };
  outcome: "conformant" | "deviation" | "requires-decision";
  findings: Finding[];
}

async function runCli(...arguments_: string[]): Promise<CliRun> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...arguments_]);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? -1, stdout, stderr });
    });
  });
}

async function conformantModule(): Promise<{
  configPath: string;
  moduleRoot: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-cli-"));
  temporaryRoots.push(root);
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "State");
  const moduleRoot = join(driveMount, "Modules", "Y2S1", "MH2100");
  await mkdir(stateRoot, { recursive: true });
  await mkdir(moduleRoot, { recursive: true });
  const controls = validModuleControls();
  const controlContents = new Map<string, string>([
    ["00 Module Admin/00 Module Profile.md", controls.profile ?? ""],
    ["00 Module Admin/10 Module Definition.yaml", controls.definition ?? ""],
    [
      "00 Module Admin/20 Curation Register.jsonl",
      controls.curationRegister ?? "",
    ],
    ["AGENTS.md", controls.agents ?? ""],
    ["CLAUDE.md", controls.claude ?? ""],
    ["CONTEXT.md", controls.context ?? ""],
  ]);
  for (const [relativePath, kind] of universalPaths) {
    const path = join(moduleRoot, relativePath);
    if (kind === "directory") {
      await mkdir(path, { recursive: true });
    } else {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(
        path,
        controlContents.get(relativePath) ?? "synthetic fixture\n",
      );
    }
  }
  await mkdir(join(moduleRoot, "30 Assessments", "10 Quizzes"));
  const configPath = join(root, "academic-os.config.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        driveMount,
        stateRoot,
        semester: "Y2S1",
        module: "MH2100",
        semesterRoots: { Y2S1: "Modules/Y2S1" },
      },
      null,
      2,
    )}\n`,
  );
  return { configPath, moduleRoot };
}

describe("academic-os audit", () => {
  it("keeps human and JSON findings equivalent and assigns exit codes 0–3", async () => {
    const { configPath, moduleRoot } = await conformantModule();

    const human = await runCli("audit", "--config", configPath);
    const json = await runCli("audit", "--config", configPath, "--json");
    assert.equal(human.exitCode, 0);
    assert.equal(json.exitCode, 0);
    const report = JSON.parse(json.stdout) as JsonReport;
    assert.equal(report.schemaVersion, 1);
    assert.deepEqual(report.module, { code: "MH2100", semester: "Y2S1" });
    assert.equal(report.outcome, "conformant");
    const humanLines = human.stdout.split("\n");
    const humanFindingLines = humanLines.filter((line) => line.startsWith("["));
    assert.deepEqual(
      humanFindingLines,
      report.findings.map(
        ({ status, ruleId, path }) => `[${status}] ${ruleId} ${path}`,
      ),
    );
    assert.deepEqual(
      humanLines.filter((line) => line.startsWith("  Severity:")),
      report.findings.map(({ severity }) => `  Severity: ${severity}`),
    );
    assert.deepEqual(
      humanLines.filter((line) => line.startsWith("  Enforcement:")),
      report.findings.map(({ enforcement }) => `  Enforcement: ${enforcement}`),
    );
    for (const field of ["Evidence", "Explanation", "Applicability"] as const) {
      assert.deepEqual(
        humanLines.filter((line) => line.startsWith(`  ${field}:`)),
        report.findings.map(
          (finding) =>
            `  ${field}: ${finding[field.toLowerCase() as "evidence" | "explanation" | "applicability"]}`,
        ),
      );
    }

    const invalidCuratedPath = join(
      moduleRoot,
      "10 Learning Materials",
      "10 Lecture Materials",
      "lecture_1.PDF",
    );
    await writeFile(invalidCuratedPath, "synthetic fixture\n");
    const invalidName = await runCli("audit", "--config", configPath, "--json");
    assert.equal(invalidName.exitCode, 1);
    assert.equal(
      (JSON.parse(invalidName.stdout) as JsonReport).findings.some(
        ({ ruleId, path, enforcement }) =>
          ruleId === "MF-NAMING-002" &&
          path.endsWith("lecture_1.PDF") &&
          enforcement === "deterministic",
      ),
      true,
    );
    await rm(invalidCuratedPath);

    const definitionPath = join(
      moduleRoot,
      "00 Module Admin",
      "10 Module Definition.yaml",
    );
    await writeFile(
      definitionPath,
      (validModuleControls().definition ?? "").replace(
        "schema_version: 2",
        "schema_version: 3",
      ),
    );
    const futureControl = await runCli(
      "audit",
      "--config",
      configPath,
      "--json",
    );
    assert.equal(futureControl.exitCode, 1);
    assert.match(futureControl.stdout, /Unsupported schema_version 3/u);
    await writeFile(definitionPath, validModuleControls().definition ?? "");

    await rm(join(moduleRoot, "30 Assessments", "40 Finals"), {
      recursive: true,
    });
    const drift = await runCli("audit", "--config", configPath, "--json");
    assert.equal(drift.exitCode, 1);
    assert.equal((JSON.parse(drift.stdout) as JsonReport).outcome, "deviation");

    await mkdir(join(moduleRoot, "50 Field Work"));
    const decision = await runCli("audit", "--config", configPath, "--json");
    assert.equal(decision.exitCode, 3);
    assert.equal(
      (JSON.parse(decision.stdout) as JsonReport).outcome,
      "requires-decision",
    );

    const missingConfig = join(dirname(configPath), "missing.json");
    const operational = await runCli(
      "audit",
      "--config",
      missingConfig,
      "--json",
    );
    assert.equal(operational.exitCode, 2);
    assert.deepEqual(JSON.parse(operational.stdout), {
      schemaVersion: 1,
      outcome: "operational-failure",
      error: {
        code: "invalid-config",
        message: `Configuration cannot be read: ${missingConfig}.`,
      },
    });
  });
});
