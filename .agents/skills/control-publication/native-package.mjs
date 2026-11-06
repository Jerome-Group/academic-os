import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { transform } from "esbuild";
import { hash } from "./fixture.mjs";
import { success, refused, raw } from "./native-fixture.mjs";
export async function packagedReceipt(f) {
  await cp(join(f.productRoot, "dist/src"), join(f.source, "dist/src"), {
    recursive: true,
  });
  await copyFile(
    join(f.productRoot, "package-lock.json"),
    join(f.source, "package-lock.json"),
  );
  await unlink(join(f.source, "node_modules"));
  await cp(
    join(f.productRoot, "node_modules"),
    join(f.source, "node_modules"),
    {
      recursive: true,
    },
  );
  const file = "src/controls-publication/native-source-policy.ts";
  if (f.patches.some((patch) => patch.file === file))
    await writeFile(
      join(f.source, "dist", file.replace(/\.ts$/, ".js")),
      (
        await transform(await readFile(join(f.source, file), "utf8"), {
          loader: "ts",
          format: "esm",
          target: "node24",
        })
      ).code,
    );
  const released = f.command(process.execPath, [
    join(f.source, "scripts/build-control-publication-release.mjs"),
  ]);
  assert.equal(released.status, 0, released.stdout + released.stderr);
  const produced = join(f.evidence, "produced"),
    extracted = join(f.evidence, "produced-extracted"),
    archive = join(f.evidence, "produced.tar.gz");
  const packaged = f.command(process.execPath, [
    join(f.source, "scripts/build-control-publication-standalone.mjs"),
    produced,
  ]);
  assert.equal(packaged.status, 0, packaged.stdout + packaged.stderr);
  const tar = spawnSync("tar", ["-czf", archive, "-C", produced, "."], {
    encoding: "utf8",
  });
  assert.equal(tar.status, 0, tar.stderr);
  await mkdir(extracted, { mode: 0o700 });
  const untar = spawnSync("tar", ["-xzf", archive, "-C", extracted], {
    encoding: "utf8",
  });
  assert.equal(untar.status, 0, untar.stderr);
  const originalBundle = await readFile(join(extracted, "host-deployment.mjs")),
    originalPublication = await readFile(join(extracted, "publication.mjs"));
  await copyFile(f.addon, join(extracted, "native/publication-native.node"));
  const manifest = JSON.parse(
    await readFile(join(extracted, "release.json"), "utf8"),
  );
  manifest.nativeDigest = hash(await readFile(f.addon));
  await writeFile(join(extracted, "release.json"), JSON.stringify(manifest));
  await f.bindStandaloneRuntime(extracted);
  let serial = 0;
  const run = async (action, input) => {
    const path = join(f.evidence, `packaged-input-${++serial}.json`);
    await writeFile(path, JSON.stringify(input));
    return f.command(process.execPath, [
      join(extracted, "host-deployment.mjs"),
      action,
      action === "retry-native-source-policy" ? "--request" : "--input",
      action === "retry-native-source-policy" ? input : path,
    ]);
  };
  const registration = {
    ...f.registration,
    repositories: [...f.registration.repositories, raw(extracted)],
  };
  const productionRefusal = await run("register", registration);
  refused(productionRefusal, "unsupported-host");
  await assert.rejects(stat(f.ledger), { code: "ENOENT" });
  await writeFile(
    join(extracted, "native/index.js"),
    `import {createRequire} from 'node:module';import {isPublicationNative} from ${JSON.stringify(join(f.productRoot, "dist/src/controls-publication/native/index.js"))};export function loadPublicationNative(){const value=createRequire(import.meta.url)('./publication-native.node');if(!isPublicationNative(value)||value.buildKind!=='fixture')throw Error('Declared fixed account adapter required');return {kind:'ok',value};}`,
  );
  await f.bindStandaloneRuntime(extracted);
  for (const directory of [f.host, join(f.host, "src/controls-publication")])
    await writeFile(join(directory, "release.json"), JSON.stringify(manifest));
  await f.bindRuntime();
  const registered = success(await run("register", registration));
  const input = {
    requestId: "packaged-native-install",
    deploymentRegistrationDigest: registered.registrationDigest,
    expectedPriorGeneration: null,
    slots: [
      {
        sourceKey: "private-package",
        enclosureLocatorBase64: raw(f.enclosure),
        snapshotLocatorBase64: raw(f.snapshot),
      },
    ],
  };
  const call = await run("install-native-source-policy", input),
    value = success(call);
  const hostRetry = await f.run("retry-native-source-policy", input.requestId);
  assert.deepEqual(success(hostRetry), value);
  const rows = await f.events(),
    intent = rows.find(
      (row) =>
        row.record.kind === "native-source-policy-receipt-intent" &&
        row.record.scope.requestId === input.requestId,
    ),
    settled = rows.find(
      (row) =>
        row.record.kind === "native-source-policy-receipt-settled" &&
        row.record.scope.requestId === input.requestId,
    );
  const directory = join(
      f.anchor,
      "academic-os-control-publication/native-policy-receipts",
    ),
    files = await readdir(directory).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
  let physical;
  if (settled) {
    const path = join(
        directory,
        Buffer.from(
          settled.record.blob.claim.location.rawNameBase64,
          "base64",
        ).toString(),
      ),
      bytes = await readFile(path);
    assert.equal(hash(bytes), settled.record.blob.sha256);
    assert.deepEqual(JSON.parse(bytes), value);
    physical = {
      path,
      sha256: hash(bytes),
      length: bytes.length,
      inode: (await lstat(path)).ino,
    };
  }
  assert.deepEqual(
    await readFile(join(extracted, "host-deployment.mjs")),
    originalBundle,
  );
  assert.deepEqual(
    await readFile(join(extracted, "publication.mjs")),
    originalPublication,
  );
  const members = {};
  for (const name of [
    "host-deployment.mjs",
    "publication.mjs",
    "native/inventory-scan.native",
    "native/inventory-scan.c",
    "native/inventory-scan-core.c",
    "native/inventory-scan-core.h",
    "native/package.json",
  ]) {
    const original = await readFile(join(produced, name));
    assert.deepEqual(await readFile(join(extracted, name)), original);
    members[name] = hash(original);
  }
  const readback = await physicalReadback(f);
  return {
    violated: !intent && !settled && files.length === 0,
    controlPassed: Boolean(intent && settled && physical),
    readback,
    call,
    hostRetry,
    intent,
    settled,
    physical,
    files,
    productionRefusal,
    package: {
      produced,
      extracted,
      archive,
      archiveSha256: hash(await readFile(archive)),
      members,
      tar: { pid: tar.pid, status: tar.status },
      untar: { pid: untar.pid, status: untar.status },
      declaredAdaptations: [
        "native/publication-native.node",
        "native/index.js",
        "release.json",
        "runtime-integrity.json",
      ],
    },
  };
}

