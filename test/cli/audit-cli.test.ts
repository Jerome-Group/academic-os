import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";

import type {
  Finding,
  InventoryProvenance,
} from "../../src/conformance/index.js";
import type { ObservationComparison } from "../../src/observation/index.js";
import type { HistoryDiagnostic } from "../../src/mounted/types.js";
import { validModuleControls } from "../fixtures/module-controls.js";
import { universalPaths } from "../fixtures/universal-structure.js";
import { runCli, runCliWithEnvironment } from "../support/run-cli.js";
import { recordBehaviorEvidence } from "../support/rule-evidence.js";

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

interface JsonReport {
  schemaVersion: 1;
  module: { code: string; semester: string };
  outcome: "conformant" | "deviation" | "requires-decision";
  findings: Finding[];
  comparison: ObservationComparison;
  historyDiagnostics: HistoryDiagnostic[];
  observation: {
    schemaVersion: 1;
    ruleSetVersion: 1;
    contractVersion: number | "unavailable";
    reportProvenance: {
      producer: "@jerome-group/academic-os";
      producerVersion: "0.1.0";
      reportSchemaVersion: 1;
      command: "audit";
    };
  };
  inventoryProvenance: InventoryProvenance;
}

function assertHumanEvidenceMatchesJson(
  human: string,
  report: JsonReport,
): void {
  for (const finding of report.findings) {
    assert.match(
      human,
      new RegExp(`\\[${finding.status}\\] ${finding.ruleId} `, "u"),
    );
    assert.equal(human.includes(`Evidence: ${finding.evidence}`), true);
    assert.equal(
      human.includes(`Applicability: ${finding.applicability}`),
      true,
    );
  }
}

async function conformantModule(): Promise<{
  configPath: string;
  moduleRoot: string;
  stateRoot: string;
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
  return { configPath, moduleRoot, stateRoot };
}

