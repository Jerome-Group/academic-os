import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { build } from "esbuild";
import { isRecord } from "../../src/conformance/value-shape.js";
import {
  digest,
  encodePublication,
  sha256,
} from "../../src/controls-publication/codec.js";
import type { JournalEvent } from "../../src/controls-publication/generated/publication-contract-1.js";
import {
  parseBytes,
  validateCreateResult,
  validateEvent,
  validateInspectResult,
  validatePublishResult,
} from "../../src/controls-publication/schema.js";
import { publicationFixture } from "./fixtures.js";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export async function runPublicationJourney(
  evidenceParent = tmpdir(),
): Promise<string> {
  const evidence = await mkdtemp(
    join(await realpath(evidenceParent), "publication-journey-"),
  );
  await chmod(evidence, 0o700);
  const anchor = join(evidence, "anchor"),
    host = join(evidence, "host"),
    inputs = join(evidence, "inputs"),
    standalone = join(evidence, "extracted");
  for (const path of [
    anchor,
    host,
    inputs,
    standalone,
    join(evidence, "account"),
    join(host, "native"),
  ])
    await mkdir(path, { mode: 0o700 });
  const outcomes: object[] = [];
  function command(executable: string, args: string[], input?: string) {
    const result = spawnSync(executable, args, {
      cwd: repository,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
      ...(input === undefined ? {} : { input }),
    });
    outcomes.push({
      executable,
      args,
      status: result.status,
      pid: result.pid,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error?.message,
    });
    return result;
  }
  async function record(): Promise<void> {
    await writeFile(
      join(evidence, "processes.json"),
      JSON.stringify(outcomes, null, 2),
    );
  }
  try {
    const addon = join(host, "native/publication-native.node");
    const compiled = command(process.execPath, [
      "scripts/build-control-publication-native.mjs",
      "--fixture-anchor",
      anchor,
      "--output",
      addon,
    ]);
    assert.equal(compiled.status, 0, compiled.stderr);
    await cp(join(repository, "dist/src"), join(host, "src"), {
      recursive: true,
    });
    await writeFile(join(host, "package.json"), '{"type":"module"}');
    await symlink(
      join(repository, "node_modules"),
      join(host, "node_modules"),
      "dir",
    );
    await copyFile(
      addon,
      join(host, "src/controls-publication/native/publication-native.node"),
    );
    const checkpointPath = join(evidence, "checkpoint.json"),
      hitPath = join(evidence, "checkpoint-hit.json");
    async function stoppedCommand(
      args: string[],
      edge: string,
      whileStopped: () => Promise<void>,
      occurrence = 1,
    ) {
      await unlink(hitPath).catch((error: unknown) => {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          )
        )
          throw error;
      });
      await writeFile(
        checkpointPath,
        JSON.stringify({ edge, occurrence, mode: "stop" }),
      );
      const child = spawn(process.execPath, args, {
        cwd: repository,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      const completion = new Promise<{
        status: number | null;
        signal: NodeJS.Signals | null;
        stdout: string;
        stderr: string;
      }>((resolve) =>
        child.once("exit", (status, signal) => {
          outcomes.push({
            executable: process.execPath,
            args,
            pid: child.pid,
            status,
            signal,
            stdout,
            stderr,
          });
          resolve({ status, signal, stdout, stderr });
        }),
      );
      try {
        let hit = false;
        for (let count = 0; count < 500; count++) {
          try {
            const marker: unknown = JSON.parse(await readFile(hitPath, "utf8"));
            if (isRecord(marker) && marker.pid === child.pid) {
              hit = true;
              break;
            }
          } catch {}
          if (child.exitCode !== null || child.signalCode !== null) break;
          await new Promise<void>((resolve) => setTimeout(resolve, 20));
        }
        assert.ok(
          hit,
          `Stopped fixture checkpoint absent. ${stdout} ${stderr}`,
        );
        await copyFile(hitPath, join(evidence, `hit-stop-${edge}.json`));
        await whileStopped();
        child.kill("SIGCONT");
        return await completion;
      } finally {
        await unlink(checkpointPath);
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGCONT");
          child.kill("SIGKILL");
        }
        await completion;
      }
    }
    const checkpointCode = `
import { existsSync, readFileSync, writeFileSync } from "node:fs";
function configure(value) { if (!existsSync(${JSON.stringify(checkpointPath)})) return value; const spec=JSON.parse(readFileSync(${JSON.stringify(checkpointPath)},"utf8")); if(spec.failBegin) return {...value,beginIntervalUnderHeldGate(){return {kind:"native-failure",code:"io",operation:"fixture-begin-failure"};},close(handle){const result=value.close(handle);writeFileSync(${JSON.stringify(hitPath)},JSON.stringify({kind:"closed-anchor-after-failed-begin",result}));return result;}}; let count=0; value.setFixtureCheckpoint((edge) => { if(edge!==spec.edge) return; if(spec.recordKind) { let last; try { last=JSON.parse(readFileSync(${JSON.stringify(join(anchor, "academic-os-control-publication.jsonl"))},"utf8").trimEnd().split("\\n").at(-1)); } catch { return; } if(last.record.kind!==spec.recordKind) return; } if(++count!==(spec.occurrence ?? 1)) return; writeFileSync(${JSON.stringify(hitPath)},JSON.stringify({pid:process.pid,edge,count,mode:spec.mode})); if(spec.mode==="throw") throw new Error("Injected fixture barrier failure"); process.kill(process.pid,spec.mode==="stop"?"SIGSTOP":"SIGKILL"); }); return value; }
`;
    await writeFile(
      join(host, "src/controls-publication/native/index.js"),
      `import { createRequire } from "node:module";
import { isPublicationNative } from ${JSON.stringify(join(repository, "dist/src/controls-publication/native/index.js"))};
${checkpointCode}
export function loadPublicationNative() { const value = createRequire(import.meta.url)("./publication-native.node"); if (!isPublicationNative(value) || value.buildKind !== "fixture") throw new Error("Unsupported fixture addon."); return { kind: "ok", value:configure(value) }; }
`,
    );
    const loader = join(evidence, "fixture-loader.mjs");
    await writeFile(
      loader,
      `import { createRequire } from "node:module";
import { isPublicationNative } from ${JSON.stringify(join(repository, "src/controls-publication/native/index.ts"))};
${checkpointCode}
export function loadPublicationNative() { const value = createRequire(import.meta.url)("./native/publication-native.node"); if (!isPublicationNative(value) || value.buildKind !== "fixture") throw new Error("Unsupported fixture addon."); return { kind: "ok", value:configure(value) }; }
`,
    );
    const mcpEntry = join(evidence, "mcp-entry.mjs");
    await writeFile(
      mcpEntry,
      `import { readFileSync } from "node:fs";
import { createMcpDispatcher } from ${JSON.stringify(join(repository, "src/operations/dispatch-mcp-message.ts"))};
import { createPublicationTools } from ${JSON.stringify(join(repository, "src/controls-publication/tools.ts"))};
const dispatch = createMcpDispatcher({ tools:createPublicationTools(), serverInfo:{name:"publication-fixture",title:"Publication fixture",version:"1"} });
const response = await dispatch(JSON.parse(readFileSync(0,"utf8"))); process.stdout.write(JSON.stringify(response));
`,
    );
    for (const [entry, outfile] of [
      [mcpEntry, join(host, "mcp.mjs")],
      [
        join(repository, "src/controls-publication/standalone.ts"),
        join(host, "publication.mjs"),
      ],
    ]) {
      assert.ok(entry && outfile);
      await build({
        entryPoints: [entry],
        outfile,
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node24",
        legalComments: "inline",
        banner: {
          js: 'import { createRequire as publicationBundleCreateRequire } from "node:module"; const require = publicationBundleCreateRequire(import.meta.url);',
        },
        plugins: [
          {
            name: "fixture-only-native-loader",
            setup(plugin) {
              plugin.onResolve({ filter: /\.\/native\/index\.js$/ }, (args) =>
                args.importer.endsWith("/owner.ts")
                  ? { path: loader }
                  : undefined,
              );
            },
          },
        ],
      });
    }
    const productionManifest: unknown = JSON.parse(
      await readFile(
        join(repository, "dist/src/controls-publication/release.json"),
        "utf8",
      ),
    );
    assert.ok(isRecord(productionManifest));
    const manifest = {
      ...productionManifest,
      nativeDigest: sha256(await readFile(addon)),
    };
    await writeFile(join(host, "release.json"), encodePublication(manifest));
    await writeFile(
      join(host, "src/controls-publication/release.json"),
      encodePublication(manifest),
    );
    const archive = join(evidence, "standalone.tar.gz");
    assert.equal(
      command("/usr/bin/tar", [
        "-czf",
        archive,
        "-C",
        host,
        "publication.mjs",
        "release.json",
        "native/publication-native.node",
      ]).status,
      0,
    );
    assert.equal(
      command("/usr/bin/tar", ["-xzf", archive, "-C", standalone]).status,
      0,
    );
    assert.equal(
      digest(
        JSON.parse(await readFile(join(standalone, "release.json"), "utf8")),
      ),
      digest(manifest),
    );
    const a = publicationFixture("Synthetic generation A"),
      b = publicationFixture("Synthetic generation B");
    await writeFile(join(inputs, "identity.json"), a.identityBytes);
    await writeFile(join(inputs, "a.json"), a.bundleBytes);
    const cli = join(host, "src/cli.js");
    const absent = command(process.execPath, [
      join(standalone, "publication.mjs"),
      "inspect-candidate",
      "--candidate",
      "absent-candidate",
    ]);
    assert.equal(absent.status, 2, absent.stdout);
    assert.equal(
      parseBytes(Buffer.from(absent.stdout), validateInspectResult).kind,
      "refused",
    );
    assert.deepEqual(await readdir(anchor), []);
    const createArgs = [
      cli,
      "controls",
      "create-generated-candidate",
      "--request",
      "create-one",
      "--identity",
      join(inputs, "identity.json"),
      "--json",
    ];
    const created = await stoppedCommand(
      createArgs,
      "before-create-directory",
      async () => {
        const contender = command(process.execPath, createArgs);
        assert.equal(contender.status, 2, contender.stdout);
        const result = parseBytes(
          Buffer.from(contender.stdout),
          validateCreateResult,
        );
        assert.equal(result.kind, "refused");
        if (result.kind === "refused") assert.equal(result.code, "busy");
      },
    );
    assert.equal(created.status, 0, created.stdout + created.stderr);
    const creation = parseBytes(
      Buffer.from(created.stdout),
      validateCreateResult,
    );
    assert.equal(creation.kind, "created", created.stdout);
    if (creation.kind !== "created")
      throw new Error("Candidate creation failed.");
    const candidateId = creation.candidate.candidateId;
    const publishA = command(process.execPath, [
      cli,
      "controls",
      "publish-generation",
      "--candidate",
      candidateId,
      "--request",
      "publish-a",
      "--bundle",
      join(inputs, "a.json"),
      "--expect-absent",
      "--json",
    ]);
    assert.equal(publishA.status, 0, publishA.stdout + publishA.stderr);
    const resultA = parseBytes(
      Buffer.from(publishA.stdout),
      validatePublishResult,
    );
    if (resultA.kind !== "published") throw new Error(publishA.stdout);
    const toolsList = command(
      process.execPath,
      [join(host, "mcp.mjs")],
      JSON.stringify({ jsonrpc: "2.0", id: "tools", method: "tools/list" }),
    );
    assert.equal(toolsList.status, 0, toolsList.stderr);
    const listing: unknown = JSON.parse(toolsList.stdout);
    assert.ok(isRecord(listing));
    const listed = ListToolsResultSchema.parse(listing.result);
    assert.equal(listed.tools.length, 3);
    const publishB = command(
      process.execPath,
      [join(host, "mcp.mjs")],
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "controls_publish_generation",
          arguments: {
            candidateId,
            requestId: "publish-b",
            expectedHead: {
              kind: "digest",
              headByteSha256: resultA.receipt.selectedHead.head.byteSha256,
            },
            inputBytesBase64: Buffer.from(b.bundleBytes).toString("base64"),
          },
        },
      }),
    );
    assert.equal(publishB.status, 0, publishB.stderr);
    const response: unknown = JSON.parse(publishB.stdout);
    assert.ok(
      isRecord(response) &&
        isRecord(response.result) &&
        Array.isArray(response.result.content),
    );
    const text = response.result.content[0];
    assert.ok(isRecord(text) && typeof text.text === "string");
    const resultB = parseBytes(Buffer.from(text.text), validatePublishResult);
    assert.equal(resultB.kind, "published", text.text);
    if (resultB.kind !== "published") throw new Error(text.text);
    const current = command(process.execPath, [
      join(standalone, "publication.mjs"),
      "inspect-candidate",
      "--candidate",
      candidateId,
      "--json",
    ]);
    assert.equal(current.status, 0, current.stdout + current.stderr);
    const inspected = parseBytes(
      Buffer.from(current.stdout),
      validateInspectResult,
    );
    assert.equal(inspected.kind, "inspected", current.stdout);
    if (inspected.kind !== "inspected") throw new Error(current.stdout);
    assert.equal(
      inspected.selection.generationId,
      resultB.receipt.selectedHead.generationId,
    );
    const pinned = command(process.execPath, [
      join(standalone, "publication.mjs"),
      "inspect-candidate",
      "--candidate",
      candidateId,
      "--generation",
      resultA.receipt.selectedHead.generationId,
      "--json",
    ]);
    assert.equal(pinned.status, 0, pinned.stdout + pinned.stderr);
    const pin = parseBytes(Buffer.from(pinned.stdout), validateInspectResult);
    assert.equal(pin.kind, "inspected", pinned.stdout);
    if (pin.kind !== "inspected") throw new Error(pinned.stdout);
    assert.equal(
      pin.selection.generationId,
      resultA.receipt.selectedHead.generationId,
    );
    const replay = command(process.execPath, [
      cli,
      "controls",
      "publish-generation",
      "--candidate",
      candidateId,
      "--request",
      "publish-a",
      "--bundle",
      join(inputs, "a.json"),
      "--expect-absent",
      "--json",
    ]);
    assert.equal(replay.status, 0, replay.stdout + replay.stderr);
    const replayed = parseBytes(
      Buffer.from(replay.stdout),
      validatePublishResult,
    );
    assert.equal(replayed.kind, "published", replay.stdout);
    if (replayed.kind !== "published") throw new Error(replay.stdout);
    assert.equal(replayed.replayed, true);
    assert.equal(replayed.receipt.receiptId, resultA.receipt.receiptId);
    assert.equal(replayed.currentHead.kind, "selected");
    if (replayed.currentHead.kind !== "selected")
      throw new Error("Missing current head.");
    assert.equal(
      replayed.currentHead.generationId,
      resultB.receipt.selectedHead.generationId,
    );
    const root = join(
      anchor,
      "academic-os-control-publication/candidates",
      candidateId,
    );
    for (const receipt of [resultA.receipt, resultB.receipt])
      for (const file of receipt.manifest) {
        if (file.kind === "head" && receipt === resultA.receipt) continue;
        const bytes = await readFile(join(root, file.path));
        assert.equal(bytes.length, file.bytes.byteLength);
        assert.equal(
          createHash("sha256").update(bytes).digest("hex"),
          file.bytes.byteSha256,
        );
      }
    const ledger = join(anchor, "academic-os-control-publication.jsonl");
    const events = async (): Promise<JournalEvent[]> =>
      (await readFile(ledger, "utf8"))
        .trimEnd()
        .split("\n")
        .map((line) => parseBytes(Buffer.from(line), validateEvent));
    const publish = async (
      requestId: string,
      title: string,
      expected: string,
    ) => {
      const fixture = publicationFixture(title);
      const path = join(inputs, `${requestId}.json`);
      await writeFile(path, fixture.bundleBytes);
      return command(process.execPath, [
        cli,
        "controls",
        "publish-generation",
        "--candidate",
        candidateId,
        "--request",
        requestId,
        "--bundle",
        path,
        "--expected-head",
        expected,
        "--json",
      ]);
    };
    const ledgerBeforeNegatives = await readFile(ledger);
    const stale = command(process.execPath, [
      cli,
      "controls",
      "publish-generation",
      "--candidate",
      candidateId,
      "--request",
      "stale-request",
      "--bundle",
      join(inputs, "a.json"),
      "--expect-absent",
      "--json",
    ]);
    assert.equal(stale.status, 2, stale.stdout);
    const staleResult = parseBytes(
      Buffer.from(stale.stdout),
      validatePublishResult,
    );
    assert.equal(staleResult.kind, "refused");
    if (staleResult.kind === "refused")
      assert.equal(staleResult.code, "stale-head");
    const rebound = await publish(
      "publish-a",
      "Rebound request bytes",
      resultB.receipt.selectedHead.head.byteSha256,
    );
    assert.equal(rebound.status, 2, rebound.stdout);
    const reboundResult = parseBytes(
      Buffer.from(rebound.stdout),
      validatePublishResult,
    );
    assert.equal(reboundResult.kind, "refused");
    if (reboundResult.kind === "refused")
      assert.equal(reboundResult.code, "request-conflict");
    const large = await publish(
      "capacity-request",
      "X".repeat(1024 * 1024),
      resultB.receipt.selectedHead.head.byteSha256,
    );
    assert.equal(large.status, 2, large.stdout);
    const capacity = parseBytes(
      Buffer.from(large.stdout),
      validatePublishResult,
    );
    assert.equal(capacity.kind, "recovery-required", large.stdout);
    if (capacity.kind === "recovery-required")
      assert.equal(capacity.code, "durability-unavailable");
    assert.deepEqual(await readFile(ledger), ledgerBeforeNegatives);
    await writeFile(checkpointPath, JSON.stringify({ failBegin: true }));
    const beforeStoreFailure = await publish(
      "before-store-failure",
      "Failed interval closes its actual anchor",
      resultB.receipt.selectedHead.head.byteSha256,
    );
    assert.equal(beforeStoreFailure.status, 2, beforeStoreFailure.stdout);
    const cleanup: unknown = JSON.parse(await readFile(hitPath, "utf8"));
    assert.ok(
      isRecord(cleanup) &&
        cleanup.kind === "closed-anchor-after-failed-begin" &&
        isRecord(cleanup.result) &&
        cleanup.result.kind === "ok",
    );
    await copyFile(hitPath, join(evidence, "hit-before-store-cleanup.json"));
    await unlink(checkpointPath);
    assert.deepEqual(await readFile(ledger), ledgerBeforeNegatives);
    await writeFile(
      checkpointPath,
      JSON.stringify({ edge: "after-head-rename", mode: "kill" }),
    );
    const killed = await publish(
      "pending-c",
      "Selected C without a receipt",
      resultB.receipt.selectedHead.head.byteSha256,
    );
    assert.equal(killed.signal, "SIGKILL", killed.stdout + killed.stderr);
    await copyFile(hitPath, join(evidence, "hit-pending-c.json"));
    await unlink(checkpointPath);
    const pending = (await events()).find(
      (event) =>
        event.record.kind === "publication-intent" &&
        event.record.requestId === "pending-c",
    )?.record;
    assert.ok(pending?.kind === "publication-intent");
    const pendingLedger = await readFile(ledger);
    const refusedInspection = command(process.execPath, [
      join(standalone, "publication.mjs"),
      "inspect-candidate",
      "--candidate",
      candidateId,
    ]);
    assert.equal(refusedInspection.status, 2, refusedInspection.stdout);
    assert.equal(
      parseBytes(Buffer.from(refusedInspection.stdout), validateInspectResult)
        .kind,
      "recovery-required",
    );
    assert.deepEqual(await readFile(ledger), pendingLedger);
    const successor = await publish(
      "successor-d",
      "D after settlement of C",
      pending.receipt.selectedHead.head.byteSha256,
    );
    assert.equal(successor.status, 0, successor.stdout + successor.stderr);
    const d = parseBytes(Buffer.from(successor.stdout), validatePublishResult);
    if (d.kind !== "published") throw new Error(successor.stdout);
    const history = await events();
    const settledC = history.findIndex(
      (event) =>
        event.record.kind === "settled" &&
        event.record.requestId === "pending-c",
    );
    const planD = history.findIndex(
      (event) =>
        event.record.kind === "publication-plan" &&
        event.record.binding.requestId === "successor-d",
    );
    assert.ok(settledC >= 0 && settledC < planD);
    let expected = d.receipt.selectedHead.head.byteSha256;
    for (const [requestId, edge, occurrence, mode, recordKind] of [
      ["sync-failure", "before-file-sync", 1, "throw", "stage-reserved"],
      ["unclaimed-file", "after-create-regular", 1, "kill", null],
      ["promoted-generation", "after-exclusive-promote", 1, "kill", null],
      ["promoted-receipt", "after-exclusive-promote", 2, "kill", null],
    ] as const) {
      await writeFile(
        checkpointPath,
        JSON.stringify({ edge, occurrence, mode, recordKind }),
      );
      const failed = await publish(
        requestId,
        `Fault schedule ${requestId}`,
        expected,
      );
      await copyFile(hitPath, join(evidence, `hit-${requestId}.json`));
      if (mode === "kill")
        assert.equal(failed.signal, "SIGKILL", failed.stdout + failed.stderr);
      else {
        assert.equal(failed.status, 2, failed.stdout);
        const failure = parseBytes(
          Buffer.from(failed.stdout),
          validatePublishResult,
        );
        assert.equal(failure.kind, "recovery-required", failed.stdout);
        if (failure.kind === "recovery-required") {
          assert.equal(failure.code, "durability-unavailable");
          assert.equal(failure.requestId, requestId);
          assert.ok(failure.retainedPlanDigest);
        }
      }
      await unlink(checkpointPath);
      let retried = await publish(
        requestId,
        `Fault schedule ${requestId}`,
        expected,
      );
      if (retried.status !== 0 && requestId === "unclaimed-file")
        retried = await publish(
          requestId,
          `Fault schedule ${requestId}`,
          expected,
        );
      assert.equal(retried.status, 0, retried.stdout + retried.stderr);
      const restored = parseBytes(
        Buffer.from(retried.stdout),
        validatePublishResult,
      );
      if (restored.kind !== "published") throw new Error(retried.stdout);
      expected = restored.receipt.selectedHead.head.byteSha256;
    }
    assert.ok(
      (await events()).some(
        (event) =>
          event.record.kind === "orphan-attempt" &&
          event.record.requestId === "unclaimed-file",
      ),
    );
    const stoppedInput = join(inputs, "stopped-owner.json");
    await writeFile(
      stoppedInput,
      publicationFixture("Standalone owner stopped before selection")
        .bundleBytes,
    );
    const stopped = await stoppedCommand(
      [
        join(standalone, "publication.mjs"),
        "publish-generation",
        "--candidate",
        candidateId,
        "--request",
        "stopped-owner",
        "--bundle",
        stoppedInput,
        "--expected-head",
        expected,
      ],
      "before-head-rename",
      async () => {
        const before = await readFile(ledger);
        const contender = await publish(
          "stopped-contender",
          "Contender cannot enter held owner",
          expected,
        );
        assert.equal(contender.status, 2, contender.stdout);
        const result = parseBytes(
          Buffer.from(contender.stdout),
          validatePublishResult,
        );
        assert.equal(result.kind, "refused");
        if (result.kind === "refused") assert.equal(result.code, "busy");
        assert.deepEqual(await readFile(ledger), before);
      },
    );
    assert.equal(stopped.status, 0, stopped.stdout + stopped.stderr);
    const resumed = parseBytes(
      Buffer.from(stopped.stdout),
      validatePublishResult,
    );
    assert.equal(resumed.kind, "published", stopped.stdout);
    if (resumed.kind !== "published") throw new Error(stopped.stdout);
    expected = resumed.receipt.selectedHead.head.byteSha256;
    await writeFile(
      checkpointPath,
      JSON.stringify({
        edge: "after-create-directory",
        occurrence: 2,
        mode: "kill",
      }),
    );
    const interruptedCreateArgs = [
      cli,
      "controls",
      "create-generated-candidate",
      "--request",
      "create-intermediate",
      "--identity",
      join(inputs, "identity.json"),
      "--json",
    ];
    const interruptedCreate = command(process.execPath, interruptedCreateArgs);
    assert.equal(
      interruptedCreate.signal,
      "SIGKILL",
      interruptedCreate.stdout + interruptedCreate.stderr,
    );
    await copyFile(hitPath, join(evidence, "hit-create-intermediate.json"));
    await unlink(checkpointPath);
    const recoveredCreate = command(process.execPath, interruptedCreateArgs);
    assert.equal(
      recoveredCreate.status,
      0,
      recoveredCreate.stdout + recoveredCreate.stderr,
    );
    assert.equal(
      parseBytes(Buffer.from(recoveredCreate.stdout), validateCreateResult)
        .kind,
      "created",
    );
    assert.ok(
      (await events()).some(
        (event) =>
          event.record.kind === "orphan-attempt" &&
          event.record.requestId === "create-intermediate",
      ),
    );
    const originalRoot = join(evidence, "retained-original-root");
    const copiedRoot = join(evidence, "copied-root");
    await cp(root, copiedRoot, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    await rename(root, originalRoot);
    await rename(copiedRoot, root);
    const beforeReplaced = await readFile(ledger);
    const replaced = command(process.execPath, [
      cli,
      "controls",
      "publish-generation",
      "--candidate",
      candidateId,
      "--request",
      "publish-a",
      "--bundle",
      join(inputs, "a.json"),
      "--expect-absent",
    ]);
    assert.equal(replaced.status, 2, replaced.stdout);
    const replacementRefusal = parseBytes(
      Buffer.from(replaced.stdout),
      validatePublishResult,
    );
    assert.equal(replacementRefusal.kind, "refused", replaced.stdout);
    if (replacementRefusal.kind === "refused")
      assert.equal(replacementRefusal.code, "root-replaced");
    assert.deepEqual(await readFile(ledger), beforeReplaced);
    await rename(root, join(evidence, "foreign-root-retained"));
    await rename(originalRoot, root);
    const foreignInput = join(inputs, "foreign-generation.json");
    await writeFile(
      foreignInput,
      publicationFixture("Foreign byte-identical generation refuses adoption")
        .bundleBytes,
    );
    const foreign = await stoppedCommand(
      [
        cli,
        "controls",
        "publish-generation",
        "--candidate",
        candidateId,
        "--request",
        "foreign-generation",
        "--bundle",
        foreignInput,
        "--expected-head",
        expected,
      ],
      "before-exclusive-promote",
      async () => {
        const plan = (await events()).find(
          (event) =>
            event.record.kind === "publication-plan" &&
            event.record.binding.requestId === "foreign-generation",
        )?.record;
        const stage = (await events()).find(
          (event) =>
            event.record.kind === "stage-claimed" &&
            event.record.requestId === "foreign-generation",
        )?.record;
        assert.ok(
          plan?.kind === "publication-plan" && stage?.kind === "stage-claimed",
        );
        await cp(
          join(
            anchor,
            "academic-os-control-publication/staging",
            stage.attemptId,
          ),
          join(root, ".academic-os/control-generations", plan.generationId),
          { recursive: true, force: false, errorOnExist: true },
        );
      },
    );
    assert.equal(foreign.status, 2, foreign.stdout);
    const foreignRefusal = parseBytes(
      Buffer.from(foreign.stdout),
      validatePublishResult,
    );
    assert.equal(foreignRefusal.kind, "refused", foreign.stdout);
    if (foreignRefusal.kind === "refused")
      assert.equal(foreignRefusal.code, "unowned-output");
    await writeFile(
      join(evidence, "result.json"),
      JSON.stringify(
        {
          candidateId,
          resultA,
          resultB,
          replayed,
          inspected,
          pin,
          settledPredecessorBeforeSuccessor: true,
          faultSchedules: 5,
          concurrentBootstrapAndStoppedStandaloneGate: true,
          ledgerBytesAfterAAndB: ledgerBeforeNegatives.byteLength,
          ledgerBytesAfterFaults: (await readFile(ledger)).byteLength,
          releaseDigest: digest(manifest),
          complete: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await record();
  }
  return evidence;
}
