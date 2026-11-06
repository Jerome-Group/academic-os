import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import {
  activityBytes,
  digest,
  encodeCanonicalJson,
  freezeBytes,
  sha256,
} from "../../src/controls/index.js";
import type {
  CloseoutPlan,
  Preparation,
} from "../../src/module-activity/generated/workflow.js";
import { bindFixtureRuntime } from "../controls-publication/runtime-fixture.js";
import {
  activityFixture,
  activityJudgment,
  activitySubmission,
} from "./fixtures.js";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export async function runModuleActivityJourney(
  parent = tmpdir(),
): Promise<string> {
  const evidence = await mkdtemp(
    join(await realpath(parent), "module-activity-"),
  );
  await chmod(evidence, 0o700);
  const anchor = join(evidence, "anchor"),
    host = join(evidence, "host"),
    inputs = join(evidence, "inputs");
  for (const directory of [anchor, host, inputs, join(evidence, "account")])
    await mkdir(directory, { mode: 0o700 });
  const commands: object[] = [];
  let sequence = 0;
  async function command(args: string[], expected: number | null = 0) {
    const result = spawnSync(process.execPath, args, {
      cwd: repository,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const prefix = join(
      evidence,
      `${String(++sequence).padStart(3, "0")}-command`,
    );
    await writeFile(`${prefix}.stdout`, result.stdout ?? "");
    await writeFile(`${prefix}.stderr`, result.stderr ?? "");
    let alive = false;
    if (result.pid)
      try {
        process.kill(result.pid, 0);
        alive = true;
      } catch {}
    commands.push({
      args,
      status: result.status,
      signal: result.signal,
      pid: result.pid,
      alive,
      stdout: `${prefix}.stdout`,
      stderr: `${prefix}.stderr`,
    });
    await writeFile(
      join(evidence, "processes.json"),
      JSON.stringify(commands, null, 2),
    );
    assert.equal(
      result.status,
      expected,
      `${result.stderr}\n${result.stdout.slice(0, 1200)}`,
    );
    assert.equal(alive, false);
    return result;
  }
  const fixture = activityFixture();
  const addon = join(host, "fixture.node");
  await command([
    "scripts/build-control-publication-native.mjs",
    "--fixture-anchor",
    anchor,
    "--output",
    addon,
  ]);
  await cp(join(repository, "dist/src"), join(host, "src"), {
    recursive: true,
  });
  await writeFile(join(host, "package.json"), '{"type":"module"}\n');
  await symlink(
    join(repository, "node_modules"),
    join(host, "node_modules"),
    "dir",
  );
  await copyFile(
    addon,
    join(host, "src/controls-publication/native/publication-native.node"),
  );
  const checkpoint = join(evidence, "checkpoint.json"),
    hit = join(evidence, "checkpoint-hit.json");
  await writeFile(
    join(host, "src/controls-publication/native/index.js"),
    `
import { createRequire } from "node:module";
import { existsSync,readFileSync,writeFileSync } from "node:fs";
import { isPublicationNative } from ${JSON.stringify(join(repository, "dist/src/controls-publication/native/index.js"))};
export function loadPublicationNative(){const value=createRequire(import.meta.url)("./publication-native.node");if(!isPublicationNative(value)||value.buildKind!=="fixture")throw new Error("Fixture addon required.");if(existsSync(${JSON.stringify(checkpoint)})){const spec=JSON.parse(readFileSync(${JSON.stringify(checkpoint)},"utf8"));value.setFixtureCheckpoint(edge=>{if(edge!==spec.edge)return;writeFileSync(${JSON.stringify(hit)},JSON.stringify({pid:process.pid,edge}));process.kill(process.pid,"SIGKILL");});}return {kind:"ok",value};}
`,
  );
  const manifest = JSON.parse(
    await readFile(
      join(repository, "dist/src/controls-publication/release.json"),
      "utf8",
    ),
  );
  manifest.nativeDigest = sha256(await readFile(addon));
  for (const target of ["controls-publication", "module-activity"])
    await writeFile(
      join(host, `src/${target}/release.json`),
      encodeCanonicalJson(manifest),
    );
  await writeFile(
    join(evidence, "source-release.json"),
    encodeCanonicalJson(manifest),
  );
  const cli = join(host, "src/cli.js");
  await bindFixtureRuntime(host, join(host, "src/controls-publication"));
  async function packet(name: string, value: unknown) {
    const path = join(inputs, `${name}.json`);
    await writeFile(path, encodeCanonicalJson(value));
    return path;
  }
  async function activity(action: string, value: unknown, expected = 0) {
    const input = await packet(`${action}-${sequence}`, value);
    const result = await command(
      [cli, "module", "activity", action, "--input", input, "--json"],
      expected,
    );
    return JSON.parse(result.stdout);
  }
  const identityPath = await packet("identity", fixture.identity);
  const created = JSON.parse(
    (
      await command([
        cli,
        "controls",
        "create-generated-candidate",
        "--identity",
        identityPath,
        "--request",
        "fixture-create",
        "--json",
      ])
    ).stdout,
  );
  assert.equal(created.kind, "created");
  const candidateId = created.candidate.candidateId;
  async function publish(
    bundle: unknown,
    request: string,
    head?: string,
    expected = 0,
  ) {
    const path = await packet(request, bundle);
    return JSON.parse(
      (
        await command(
          [
            cli,
            "controls",
            "publish-generation",
            "--candidate",
            candidateId,
            "--request",
            request,
            "--bundle",
            path,
            ...(head ? ["--expected-head", head] : ["--expect-absent"]),
            "--json",
          ],
          expected,
        )
      ).stdout,
    );
  }
  async function inspect(generation?: string, expected = 0) {
    return JSON.parse(
      (
        await command(
          [
            cli,
            "controls",
            "inspect-candidate",
            "--candidate",
            candidateId,
            ...(generation ? ["--generation", generation] : []),
            "--json",
          ],
          expected,
        )
      ).stdout,
    );
  }
  const baseline = structuredClone(fixture.bundle);
  function value(bundle: typeof fixture.bundle, role: string) {
    const binding = bundle.controls.find((c) => c.role === role);
    assert.ok(binding);
    return {
      binding,
      value: JSON.parse(Buffer.from(activityBytes(binding.bytes)).toString()),
    };
  }
  const workspace = value(baseline, "learning-workspace");
  delete workspace.value.activityProtocol;
  workspace.binding.bytes = freezeBytes(encodeCanonicalJson(workspace.value));
  const records = value(baseline, "learning-records");
  delete records.value.activityCloseouts;
  records.value.records.push({
    id: "learning-record:unknown-history",
    kind: "legacy-evidence",
    original: { kind: "evidence", id: "evidence:synthetic" },
    parsedTarget: { kind: "unknown", reason: "Historical target missing." },
    observedStatus: {
      kind: "unknown",
      reason: "Historical status missing.",
      evidence: [],
    },
    established: [],
    missing: ["target", "status"],
    supersedes: [],
    evidence: [{ kind: "evidence", id: "evidence:synthetic" }],
  });
  records.binding.bytes = freezeBytes(encodeCanonicalJson(records.value));
  const forbiddenInitial = structuredClone(baseline);
  const initialWorkspace = value(forbiddenInitial, "learning-workspace");
  initialWorkspace.value.activityProtocol = value(
    fixture.bundle,
    "learning-workspace",
  ).value.activityProtocol;
  initialWorkspace.binding.bytes = freezeBytes(
    encodeCanonicalJson(initialWorkspace.value),
  );
  const initialRecords = value(forbiddenInitial, "learning-records");
  initialRecords.value.activityCloseouts = [];
  initialRecords.binding.bytes = freezeBytes(
    encodeCanonicalJson(initialRecords.value),
  );
  const ledger = join(anchor, "academic-os-control-publication.jsonl");
  async function unchangedLedger(name: string, before: Uint8Array) {
    const after = await readFile(ledger);
    await writeFile(join(evidence, `${name}-before.jsonl`), before);
    await writeFile(join(evidence, `${name}-after.jsonl`), after);
    assert.deepEqual(
      after,
      before,
      `${name} leaves publication ledger unchanged`,
    );
  }
  const beforeInitialRefusal = await readFile(ledger);
  const initialRefusal = await publish(
    forbiddenInitial,
    "initial-history-bypass",
    undefined,
    2,
  );
  assert.equal(initialRefusal.code, "evidence-mismatch");
  assert.match(
    initialRefusal.evidence.join(" "),
    /Direct initial protocol enablement requires empty/,
  );
  await unchangedLedger("initial-refusal", beforeInitialRefusal);
  const h0 = await publish(baseline, "baseline");
  assert.equal(h0.kind, "published");
  const unavailable = await activity(
    "prepare",
    {
      candidateId,
      selection: { kind: "earliest-uncovered", activity: "revision" },
      requested: { kind: "official" },
    },
    2,
  );
  assert.equal(unavailable.kind, "unsupported");
  const adopted = structuredClone(baseline);
  const aw = value(adopted, "learning-workspace"),
    ar = value(adopted, "learning-records");
  aw.value.activityProtocol = value(
    fixture.bundle,
    "learning-workspace",
  ).value.activityProtocol;
  aw.binding.bytes = freezeBytes(encodeCanonicalJson(aw.value));
  ar.value.activityCloseouts = [];
  ar.binding.bytes = freezeBytes(encodeCanonicalJson(ar.value));
  const alteredAdoption = structuredClone(adopted);
  const alteredRecords = value(alteredAdoption, "learning-records");
  alteredRecords.value.records[0].parsedTarget.reason = "Rewritten history.";
  alteredRecords.binding.bytes = freezeBytes(
    encodeCanonicalJson(alteredRecords.value),
  );
  const beforeAdoptionRefusal = await readFile(ledger);
  const adoptionRefusal = await publish(
    alteredAdoption,
    "adopt-with-history-rewrite",
    h0.currentHead.head.byteSha256,
    2,
  );
  assert.equal(adoptionRefusal.code, "evidence-mismatch");
  assert.match(adoptionRefusal.evidence.join(" "), /cannot rewrite historical/);
  await unchangedLedger("adoption-refusal", beforeAdoptionRefusal);
  const h1 = await publish(adopted, "adopt", h0.currentHead.head.byteSha256);
  assert.equal(h1.kind, "published");
  const prepareRequest = {
    candidateId,
    selection: { kind: "earliest-uncovered", activity: "revision" },
    requested: { kind: "official" },
  };
  const a = await activity("prepare", prepareRequest);
  assert.equal(a.kind, "prepared");
  assert.equal(a.preparation.official.target.topics[0].id, "topic:one");
  const submissionA = activitySubmission(
    a.preparation as Preparation,
    "workflow-a",
  );
  const planA = await activity("submit", submissionA);
  assert.equal(planA.kind, "planned");
  const stale = await activity(
    "submit",
    activitySubmission(a.preparation as Preparation, "stale-b"),
  );
  assert.equal(stale.kind, "planned");
  const beforeFailureMatrix = await readFile(ledger);
  const locator = { evidenceId: "evidence:synthetic", locator: "extension" };
  for (const { input, code } of [
    {
      input: {
        ...prepareRequest,
        selection: { kind: "earliest-uncovered", activity: "lecture" },
      },
      code: "unsupported-native-source",
    },
    {
      input: {
        ...prepareRequest,
        selection: {
          kind: "exact",
          target: {
            kind: "revision",
            unit: { kind: "unit", id: "unit:foreign" },
            topics: [{ kind: "topic", id: "topic:one" }],
          },
        },
      },
      code: "foreign-target",
    },
    {
      input: {
        ...prepareRequest,
        selection: {
          kind: "exact",
          target: {
            kind: "revision",
            unit: { kind: "unit", id: "unit:one" },
            topics: [
              { kind: "topic", id: "topic:one" },
              { kind: "topic", id: "topic:two" },
            ],
          },
        },
      },
      code: "unsupported-procedure",
    },
    {
      input: {
        ...prepareRequest,
        sessionInstructions: [activityJudgment("scope-membership", digest({}))],
      },
      code: "preference-conflict",
    },
    {
      input: {
        ...prepareRequest,
        requested: {
          kind: "extension",
          official: "whole-target",
          additional: [locator, locator],
          request: activityJudgment("requested-extension", digest({})),
        },
      },
      code: "scope-ambiguous",
    },
  ]) {
    const refused = await activity("prepare", input, 2);
    assert.equal(refused.code, code);
  }
  for (const { input, code } of [
    {
      input: {
        ...submissionA,
        preparation: {
          ...submissionA.preparation,
          releaseDigest: "0".repeat(64),
        },
      },
      code: "release-conflict",
    },
    {
      input: {
        ...submissionA,
        supersedes: ["learning-record:missing"],
        supersessionJudgment: activityJudgment("supersession", digest({})),
      },
      code: "foreign-supersession",
    },
    {
      input: {
        ...submissionA,
        supersedes: ["learning-record:missing", "learning-record:missing"],
        supersessionJudgment: activityJudgment("supersession", digest({})),
      },
      code: "illegal-transition",
    },
  ]) {
    const refused = await activity("submit", input, 2);
    assert.equal(refused.code, code);
  }
  await unchangedLedger("failure-matrix", beforeFailureMatrix);

  const { createModuleActivityTools } = await import(
    pathToFileURL(join(host, "src/module-activity/actions.js")).href
  );
  const { createMcpDispatcher } = await import(
    pathToFileURL(join(host, "src/operations/dispatch-mcp-message.js")).href
  );
  const { startOperationsServer } = await import(
    pathToFileURL(join(host, "src/operations/serve-operations.js")).href
  );
  const server = await startOperationsServer({
    hosts: ["127.0.0.1"],
    port: 0,
    dispatch: createMcpDispatcher({
      tools: createModuleActivityTools({ exclusionPaths: [inputs] }),
      serverInfo: {
        name: "synthetic-activity",
        title: "Synthetic activity",
        version: "1",
      },
    }),
  });
  try {
    async function mcp(method: string, params?: unknown) {
      const request = {
        jsonrpc: "2.0",
        id: ++sequence,
        method,
        ...(params ? { params } : {}),
      };
      const response = await fetch(server.urls[0], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const bytes = await response.text();
      await writeFile(
        join(evidence, `${sequence}-mcp-request.json`),
        JSON.stringify(request),
      );
      await writeFile(join(evidence, `${sequence}-mcp-response.json`), bytes);
      assert.equal(response.status, 200);
      return JSON.parse(bytes);
    }
    const listing = await mcp("tools/list");
    assert.equal(
      listing.result.tools.filter(
        (t: { outputSchema?: unknown }) => t.outputSchema,
      ).length,
      3,
    );
    const beforeReadOnlyActions = await readFile(ledger);
    const mcpPreparation = await mcp("tools/call", {
      name: "module_activity_prepare",
      arguments: prepareRequest,
    });
    assert.equal(mcpPreparation.result.isError, false);
    assert.deepEqual(mcpPreparation.result.structuredContent, a);
    const unsupportedUnderstanding = activitySubmission(
      a.preparation as Preparation,
      "missing-understanding-attempt",
    );
    unsupportedUnderstanding.evidence.understanding = {
      kind: "agent-assessed",
      judgment: activityJudgment(
        "unaided-understanding",
        digest(a.preparation),
      ),
      attemptEvidenceId: "missing",
      independentReview: activityJudgment(
        "unaided-understanding",
        digest(a.preparation),
      ),
      scope: ["topic:one"],
      status: "unaided-demonstrated",
    };
    const understandingRefusal = await mcp("tools/call", {
      name: "module_activity_submit",
      arguments: unsupportedUnderstanding,
    });
    assert.equal(understandingRefusal.result.isError, true);
    assert.equal(
      understandingRefusal.result.structuredContent.code,
      "evidence-mismatch",
    );
    assert.match(
      understandingRefusal.result.structuredContent.evidence.join(" "),
      /understanding-evidence-missing/,
    );
    await unchangedLedger("read-only-actions", beforeReadOnlyActions);
    await writeFile(checkpoint, JSON.stringify({ edge: "after-head-rename" }));
    const closeAPath = await packet("close-a", { plan: planA.plan });
    const killed = await command(
      [cli, "module", "activity", "close", "--input", closeAPath, "--json"],
      null,
    );
    assert.equal(killed.signal, "SIGKILL");
    assert.equal(
      JSON.parse(await readFile(hit, "utf8")).edge,
      "after-head-rename",
    );
    await unlink(checkpoint);
    const pending = await inspect(undefined, 2);
    assert.equal(pending.kind, "recovery-required");
    const staleClose = await activity("close", { plan: stale.plan }, 2);
    assert.equal(staleClose.code, "stale-head");
    const settledA = await activity("close", { plan: planA.plan });
    assert.equal(settledA.kind, "published");
    assert.equal(settledA.replayed, true);
    const b = await activity("prepare", prepareRequest);
    assert.equal(b.preparation.official.target.topics[0].id, "topic:two");
    const bSubmission = activitySubmission(
      b.preparation as Preparation,
      "workflow-b",
    );
    const submittedB = await mcp("tools/call", {
      name: "module_activity_submit",
      arguments: bSubmission,
    });
    assert.equal(submittedB.result.structuredContent.kind, "planned");
    const bPlan = submittedB.result.structuredContent.plan as CloseoutPlan;
    const closedB = await mcp("tools/call", {
      name: "module_activity_close",
      arguments: { plan: bPlan },
    });
    assert.equal(closedB.result.structuredContent.kind, "published");
    const aAfterB = await activity("close", { plan: planA.plan });
    assert.equal(aAfterB.replayed, true);
    assert.deepEqual(aAfterB.logicalResult, settledA.logicalResult);
    assert.deepEqual(aAfterB.publication, settledA.publication);
    assert.equal(
      aAfterB.currentHead.headByteSha256,
      closedB.result.structuredContent.currentHead.headByteSha256,
    );
    const current = await inspect(),
      pinned = await inspect(settledA.publication.selectedGenerationId);
    const currentRecords = current.files.find((file: { path: string }) =>
      file.path.endsWith("/learning-records.json"),
    );
    assert.ok(currentRecords);
    const currentValue = JSON.parse(
      Buffer.from(currentRecords.bytes.bytesBase64, "base64").toString(),
    );
    assert.equal(currentValue.records.length, 3);
    assert.equal(currentValue.activityCloseouts.length, 2);
    assert.deepEqual(currentValue.records[0], records.value.records[0]);
    const beforeRawRefusals = await readFile(ledger);
    const invalidBundle = JSON.parse(
      Buffer.from(bPlan.bundleBytes.bytesBase64, "base64").toString(),
    );
    const rw = value(invalidBundle, "learning-workspace");
    delete rw.value.activityProtocol;
    rw.binding.bytes = freezeBytes(encodeCanonicalJson(rw.value));
    const rawRefused = await publish(
      invalidBundle,
      "raw-protocol-removal",
      current.currentHead.head.byteSha256,
      2,
    );
    assert.equal(rawRefused.code, "evidence-mismatch");
    const removedHistory = JSON.parse(
      Buffer.from(bPlan.bundleBytes.bytesBase64, "base64").toString(),
    );
    const removedRecords = value(removedHistory, "learning-records");
    removedRecords.value.records.shift();
    removedRecords.binding.bytes = freezeBytes(
      encodeCanonicalJson(removedRecords.value),
    );
    const historyRefused = await publish(
      removedHistory,
      "raw-history-removal",
      current.currentHead.head.byteSha256,
      2,
    );
    assert.equal(historyRefused.code, "evidence-mismatch");
    assert.match(historyRefused.evidence.join(" "), /Immutable records/);
    const forgedCheck = JSON.parse(
      Buffer.from(bPlan.bundleBytes.bytesBase64, "base64").toString(),
    );
    const forgedRecords = value(forgedCheck, "learning-records");
    forgedRecords.value.activityCloseouts.at(-1).logicalResult.checks[
      "selected-byte-closure"
    ].subjectDigest = "0".repeat(64);
    forgedRecords.binding.bytes = freezeBytes(
      encodeCanonicalJson(forgedRecords.value),
    );
    const forgedRefused = await publish(
      forgedCheck,
      "raw-check-forgery",
      current.currentHead.head.byteSha256,
      2,
    );
    assert.equal(forgedRefused.code, "evidence-mismatch");
    const unsupportedChange = JSON.parse(
      Buffer.from(bPlan.bundleBytes.bytesBase64, "base64").toString(),
    );
    const changedMap = value(unsupportedChange, "source-map");
    changedMap.value.units[0].label = "Unsupported standing change.";
    changedMap.binding.bytes = freezeBytes(
      encodeCanonicalJson(changedMap.value),
    );
    const effectRefusal = await publish(
      unsupportedChange,
      "raw-unsupported-effect",
      current.currentHead.head.byteSha256,
      2,
    );
    assert.equal(effectRefusal.code, "unsupported-effect");
    await unchangedLedger("raw-refusals", beforeRawRefusals);
    const limitPath = join(inputs, "oversized.json");
    await writeFile(limitPath, " ".repeat(8_388_609));
    const limitResult = JSON.parse(
      (
        await command(
          [cli, "module", "activity", "submit", "--input", limitPath, "--json"],
          2,
        )
      ).stdout,
    );
    assert.equal(limitResult.code, "invalid-packet");
    assert.match(limitResult.evidence.join(" "), /limit 8388608/);
    const malformed = await fetch(server.urls[0], {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125]),
    });
    assert.equal(malformed.status, 400);
    await writeFile(
      join(evidence, "malformed-mcp-response.json"),
      await malformed.text(),
    );
    const rebind = structuredClone(bSubmission);
    rebind.evidence.unresolved = ["Changed same-request meaning."];
    const rebindPlan = await activity("submit", rebind);
    assert.equal(rebindPlan.kind, "planned");
    const conflict = await activity("close", { plan: rebindPlan.plan }, 2);
    assert.equal(conflict.code, "request-conflict");
    const blockFixture = activityFixture(true);
    const blockIdentity = await packet("block-identity", blockFixture.identity);
    const blockCandidate = JSON.parse(
      (
        await command([
          cli,
          "controls",
          "create-generated-candidate",
          "--identity",
          blockIdentity,
          "--request",
          "fixture-block-create",
          "--json",
        ])
      ).stdout,
    );
    assert.equal(blockCandidate.kind, "created");
    const blockBundle = await packet("block-bundle", blockFixture.bundle);
    const blockPublished = JSON.parse(
      (
        await command([
          cli,
          "controls",
          "publish-generation",
          "--candidate",
          blockCandidate.candidate.candidateId,
          "--request",
          "block-baseline",
          "--bundle",
          blockBundle,
          "--expect-absent",
          "--json",
        ])
      ).stdout,
    );
    assert.equal(blockPublished.kind, "published");
    const beforeGroupingRefusal = await readFile(ledger);
    const grouping = await activity(
      "prepare",
      { ...prepareRequest, candidateId: blockCandidate.candidate.candidateId },
      2,
    );
    assert.equal(grouping.code, "grouping-required");
    await unchangedLedger("grouping-refusal", beforeGroupingRefusal);
    const extracted = join(evidence, "extracted-reader.mjs");
    await build({
      entryPoints: [join(repository, "src/controls/index.ts")],
      outfile: extracted,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node24",
      legalComments: "inline",
      banner: {
        js: 'import { createRequire } from "node:module"; const require=createRequire(import.meta.url);',
      },
    });
    const readerEntry = join(evidence, "read-extracted.mjs");
    await writeFile(
      readerEntry,
      `import {readFileSync} from "node:fs";import {readControls} from ${JSON.stringify(extracted)};const inspection=JSON.parse(readFileSync(process.argv[2],"utf8"));const result=readControls({moduleCode:inspection.candidate.aggregate.moduleCode,files:inspection.files.map(f=>({kind:"file",path:f.path,bytes:Buffer.from(f.bytes.bytesBase64,"base64")}))});process.stdout.write(JSON.stringify(result));if(result.coverage!=="validated-module-data")process.exitCode=2;`,
    );
    for (const [name, inspection] of [
      ["current", current],
      ["pinned", pinned],
    ] as const) {
      const path = await packet(`reader-${name}`, inspection);
      const read = await command([readerEntry, path]);
      const result = JSON.parse(read.stdout);
      assert.equal(result.coverage, "validated-module-data");
      await writeFile(join(evidence, `reader-${name}.json`), read.stdout);
    }
    await writeFile(
      join(evidence, "results.json"),
      JSON.stringify(
        {
          outcome: "passed",
          candidateId,
          selectedA: settledA.publication,
          currentB: aAfterB.currentHead,
          journeys: [
            "protocol-free unknown history",
            "adoption",
            "history-rewriting adoption refuses without plan append",
            "CLI prepare submit close",
            "HTTP MCP output schemas prepare submit close",
            "HTTP MCP understanding without attempt refuses without write",
            "public preparation and submission failure matrix without writes",
            "contiguous block requires explicit grouping",
            "coverage without unaided attempt",
            "selected-before-receipt kill",
            "pending A settles before stale B refusal",
            "completed A after B original receipt and logical replay",
            "raw protocol removal refusal",
            "raw history and check forgery refuse without plan append",
            "request rebinding refusal",
            "extracted current and pinned reader",
          ],
          releaseDigest: digest(manifest),
          extractedReaderSha256: sha256(await readFile(extracted)),
        },
        null,
        2,
      ),
    );
  } finally {
    await server.close();
    await writeFile(
      join(evidence, "teardown.json"),
      JSON.stringify({
        listenersClosed: true,
        childCommands: commands.length,
        sidecarsRead: false,
        fixturesRetained: true,
      }),
    );
  }
  return evidence;
}