async function physicalReadback(f) {
  const native = createRequire(import.meta.url)(f.addon),
    ok = (result) => {
      assert.equal(result.kind, "ok", JSON.stringify(result));
      return result.value;
    },
    handles = [],
    files = [];
  const rows = await f.events(),
    claims = rows
      .filter((row) => row.record.kind === "file-claimed")
      .map((row) => row.record);
  const component = (name) => ok(native.component(Buffer.from(name)));
  const anchor = ok(native.resolveAccountAnchor());
  handles.push(anchor.directory);
  const namespace = ok(
    native.openDirectoryNoFollow(
      anchor.directory,
      component("academic-os-control-publication"),
    ),
  );
  handles.push(namespace);
  async function walk(directory, path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      assert.ok(
        entry.isFile() || entry.isDirectory(),
        "Only ordinary fixture output entries are read",
      );
      const childPath = join(path, entry.name);
      if (entry.isDirectory()) {
        const child = ok(
          native.openDirectoryNoFollow(directory, component(entry.name)),
        );
        handles.push(child);
        await walk(child, childPath);
      } else {
        const file = ok(
          native.openRegularNoFollow(directory, component(entry.name), "read"),
        );
        handles.push(file);
        const observed = ok(native.observe(file));
        const claim = claims.find(
          (row) =>
            row.file.object.device === observed.object.device &&
            row.file.object.inode === observed.object.inode &&
            row.file.object.birthtimeNs === observed.object.birthtimeNs,
        );
        assert.ok(claim, `Output has a full generated claim ${childPath}`);
        assert.deepEqual(observed.object, claim.file.object);
        assert.deepEqual(observed.metadata, claim.file.metadata);
        assert.equal(observed.metadata.mode, 0o600);
        assert.equal(observed.metadata.linkCount, 1);
        const bytes = Buffer.from(
          ok(
            native.readBounded({
              file,
              maximumBytes: 1048576,
              exactLength: claim.planned.byteLength,
            }),
          ),
        );
        assert.equal(hash(bytes), claim.planned.byteSha256);
        assert.equal(bytes.length, claim.planned.byteLength);
        files.push({
          path: childPath,
          object: observed.object,
          metadata: observed.metadata,
          byteLength: bytes.length,
          sha256: hash(bytes),
        });
      }
    }
  }
  try {
    await walk(namespace, join(f.anchor, "academic-os-control-publication"));
  } finally {
    for (const handle of handles.reverse()) ok(native.close(handle));
  }
  const result = {
    files,
    allHandlesClosed: handles.length,
    sqliteSidecarContentsAccessed: false,
  };
  await writeFile(
    join(f.evidence, "native-physical-readback.json"),
    JSON.stringify(result, null, 2),
  );
  return result;
}