describe("academic-os audit", () => {
  it("keeps human and JSON findings equivalent and assigns exit codes 0–3 [MF-AUDIT-001]", async () => {
    const { configPath, moduleRoot } = await conformantModule();

    const human = await runCli("audit", "--config", configPath);
    const json = await runCli("audit", "--config", configPath, "--json");
    assert.equal(human.exitCode, 0);
    assert.equal(json.exitCode, 0);
    const report = JSON.parse(json.stdout) as JsonReport;
    assert.equal(report.schemaVersion, 1);
    assert.deepEqual(report.module, { code: "MH2100", semester: "Y2S1" });
    assert.equal(report.outcome, "conformant");
    assert.equal(report.inventoryProvenance.source, "mounted");
    assert.equal(report.inventoryProvenance.completeness, "complete");
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
    const repeatedFutureControl = await runCli(
      "audit",
      "--config",
      configPath,
      "--json",
    );
    const futureHuman = await runCli("audit", "--config", configPath);
    const repeatedFutureHuman = await runCli("audit", "--config", configPath);
    assert.equal(futureControl.exitCode, 1);
    assert.deepEqual(
      JSON.parse(repeatedFutureControl.stdout).findings,
      JSON.parse(futureControl.stdout).findings,
    );
    assert.equal(repeatedFutureHuman.stdout, futureHuman.stdout);
    assertHumanEvidenceMatchesJson(
      futureHuman.stdout,
      JSON.parse(futureControl.stdout),
    );
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
    const repeatedDecision = await runCli(
      "audit",
      "--config",
      configPath,
      "--json",
    );
    const decisionHuman = await runCli("audit", "--config", configPath);
    const repeatedDecisionHuman = await runCli("audit", "--config", configPath);
    assert.equal(decision.exitCode, 3);
    assert.deepEqual(
      JSON.parse(repeatedDecision.stdout).findings,
      JSON.parse(decision.stdout).findings,
    );
    assert.equal(repeatedDecisionHuman.stdout, decisionHuman.stdout);
    assertHumanEvidenceMatchesJson(
      decisionHuman.stdout,
      JSON.parse(decision.stdout),
    );
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

    const driveApiWithoutTarget = await runCli(
      "audit",
      "--config",
      configPath,
      "--inventory",
      "drive-api",
      "--json",
    );
    assert.equal(driveApiWithoutTarget.exitCode, 2);
    assert.deepEqual(JSON.parse(driveApiWithoutTarget.stdout), {
      schemaVersion: 1,
      outcome: "operational-failure",
      error: {
        code: "invalid-config",
        message:
          "Drive API inventory requires driveApi.moduleFolderId for MH2100.",
      },
    });

    const config = JSON.parse(await readFile(configPath, "utf8")) as Record<
      string,
      unknown
    >;
    config.driveApi = { moduleFolderId: "synthetic-folder-id" };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    const driveApiWithoutCredentials = await runCliWithEnvironment(
      {
        GOOGLE_APPLICATION_CREDENTIALS: join(
          dirname(configPath),
          "missing-credentials.json",
        ),
      },
      "audit",
      "--config",
      configPath,
      "--inventory",
      "drive-api",
      "--json",
    );
    assert.equal(driveApiWithoutCredentials.exitCode, 2);
    const credentialFailure = JSON.parse(driveApiWithoutCredentials.stdout) as {
      error: {
        code: string;
        message: string;
        inventoryProvenance: InventoryProvenance;
      };
    };
    assert.equal(credentialFailure.error.code, "unsafe-inventory");
    assert.match(
      credentialFailure.error.message,
      /^Drive API inventory is incomplete\./u,
    );
    assert.equal(
      credentialFailure.error.inventoryProvenance.source,
      "drive-api",
    );
    assert.equal(
      credentialFailure.error.inventoryProvenance.completeness,
      "partial",
    );
    recordBehaviorEvidence("MF-AUDIT-001", () => {
      assert.equal(report.findings.length > 0, true);
      assert.equal(humanFindingLines.length, report.findings.length);
    });
  });

  it("records and reports new, unchanged, resolved, and contract-version drift [MF-AUDIT-002]", async () => {
    const { configPath, moduleRoot, stateRoot } = await conformantModule();

    const first = await runCli("audit", "--config", configPath, "--json");
    const firstReport = JSON.parse(first.stdout) as JsonReport;
    assert.equal(firstReport.comparison.basis, "no-prior-observation");
    assert.deepEqual(
      firstReport.historyDiagnostics.map(({ kind }) => kind),
      ["missing-history"],
    );
    assert.deepEqual(firstReport.observation, {
      schemaVersion: 1,
      ruleSetVersion: 1,
      contractVersion: 3,
      reportProvenance: {
        producer: "@jerome-group/academic-os",
        producerVersion: "0.1.0",
        reportSchemaVersion: 1,
        command: "audit",
      },
    });

    const historyDirectories = await readdir(join(stateRoot, "observations"));
    assert.equal(historyDirectories.length, 1);
    const historyDirectory = join(
      stateRoot,
      "observations",
      historyDirectories[0] ?? "missing",
    );
    await writeFile(join(historyDirectory, "corrupt.json"), "{not json");

    const invalidPath = join(
      moduleRoot,
      "10 Learning Materials",
      "10 Lecture Materials",
      "lecture_1.PDF",
    );
    await writeFile(invalidPath, "synthetic fixture\n");
    const introduced = await runCli("audit", "--config", configPath);
    assert.match(introduced.stdout, /Comparison: compatible-observation/u);
    assert.match(introduced.stdout, /New findings: 1/u);
    assert.match(
      introduced.stdout,
      /History \[corrupt-history\] corrupt\.json:/u,
    );
    const introducedJson = await runCli(
      "audit",
      "--config",
      configPath,
      "--json",
    );
    const repeatedIntroducedJson = await runCli(
      "audit",
      "--config",
      configPath,
      "--json",
    );
    const unchangedHuman = await runCli("audit", "--config", configPath);
    const repeatedUnchangedHuman = await runCli(
      "audit",
      "--config",
      configPath,
    );
    assert.equal(repeatedIntroducedJson.stdout, introducedJson.stdout);
    assert.equal(repeatedUnchangedHuman.stdout, unchangedHuman.stdout);
    assertHumanEvidenceMatchesJson(
      unchangedHuman.stdout,
      JSON.parse(introducedJson.stdout),
    );

    await rm(invalidPath);
    const resolved = await runCli("audit", "--config", configPath, "--json");
    const resolvedReport = JSON.parse(resolved.stdout) as JsonReport;
    assert.equal(resolvedReport.comparison.resolved.length, 1);
    assert.equal(
      resolvedReport.comparison.resolved[0]?.path,
      "10 Learning Materials/10 Lecture Materials/lecture_1.PDF",
    );
    const settledJson = await runCli("audit", "--config", configPath, "--json");
    const repeatedSettledJson = await runCli(
      "audit",
      "--config",
      configPath,
      "--json",
    );
    const settledHuman = await runCli("audit", "--config", configPath);
    const repeatedSettledHuman = await runCli("audit", "--config", configPath);
    assert.equal(repeatedSettledJson.stdout, settledJson.stdout);
    assert.equal(repeatedSettledHuman.stdout, settledHuman.stdout);

    const definitionPath = join(
      moduleRoot,
      "00 Module Admin",
      "10 Module Definition.yaml",
    );
    await writeFile(
      definitionPath,
      (validModuleControls().definition ?? "").replace(
        "contract_version: 3",
        "contract_version: 4",
      ),
    );
    const changedContract = await runCli(
      "audit",
      "--config",
      configPath,
      "--json",
    );
    const changedReport = JSON.parse(changedContract.stdout) as JsonReport;
    assert.equal(changedReport.comparison.basis, "contract-version-changed");
    assert.deepEqual(changedReport.comparison.contractChange, {
      from: 3,
      to: 4,
    });
    assert.deepEqual(changedReport.comparison.new, []);
    assert.deepEqual(changedReport.comparison.resolved, []);
    recordBehaviorEvidence("MF-AUDIT-002", () => {
      assert.equal(changedReport.comparison.basis, "contract-version-changed");
    });
  });

  it("keeps new and resolved drift-transition evidence equivalent across human and JSON reports", async () => {
    const prepare = async () => {
      const fixture = await conformantModule();
      await runCli("audit", "--config", fixture.configPath, "--json");
      const invalidPath = join(
        fixture.moduleRoot,
        "10 Learning Materials",
        "10 Lecture Materials",
        "lecture_1.PDF",
      );
      await writeFile(invalidPath, "synthetic fixture\n");
      return { ...fixture, invalidPath };
    };
    const humanFixture = await prepare();
    const jsonFixture = await prepare();

    const introducedHuman = await runCli(
      "audit",
      "--config",
      humanFixture.configPath,
    );
    const introducedJson = await runCli(
      "audit",
      "--config",
      jsonFixture.configPath,
      "--json",
    );
    assert.equal(introducedHuman.exitCode, 1);
    assert.equal(introducedJson.exitCode, 1);
    assertHumanEvidenceMatchesJson(
      introducedHuman.stdout,
      JSON.parse(introducedJson.stdout),
    );

    await Promise.all([
      rm(humanFixture.invalidPath),
      rm(jsonFixture.invalidPath),
    ]);
    const resolvedHuman = await runCli(
      "audit",
      "--config",
      humanFixture.configPath,
    );
    const resolvedJson = await runCli(
      "audit",
      "--config",
      jsonFixture.configPath,
      "--json",
    );
    assert.equal(resolvedHuman.exitCode, 0);
    assert.equal(resolvedJson.exitCode, 0);
    assert.match(resolvedHuman.stdout, /Resolved findings: 1/u);
    const resolvedFinding = JSON.parse(resolvedJson.stdout).comparison
      .resolved[0];
    assert.equal(resolvedFinding !== undefined, true);
    for (const field of [
      "enforcement",
      "severity",
      "evidence",
      "explanation",
      "applicability",
    ]) {
      assert.equal(
        resolvedHuman.stdout.includes(
          `  Comparison ${field}: ${resolvedFinding[field]}`,
        ),
        true,
      );
    }
  });
});
