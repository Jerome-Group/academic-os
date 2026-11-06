import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { isRecord } from "../../src/conformance/value-shape.js";
import {
  digest,
  encodePublication,
  sha256,
} from "../../src/controls-publication/codec.js";
import {
  parseBytes,
  validateCreateResult,
  validateEvent,
  validateInspectResult,
  validatePublishResult,
} from "../../src/controls-publication/schema.js";
import { publicationFixture } from "./fixtures.js";
import { bindFixtureRuntime } from "./runtime-fixture.js";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

for (const placement of ["namespace", "catalog", "nested"] as const)
  it(`completes replayed ${placement} parent barriers before success and leaves inspect read-only`, {
    skip: process.platform !== "darwin",
    timeout: 60_000,
  }, async (context) => {
    const evidence = await mkdtemp(
      join(await realpath(tmpdir()), `publication-durability-${placement}-`),
    );
    await chmod(evidence, 0o700);
    context.diagnostic(`Retained durability fixture ${evidence}`);
    const anchor = join(evidence, "anchor"),
      host = join(evidence, "host"),
      inputs = join(evidence, "inputs"),
      ledger = join(anchor, "academic-os-control-publication.jsonl"),
      faultPath = join(evidence, "fault.json"),
      tracePath = join(evidence, "native.jsonl");
    for (const path of [anchor, host, inputs])
      await mkdir(path, { mode: 0o700 });
    const processes: object[] = [];
    function command(args: string[]) {
      const result = spawnSync(process.execPath, args, {
        cwd: repository,
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      let aliveAfter = false;
      if (result.pid !== undefined)
        try {
          process.kill(result.pid, 0);
          aliveAfter = true;
        } catch {}
      processes.push({ args, ...result, aliveAfter });
      assert.equal(aliveAfter, false);
      return result;
    }
    const cli = (args: string[]) =>
      command([join(host, "src/cli.js"), "controls", ...args]);
    async function trace(pid: number): Promise<Record<string, unknown>[]> {
      const rows = (await readFile(tracePath, "utf8"))
        .trimEnd()
        .split("\n")
        .map((line): unknown => JSON.parse(line));
      return rows.filter((row): row is Record<string, unknown> => {
        assert.ok(isRecord(row));
        return row.pid === pid;
      });
    }
    try {
      const addon = join(evidence, "fixture.node");
      const built = command([
        "scripts/build-control-publication-native.mjs",
        "--fixture-anchor",
        anchor,
        "--output",
        addon,
      ]);
      assert.equal(built.status, 0, built.stderr);
      await cp(join(repository, "dist/src"), join(host, "src"), {
        recursive: true,
      });
      await writeFile(join(host, "package.json"), '{"type":"module"}\n');
      await symlink(
        join(repository, "node_modules"),
        join(host, "node_modules"),
      );
      await cp(
        addon,
        join(host, "src/controls-publication/native/publication-native.node"),
      );
      const manifest: unknown = JSON.parse(
        await readFile(
          join(host, "src/controls-publication/release.json"),
          "utf8",
        ),
      );
      assert.ok(isRecord(manifest));
      manifest.nativeDigest = sha256(await readFile(addon));
      await writeFile(
        join(host, "src/controls-publication/release.json"),
        JSON.stringify(manifest),
      );
      await writeFile(
        join(host, "src/controls-publication/native/index.js"),
        `import { createRequire } from "node:module";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { isPublicationNative } from ${JSON.stringify(join(repository, "dist/src/controls-publication/native/index.js"))};
const log = row => appendFileSync(${JSON.stringify(tracePath)}, JSON.stringify({pid:process.pid,...row})+"\\n");
const fault = () => JSON.parse(readFileSync(${JSON.stringify(faultPath)}, "utf8"));
const last = () => JSON.parse(readFileSync(${JSON.stringify(ledger)}, "utf8").trimEnd().split("\\n").at(-1)).record;
export function loadPublicationNative() {
 const n = createRequire(import.meta.url)("./publication-native.node");
 if (!isPublicationNative(n) || n.buildKind !== "fixture") throw Error("Fixture native required.");
 let syncing;
 n.setFixtureCheckpoint(edge => {
  if (edge !== "before-directory-sync") return;
  const spec = fault();
  if (spec.mode === "off") return;
  const record = last();
  const matches = spec.target ? ["kind","volumeUuid","device","inode","birthtimeNs"].every(key => syncing[key] === spec.target[key]) : ${JSON.stringify(placement)} === "namespace" ? record.kind === "namespace-claimed" : record.kind === "directory-claimed" && Buffer.from(record.directory.location.rawNameBase64,"base64").toString() === ${JSON.stringify(placement === "catalog" ? "receipts" : "level-two")};
  if (!matches) return;
  log({method:"fault",edge,mode:spec.mode,object:syncing});
  writeFileSync(${JSON.stringify(join(evidence, "hit.json"))},JSON.stringify({pid:process.pid,edge,record,object:syncing}));
  if (spec.mode === "kill") process.kill(process.pid,"SIGKILL");
  throw Error("Injected native parent barrier failure.");
 });
 return {kind:"ok",value:{...n,
  beginIntervalUnderHeldGate(input){log({method:"beginIntervalUnderHeldGate"});return n.beginIntervalUnderHeldGate(input);},
  appendExact(input){log({method:"appendExact"});return n.appendExact(input);},
  syncFile(input){const result=n.syncFile(input);log({method:"syncFile",result});return result;},
  syncDirectory(input){const observed=n.observe(input.directory);if(observed.kind!=="ok")throw Error("Native directory observation failed.");syncing=observed.value.object;const result=n.syncDirectory(input);log({method:"syncDirectory",object:syncing,result});return result;}
 }};
}
`,
      );
      const fixture = publicationFixture();
      await bindFixtureRuntime(host, join(host, "src/controls-publication"));
      const identityPath = join(inputs, "identity.json");
      const bundlePath = join(inputs, "bundle.json");
      await writeFile(identityPath, fixture.identityBytes);
      const identity = fixture.bundle.controls.find(
        (control) => control.role === "module-identity",
      );
      assert.ok(identity);
      if (placement === "nested")
        identity.file = "level-one/level-two/module-identity.json";
      await writeFile(bundlePath, encodePublication(fixture.bundle));
      const create = [
        "create-generated-candidate",
        "--identity",
        identityPath,
        "--request",
        "create-durability",
      ];
      let candidateId = "candidate-pending";
      await writeFile(faultPath, JSON.stringify({ mode: "off" }));
      if (placement === "nested") {
        const created = cli(create);
        const result = parseBytes(
          Buffer.from(created.stdout),
          validateCreateResult,
        );
        assert.equal(result.kind, "created", created.stdout);
        if (result.kind !== "created") throw Error(created.stdout);
        candidateId = result.candidate.candidateId;
      }
      const publish = () => [
        "publish-generation",
        "--candidate",
        candidateId,
        "--bundle",
        bundlePath,
        "--request",
        "publish-durability",
        "--expect-absent",
      ];
      const retry = () => cli(placement === "nested" ? publish() : create);
      const parseResult = (stdout: string) =>
        placement === "nested"
          ? parseBytes(Buffer.from(stdout), validatePublishResult)
          : parseBytes(Buffer.from(stdout), validateCreateResult);
      await writeFile(faultPath, JSON.stringify({ mode: "kill" }));
      const killed = retry();
      assert.equal(killed.signal, "SIGKILL", killed.stdout + killed.stderr);
      const prefix = (await readFile(ledger, "utf8"))
        .trimEnd()
        .split("\n")
        .map((row) => parseBytes(Buffer.from(row), validateEvent).record);
      const claim = prefix.at(-1);
      assert.ok(
        claim?.kind === "namespace-claimed" ||
          claim?.kind === "directory-claimed",
      );
      const target =
        claim.kind === "namespace-claimed"
          ? claim.namespace.location.parent
          : claim.directory.location.parent;
      await writeFile(faultPath, JSON.stringify({ mode: "throw", target }));
      const inspect = async () => {
        const before = await readFile(ledger);
        const observed = cli(["inspect-candidate", "--candidate", candidateId]);
        parseBytes(Buffer.from(observed.stdout), validateInspectResult);
        assert.deepEqual(await readFile(ledger), before);
        assert.deepEqual(await trace(observed.pid), []);
      };
      await inspect();
      for (let attempt = 0; attempt < 2; attempt++) {
        const failed = retry();
        const result = parseResult(failed.stdout);
        const syncs = (await trace(failed.pid)).filter(
          (row) =>
            row.method === "syncDirectory" &&
            digest(row.object) === digest(target),
        );
        await writeFile(
          join(evidence, `retry-${attempt}.json`),
          JSON.stringify({ result, target, syncs }, null, 2),
        );
        assert.equal(result.kind, "recovery-required", failed.stdout);
        if (result.kind !== "recovery-required") throw Error(failed.stdout);
        assert.equal(result.code, "durability-unavailable");
        assert.ok(
          syncs.length > 0,
          "Replay must attempt the actual parent barrier.",
        );
        await inspect();
      }
      await writeFile(faultPath, JSON.stringify({ mode: "off" }));
      const retried = retry();
      const result = parseResult(retried.stdout);
      assert.equal(
        result.kind,
        placement === "nested" ? "published" : "created",
        retried.stdout,
      );
      const syncs = (await trace(retried.pid)).filter(
        (row) =>
          row.method === "syncDirectory" &&
          digest(row.object) === digest(target),
      );
      assert.ok(
        syncs.length > 0,
        "Successful replay must sync the claimed parent.",
      );
      for (const row of syncs) assert.deepEqual(row.result, { kind: "ok" });
      if (result.kind === "created") {
        candidateId = result.candidate.candidateId;
        const published = cli(publish());
        const outcome = parseBytes(
          Buffer.from(published.stdout),
          validatePublishResult,
        );
        assert.equal(outcome.kind, "published", published.stdout);
      }
      await inspect();
      await writeFile(
        join(evidence, "result.json"),
        JSON.stringify({ placement, target, retried: result, syncs }, null, 2),
      );
    } finally {
      await writeFile(
        join(evidence, "processes.json"),
        JSON.stringify(processes, null, 2),
      );
    }
  });
