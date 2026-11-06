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
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { isRecord } from "../../src/conformance/value-shape.js";
import {
  encodePublication,
  sha256,
} from "../../src/controls-publication/codec.js";
import type { HostInstallInput } from "../../src/controls-publication/generated/native-source-contract-1.js";
import {
  parseBytes,
  validateMixedEvent,
} from "../../src/controls-publication/schema.js";
import { publicationFixture } from "./fixtures.js";
import { bindFixtureRuntime } from "./runtime-fixture.js";

export const repository = resolve(".");
export const raw = (value: string) => Buffer.from(value).toString("base64");

export async function fixture(name: string) {
  const root = await mkdtemp(
    join(await realpath(tmpdir()), `native-policy-${name}-`),
  );
  await chmod(root, 0o700);
  const host = join(root, "host"),
    extracted = join(root, "extracted"),
    anchor = join(root, "anchor"),
    enclosure = join(root, "private"),
    source = join(enclosure, "snapshot"),
    config = join(root, "configuration.json");
  for (const path of [
    host,
    extracted,
    anchor,
    enclosure,
    source,
    join(root, "live"),
    join(root, "state"),
    join(root, "account"),
    join(root, "inputs"),
    join(host, "native"),
    join(extracted, "native"),
  ])
    await mkdir(path, { mode: 0o700 });
  const identityPath = join(root, "inputs/identity.json");
  await writeFile(identityPath, publicationFixture().identityBytes, {
    mode: 0o600,
  });
  await writeFile(
    config,
    JSON.stringify({
      schemaVersion: 1,
      driveMount: join(root, "live"),
      stateRoot: join(root, "state"),
    }),
    { mode: 0o600 },
  );
  const commands: object[] = [];
  function command(args: string[]) {
    const result = spawnSync(process.execPath, args, {
      cwd: repository,
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    });
    let alive = false;
    if (result.pid) {
      try {
        process.kill(result.pid, 0);
        alive = true;
      } catch {}
    }
    commands.push({
      args,
      status: result.status,
      signal: result.signal,
      pid: result.pid,
      aliveAfter: alive,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error?.message,
    });
    assert.equal(alive, false);
    return result;
  }
  const addon = join(host, "native/publication-native.node");
  const compiled = command([
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
  await symlink(join(repository, "node_modules"), join(host, "node_modules"));
  await writeFile(join(host, "package.json"), '{"type":"module"}\n');
  await copyFile(addon, join(extracted, "native/publication-native.node"));
  const checkpoint = join(root, "fault.json");
  const ledger = join(anchor, "academic-os-control-publication.jsonl");
  const loader = join(root, "fixture-loader.ts");
  await writeFile(
    loader,
    `import {createRequire} from 'node:module';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {isPublicationNative} from ${JSON.stringify(join(repository, "src/controls-publication/native/index.ts"))};
export function loadPublicationNative(){const value=createRequire(import.meta.url)('./native/publication-native.node');if(!isPublicationNative(value)||value.buildKind!=='fixture')throw Error('Fixture addon required');if(existsSync(${JSON.stringify(checkpoint)})){const fault=JSON.parse(readFileSync(${JSON.stringify(checkpoint)},'utf8'));let count=0;value.setFixtureCheckpoint((edge)=>{if(edge!==fault.edge)return;if(fault.kind){let last;try{last=JSON.parse(readFileSync(${JSON.stringify(ledger)},'utf8').trimEnd().split('\\n').at(-1));}catch{return;}if(last.record.kind!==fault.kind)return;}if(++count!==(fault.occurrence??1))return;writeFileSync(${JSON.stringify(join(root, "fault-hit.json"))},JSON.stringify({pid:process.pid,edge,kind:fault.kind}));if(fault.action==='kill')process.kill(process.pid,'SIGKILL');if(fault.action==='stop'){process.kill(process.pid,'SIGSTOP');return;}throw Error('Injected native policy interruption');});}return {kind:'ok',value};}
`,
  );
  for (const directory of [host, extracted]) {
    for (const [sourceFile, output] of [
      ["host-deployment.ts", "host-deployment.mjs"],
      ["standalone.ts", "publication.mjs"],
    ]) {
      await build({
        entryPoints: [
          join(repository, "src/controls-publication", sourceFile ?? ""),
        ],
        outfile: join(directory, output ?? ""),
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node24",
        banner: {
          js: 'import {createRequire as bundleRequire} from "node:module";const require=bundleRequire(import.meta.url);',
        },
        plugins: [
          {
            name: "fixture-only-account",
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
    const manifest: unknown = JSON.parse(
      await readFile("dist/src/controls-publication/release.json", "utf8"),
    );
    assert.ok(isRecord(manifest));
    await writeFile(
      join(directory, "release.json"),
      encodePublication({
        ...manifest,
        nativeDigest: sha256(await readFile(addon)),
      }),
    );
    await bindFixtureRuntime(directory, directory);
  }
  await copyFile(
    addon,
    join(host, "src/controls-publication/native/publication-native.node"),
  );
  await copyFile(
    join(host, "release.json"),
    join(host, "src/controls-publication/release.json"),
  );
  await writeFile(
    join(host, "src/controls-publication/native/index.js"),
    (await readFile(loader, "utf8"))
      .replace(
        join(repository, "src/controls-publication/native/index.ts"),
        join(repository, "dist/src/controls-publication/native/index.js"),
      )
      .replace("./native/publication-native.node", "./publication-native.node"),
  );
  await bindFixtureRuntime(host, join(host, "src/controls-publication"));
  const hostEntry = join(host, "src/controls-publication/host-deployment.js");
  const registrationInput = {
    requestId: "register-one",
    configurations: [raw(config)],
    repositories: [
      raw(host),
      raw(extracted),
      raw(repository),
      raw(join(host, "src/controls-publication")),
    ],
    expectedPriorRegistration: null,
  };
  let counter = 0;
  async function run(action: string, input: unknown, directory = host) {
    const inputPath = join(root, `input-${++counter}.json`);
    await writeFile(inputPath, JSON.stringify(input), { mode: 0o600 });
    const result = command([
      directory === host ? hostEntry : join(directory, "host-deployment.mjs"),
      action,
      action === "retry-native-source-policy" ? "--request" : "--input",
      action === "retry-native-source-policy" && typeof input === "string"
        ? input
        : inputPath,
    ]);
    let value: unknown;
    try {
      value = JSON.parse(result.stdout);
    } catch {
      if (result.signal !== null)
        value = { kind: "fixture-process-terminated", signal: result.signal };
      else if (result.status !== 0)
        value = {
          kind: "fixture-process-failed-before-adapter",
          status: result.status,
        };
      else
        throw new Error(
          `No structured result ${result.stdout} ${result.stderr}`,
        );
    }
    assert.ok(isRecord(value));
    await writeFile(
      join(root, "commands.json"),
      JSON.stringify(commands, null, 2),
    );
    return { ...result, value };
  }
  async function register() {
    const result = await run("register", registrationInput);
    assert.equal(result.status, 0, JSON.stringify(result.value));
    assert.equal(result.value.kind, "host-deployment-installed");
    assert.equal(typeof result.value.registrationDigest, "string");
    return result.value.registrationDigest;
  }
  async function request(
    requestId = "install-one",
    expectedPriorGeneration: string | null = null,
  ): Promise<HostInstallInput> {
    const registrationDigest = await register();
    assert.equal(typeof registrationDigest, "string");
    if (typeof registrationDigest !== "string")
      throw new Error("Missing registration digest.");
    return {
      requestId,
      deploymentRegistrationDigest: registrationDigest,
      expectedPriorGeneration,
      slots: [
        {
          sourceKey: "private-one",
          enclosureLocatorBase64: raw(enclosure),
          snapshotLocatorBase64: raw(source),
        },
      ],
    };
  }
  async function records() {
    return (await readFile(ledger, "utf8"))
      .trimEnd()
      .split("\n")
      .map((line) => parseBytes(Buffer.from(line), validateMixedEvent).record);
  }
  return {
    root,
    host,
    extracted,
    anchor,
    enclosure,
    source,
    config,
    ledger,
    checkpoint,
    commands,
    command,
    run,
    register,
    request,
    records,
    registrationInput,
    identityPath,
    hostEntry,
  };
}
