import assert from "node:assert/strict";
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import { isRecord } from "../../src/conformance/value-shape.js";
import { fixture } from "./native-policy-fixture.js";

it("binds complete actual host and extracted artifact sets and refuses missing, modified or omitted bytes before account owner entry", {
  skip: process.platform !== "darwin",
  timeout: 180000,
}, async (context) => {
  const f = await fixture("runtime-consistency");
  context.diagnostic(`Retained runtime consistency fixture ${f.root}`);
  const observations: object[] = [];
  await writeFile(
    f.checkpoint,
    JSON.stringify({ edge: "before-handle-guard", action: "throw" }),
  );
  for (const [directory, targets] of [
    [
      f.host,
      [
        "src/controls-publication/release.js",
        "src/controls-publication/generated/schemas.js",
        "src/controls-publication/native/publication-native.node",
        "src/migration/native-inventory/native/scan.native",
        "src/migration/native-inventory/native/scan.c",
        "package-lock.json",
      ],
    ],
    [
      f.extracted,
      [
        "publication.mjs",
        "host-deployment.mjs",
        "native/publication-native.node",
        "native/inventory-scan.native",
        "native/inventory-scan.c",
        "package-lock.json",
      ],
    ],
  ] satisfies [string, string[]][]) {
    for (const target of targets) {
      const path = join(directory, target),
        bytes = await readFile(path);
      await writeFile(
        path,
        Buffer.concat([
          bytes,
          Buffer.from(
            target.endsWith(".js") || target.endsWith(".mjs")
              ? "\n// fixture runtime byte change\n"
              : "\n",
          ),
        ]),
      );
      const changed = await f.run("register", f.registrationInput, directory);
      assert.notEqual(changed.status, 0, `${target} modification was accepted`);
      await assert.rejects(stat(join(f.root, "fault-hit.json")), {
        code: "ENOENT",
      });
      await assert.rejects(stat(f.ledger), { code: "ENOENT" });
      observations.push({
        directory,
        target,
        mutation: "changed",
        result: changed.value,
        accountOwnerEntered: false,
      });
      await writeFile(path, bytes);
      const retained = join(f.root, `missing-${observations.length}`);
      await rename(path, retained);
      const missing = await f.run("register", f.registrationInput, directory);
      assert.notEqual(missing.status, 0, `${target} absence was accepted`);
      await assert.rejects(stat(join(f.root, "fault-hit.json")), {
        code: "ENOENT",
      });
      await assert.rejects(stat(f.ledger), { code: "ENOENT" });
      observations.push({
        directory,
        target,
        mutation: "missing",
        result: missing.value,
        accountOwnerEntered: false,
      });
      await rename(retained, path);
    }
  }
  const metadataPath = join(
    f.host,
    "src/controls-publication/runtime-integrity.json",
  );
  const metadataBytes = await readFile(metadataPath);
  const metadata: unknown = JSON.parse(metadataBytes.toString());
  assert.ok(isRecord(metadata));
  await writeFile(
    metadataPath,
    JSON.stringify({ ...metadata, unknownAuthority: true }),
  );
  const unknown = await f.run("register", f.registrationInput);
  assert.notEqual(unknown.status, 0);
  await assert.rejects(stat(join(f.root, "fault-hit.json")), {
    code: "ENOENT",
  });
  assert.ok(Array.isArray(metadata.artifacts));
  await writeFile(
    metadataPath,
    JSON.stringify({
      ...metadata,
      artifacts: metadata.artifacts.filter(
        (artifact: unknown) =>
          !isRecord(artifact) ||
          artifact.path !== "src/controls-publication/generated/schemas.js",
      ),
    }),
  );
  const omitted = await f.run("register", f.registrationInput);
  assert.notEqual(omitted.status, 0);
  assert.match(JSON.stringify(omitted.value), /complete binding set/u);
  await assert.rejects(stat(join(f.root, "fault-hit.json")), {
    code: "ENOENT",
  });
  await writeFile(metadataPath, metadataBytes);
  await unlink(f.checkpoint);
  const registered = await f.run("register", f.registrationInput);
  assert.equal(registered.status, 0, JSON.stringify(registered.value));
  const extracted = await f.run("register", f.registrationInput, f.extracted);
  assert.equal(extracted.status, 0, JSON.stringify(extracted.value));
  assert.deepEqual(extracted.value, registered.value);
  const installed = await f.run(
    "install-native-source-policy",
    await f.request(),
  );
  assert.equal(installed.status, 0, JSON.stringify(installed.value));
  await writeFile(
    join(f.root, "runtime-mutation-controls.json"),
    JSON.stringify(
      {
        observations,
        unknown: unknown.value,
        omitted: omitted.value,
        restoredRegistration: registered.value,
        restoredInstallation: installed.value,
      },
      null,
      2,
    ),
  );
});
