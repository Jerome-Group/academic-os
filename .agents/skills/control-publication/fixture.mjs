import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  symlink,
  writeFile,
  unlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { build, transform } from "esbuild";

export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export async function makeFixture(root, _parent, name, mutate) {
  const evidence = await mkdtemp(join(await realpath(tmpdir()), `${name}-`));
  await chmod(evidence, 0o700);
  const source = join(evidence, "source"),
    host = join(evidence, "host"),
    anchor = join(evidence, "anchor");
  for (const directory of [
    source,
    host,
    anchor,
    join(evidence, "inputs"),
    join(evidence, "account"),
    join(host, "native"),
  ])
    await mkdir(directory, { mode: 0o700 });
  await cp(join(root, "src"), join(source, "src"), { recursive: true });
  await cp(join(root, "scripts"), join(source, "scripts"), { recursive: true });
  await cp(join(root, "package.json"), join(source, "package.json"));
  await symlink(
    join(root, "node_modules"),
    join(source, "node_modules"),
    "dir",
  );
  await cp(join(root, "dist/src"), join(host, "src"), { recursive: true });
  await cp(join(root, "package.json"), join(host, "package.json"));
  await symlink(join(root, "node_modules"), join(host, "node_modules"), "dir");
  const patches = [];
  const replace = async (file, from, to) => {
    const path = join(source, file),
      original = await readFile(path, "utf8");
    assert.equal(
      original.split(from).length,
      2,
      `One mutation site in ${file}`,
    );
    await writeFile(path, original.replace(from, to));
    const index = patches.length;
    const patch = {
      file,
      from,
      to,
      originalSha256: hash(original),
      changedSha256: hash(original.replace(from, to)),
      snapshot: join(evidence, "mutant-sources", String(index), file),
    };
    await mkdir(dirname(patch.snapshot), { recursive: true, mode: 0o700 });
    await cp(path, patch.snapshot);
    const diff = spawnSync(
      "git",
      ["diff", "--no-index", "--", join(root, file), path],
      { encoding: "utf8" },
    );
    assert.equal(diff.status, 1, "Product mutation has a real source diff");
    await writeFile(join(evidence, `mutation-${index}.patch`), diff.stdout);
    patches.push(patch);
  };
  if (mutate) await mutate(replace);
  for (const patch of patches.filter((patch) => patch.file.endsWith(".ts"))) {
    const compiled = await transform(
      await readFile(join(source, patch.file), "utf8"),
      { loader: "ts", format: "esm", target: "node24" },
    );
    await writeFile(
      join(host, patch.file.replace(/\.ts$/, ".js")),
      compiled.code,
    );
  }
  await writeFile(
    join(evidence, "mutation.json"),
    JSON.stringify(patches, null, 2),
  );
  const commands = [];
  function command(executable, args, input) {
    const started = new Date().toISOString();
    const result = spawnSync(executable, args, {
      cwd: source,
      input,
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const entry = {
      executable,
      args,
      cwd: source,
      started,
      ended: new Date().toISOString(),
      pid: result.pid,
      status: result.status,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error?.message,
      aliveAfter: alive(result.pid),
    };
    commands.push(entry);
    return entry;
  }
  const addon = join(host, "native/publication-native.node");
  const compiled = command(process.execPath, [
    join(source, "scripts/build-control-publication-native.mjs"),
    "--fixture-anchor",
    anchor,
    "--output",
    addon,
  ]);
  assert.equal(compiled.status, 0, compiled.stderr);
  await cp(
    addon,
    join(host, "src/controls-publication/native/publication-native.node"),
  );
  const config = join(evidence, "fault.json"),
    hit = join(evidence, "hit.json"),
    trace = join(evidence, "trace.jsonl");
  const loader = join(evidence, "loader.mjs");
  await writeFile(
    loader,
    `import { createRequire } from "node:module";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { isPublicationNative } from ${JSON.stringify(join(source, "src/controls-publication/native/index.ts"))};
const configPath=${JSON.stringify(config)}, tracePath=${JSON.stringify(trace)}, hitPath=${JSON.stringify(hit)};
export function loadPublicationNative() {
  const native=createRequire(import.meta.url)(${JSON.stringify(addon)});
  if(!isPublicationNative(native)||native.buildKind!=="fixture") throw new Error("Invalid fixed-anchor fixture native");
  const spec=existsSync(configPath)?JSON.parse(readFileSync(configPath,"utf8")):null;
  let operation="load", recordKind="none", count=0, fired=false, directoryObject=null, observing=false;
  const checkpoint=(edge, result)=>{
    if(observing) return;
    const key=operation+"|"+edge+"|"+recordKind;
    if(spec?.trace) appendFileSync(tracePath,JSON.stringify({pid:process.pid,key,operation,edge,recordKind,result,directoryObject})+"\\n");
    if(!spec||fired||key!==spec.key||++count!==(spec.occurrence??1)) return;
    fired=true; writeFileSync(hitPath,JSON.stringify({pid:process.pid,key,count,mode:spec.mode}));
    if(spec.mode==="throw") throw new Error("Injected publication boundary failure "+key);
    process.kill(process.pid,spec.mode==="stop"?"SIGSTOP":"SIGKILL");
  };
  native.setFixtureCheckpoint(edge=>checkpoint(edge));
  const wrapped={};
  for(const key of Reflect.ownKeys(native)) {
    const value=native[key];
    wrapped[key]=typeof value!=="function"||key==="setFixtureCheckpoint"?value:(...args)=>{
      operation=key;
      directoryObject=null;
      if(key==="syncDirectory") { observing=true; try { const observed=native.observe(args[0].directory); if(observed.kind==="ok")directoryObject=observed.value.object; } finally { observing=false; } }
      if(key==="appendExact") { try { recordKind=JSON.parse(Buffer.from(args[0].bytes).toString("utf8")).record.kind; } catch {} }
      checkpoint("before-call"); const result=value(...args); checkpoint("after-call",{kind:result?.kind,code:result?.code}); return result;
    };
  }
  return {kind:"ok",value:wrapped};
}
`,
  );
  await writeFile(
    join(host, "src/controls-publication/native/index.js"),
    (await readFile(loader, "utf8")).replace(
      JSON.stringify(join(source, "src/controls-publication/native/index.ts")),
      JSON.stringify(
        join(root, "dist/src/controls-publication/native/index.js"),
      ),
    ),
  );
  const mcpEntry = join(evidence, "mcp-entry.mjs");
  await writeFile(
    mcpEntry,
    `import { readFileSync } from "node:fs";
import { createMcpDispatcher } from ${JSON.stringify(join(source, "src/operations/dispatch-mcp-message.ts"))};
import { createPublicationTools } from ${JSON.stringify(join(source, "src/controls-publication/tools.ts"))};
const dispatch=createMcpDispatcher({tools:createPublicationTools(),serverInfo:{name:"formal-fixture",title:"Formal fixture",version:"1"}});
process.stdout.write(JSON.stringify(await dispatch(JSON.parse(readFileSync(0,"utf8")))));
`,
  );
  for (const [entry, name] of [
    [join(source, "src/controls-publication/standalone.ts"), "publication.mjs"],
    [
      join(source, "src/controls-publication/host-deployment.ts"),
      "host-deployment.mjs",
    ],
    [mcpEntry, "mcp.mjs"],
  ]) {
    await build({
      entryPoints: [entry],
      outfile: join(host, name),
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node24",
      banner: {
        js: 'import { createRequire as fixtureRequire } from "node:module"; const require=fixtureRequire(import.meta.url);',
      },
      plugins: [
        {
          name: "fixed-anchor-only",
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
  const manifest = JSON.parse(
    await readFile(
      join(root, "dist/src/controls-publication/release.json"),
      "utf8",
    ),
  );
  manifest.nativeDigest = hash(await readFile(addon));
  await writeFile(join(host, "release.json"), JSON.stringify(manifest));
  await writeFile(
    join(host, "src/controls-publication/release.json"),
    JSON.stringify(manifest),
  );
  const { installedRuntimeDependencyFiles } = await import(
    pathToFileURL(
      join(root, "dist/src/controls-publication/runtime-dependencies.js"),
    ).href
  );
  let bindingIndex = 0;
  const bindFixtureRuntime = async (installation, moduleDirectory) => {
    await copyFile(
      join(root, "package-lock.json"),
      join(installation, "package-lock.json"),
    );
    if (installation !== moduleDirectory) {
      await copyFile(
        join(root, "package.json"),
        join(installation, "package.json"),
      );
      const modules = join(installation, "node_modules");
      if (
        await lstat(modules).then(
          (value) => value.isSymbolicLink(),
          () => false,
        )
      )
        await unlink(modules);
      for (const file of await installedRuntimeDependencyFiles(root)) {
        await mkdir(dirname(join(installation, file)), {
          recursive: true,
          mode: 0o700,
        });
        await copyFile(join(root, file), join(installation, file));
      }
    } else
      for (const [source, target] of [
        ["scan.native", "inventory-scan.native"],
        ["scan.c", "inventory-scan.c"],
        ["scan-core.c", "inventory-scan-core.c"],
        ["scan-core.h", "inventory-scan-core.h"],
      ])
        await copyFile(
          join(root, "dist/src/migration/native-inventory/native", source),
          join(installation, "native", target),
        );
    const args = [
      join(root, "scripts/build-control-publication-integrity.mjs"),
      installation,
      moduleDirectory,
    ];
    const started = new Date().toISOString();
    const built = spawnSync(process.execPath, args, {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
    });
    const record = {
      executable: process.execPath,
      args,
      cwd: root,
      started,
      ended: new Date().toISOString(),
      pid: built.pid,
      status: built.status,
      signal: built.signal,
      stdout: built.stdout,
      stderr: built.stderr,
      error: built.error?.message,
      aliveAfter: alive(built.pid),
    };
    commands.push(record);
    const retained = join(evidence, `runtime-binding-${bindingIndex++}.json`);
    await writeFile(retained, JSON.stringify(record, null, 2));
    await writeFile(
      join(evidence, "commands.json"),
      JSON.stringify(commands, null, 2),
    );
    if (built.status === 0) {
      const bytes = await readFile(
        join(moduleDirectory, "runtime-integrity.json"),
      );
      record.integritySnapshot = join(
        evidence,
        `runtime-integrity-${bindingIndex - 1}.json`,
      );
      record.integritySha256 = hash(bytes);
      await writeFile(record.integritySnapshot, bytes);
      await writeFile(retained, JSON.stringify(record, null, 2));
      await writeFile(
        join(evidence, "commands.json"),
        JSON.stringify(commands, null, 2),
      );
    }
    await writeFile(
      join(moduleDirectory, "runtime-binding-build.json"),
      JSON.stringify({ ...record, retained }, null, 2),
    );
    assert.equal(built.status, 0, built.stdout + built.stderr);
  };
  await bindFixtureRuntime(host, host);
  await bindFixtureRuntime(host, join(host, "src/controls-publication"));
  const fixtureModule = await import(
    pathToFileURL(join(root, "dist/test/controls-publication/fixtures.js")).href
  );
  const sample = fixtureModule.publicationFixture;
  const identity = join(evidence, "inputs/identity.json"),
    bundle = join(evidence, "inputs/bundle.json");
  await writeFile(identity, sample().identityBytes);
  await writeFile(bundle, sample().bundleBytes);
  const cli = (args) =>
    command(process.execPath, [
      join(host, "src/cli.js"),
      "controls",
      ...args,
      "--json",
    ]);
  const create = (request) =>
    cli([
      "create-generated-candidate",
      "--request",
      request,
      "--identity",
      identity,
    ]);
  const publishArgs = (candidate, request, expected, path = bundle) => [
    "publish-generation",
    "--candidate",
    candidate,
    "--request",
    request,
    "--bundle",
    path,
    ...(expected ? ["--expected-head", expected] : ["--expect-absent"]),
  ];
  const publish = (candidate, request, expected, path) =>
    cli(publishArgs(candidate, request, expected, path));
  const ledger = join(anchor, "academic-os-control-publication.jsonl");
  const events = async () =>
    (await readFile(ledger, "utf8"))
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
  const fault = async (spec) => {
    await unlink(hit).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    await writeFile(config, JSON.stringify(spec));
  };
  const clear = async () => {
    await unlink(config).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  };
  async function stoppedCommand(argv, key, whileStopped, occurrence = 1) {
    await fault({ key, mode: "stop", occurrence });
    const child = spawn(process.execPath, argv, {
      cwd: source,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (bytes) => {
      stdout += bytes;
    });
    child.stderr.on("data", (bytes) => {
      stderr += bytes;
    });
    const done = new Promise((resolve) =>
      child.once("close", (status, signal) => {
        const result = {
          executable: process.execPath,
          args: argv,
          pid: child.pid,
          status,
          signal,
          stdout,
          stderr,
          aliveAfter: alive(child.pid),
        };
        commands.push(result);
        resolve(result);
      }),
    );
    try {
      let marker;
      for (let i = 0; i < 500; i++) {
        try {
          marker = JSON.parse(await readFile(hit, "utf8"));
        } catch {}
        if (marker?.pid === child.pid) break;
        if (child.exitCode !== null || child.signalCode !== null) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(marker?.pid, child.pid, `Stopped checkpoint reached ${key}`);
      await clear();
      await whileStopped(marker);
      child.kill("SIGCONT");
      return await done;
    } finally {
      await clear();
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGCONT");
        child.kill("SIGKILL");
      }
      await done;
    }
  }
  const stopped = (args, key, whileStopped, occurrence = 1) =>
    stoppedCommand(
      [join(host, "src/cli.js"), "controls", ...args, "--json"],
      key,
      whileStopped,
      occurrence,
    );
  const save = async (result) => {
    await writeFile(
      join(evidence, "mutation.json"),
      JSON.stringify(patches, null, 2),
    );
    const artifacts = {};
    const compiledPublication = (
      await readdir(join(host, "src/controls-publication"), {
        withFileTypes: true,
      })
    )
      .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
      .map((entry) => join(host, "src/controls-publication", entry.name));
    for (const path of [
      addon,
      loader,
      join(host, "src/journal-mutation-owner.js"),
      join(host, "src/controls-publication/native/index.js"),
      ...compiledPublication,
      join(host, "src/cli.js"),
      join(host, "src/controls-publication/release.json"),
      join(host, "publication.mjs"),
      join(host, "mcp.mjs"),
      ...["scan.native", "scan.c", "scan-core.c", "scan-core.h"].flatMap(
        (name) => [
          join(host, "native", `inventory-${name}`),
          join(host, "src/migration/native-inventory/native", name),
        ],
      ),
      ...patches.map((patch) => patch.snapshot),
    ])
      artifacts[path] = hash(await readFile(path));
    await writeFile(
      join(evidence, "artifacts.json"),
      JSON.stringify(artifacts, null, 2),
    );
    await writeFile(
      join(evidence, "commands.json"),
      JSON.stringify(commands, null, 2),
    );
    await writeFile(
      join(evidence, "result.json"),
      JSON.stringify(result, null, 2),
    );
    assert.ok(
      commands.every((entry) => !alive(entry.pid)),
      "All owned command PIDs ended",
    );
  };
  return {
    evidence,
    source,
    host,
    anchor,
    addon,
    ledger,
    trace,
    hit,
    command,
    cli,
    create,
    publish,
    publishArgs,
    events,
    fault,
    clear,
    stopped,
    stoppedCommand,
    save,
    sample,
    bundle,
    identity,
    patches,
    replace,
    bindStandaloneRuntime: (installation) =>
      bindFixtureRuntime(installation, installation),
    bindRuntime: async () => {
      await bindFixtureRuntime(host, host);
      await bindFixtureRuntime(host, join(host, "src/controls-publication"));
    },
  };
}

export function decoded(command) {
  assert.ok(command.stdout, command.stderr);
  return JSON.parse(command.stdout);
}

export async function readReceipt(f, receipt, includeHead = true) {
  const root = join(
    f.anchor,
    "academic-os-control-publication/candidates",
    receipt.candidateId,
  );
  const observations = [];
  for (const file of receipt.manifest) {
    if (!includeHead && file.kind === "head") continue;
    const path = join(root, file.path),
      bytes = await readFile(path);
    assert.equal(bytes.length, file.bytes.byteLength, path);
    assert.equal(hash(bytes), file.bytes.byteSha256, path);
    observations.push({ path, byteLength: bytes.length, sha256: hash(bytes) });
  }
  return observations;
}
