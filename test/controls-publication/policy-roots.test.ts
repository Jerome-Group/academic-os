import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import { isRecord } from "../../src/conformance/value-shape.js";
import {
  parseBytes,
  validatePolicy,
} from "../../src/controls-publication/schema.js";
import { fixture, raw } from "./native-policy-fixture.js";

it("binds actual signed source birthtime without changing frozen generated identity and refuses physical overlap in both directions", {
  skip: process.platform !== "darwin",
  timeout: 180000,
}, async (context) => {
  const f = await fixture("signed-source-root");
  context.diagnostic(`Retained signed source-root fixture ${f.root}`);
  const executable = join(f.root, "policy-date-fixture");
  const build = spawnSync(
    "xcrun",
    [
      "clang",
      `-DAOS_POLICY_DATE_FIXTURE_SOURCE=${JSON.stringify(f.source)}`,
      "test/controls-publication/policy-date-fixture.c",
      "-o",
      executable,
    ],
    { encoding: "utf8" },
  );
  assert.equal(build.status, 0, build.stderr);
  const date = spawnSync(executable, [], { encoding: "utf8" });
  assert.equal(date.status, 0, date.stderr);
  const observed: unknown = JSON.parse(date.stdout);
  assert.ok(
    isRecord(observed) &&
      typeof observed.seconds === "string" &&
      typeof observed.nanoseconds === "number",
  );
  assert.equal(observed.setter, 0);
  assert.ok(BigInt(observed.seconds) < 0n);
  const expected = (
    BigInt(observed.seconds) * 1000000000n +
    BigInt(observed.nanoseconds)
  ).toString();
  await chmod(f.source, 0o777);
  const input = await f.request();
  const installed = await f.run("install-native-source-policy", input);
  assert.equal(installed.status, 0, JSON.stringify(installed.value));
  assert.ok(
    isRecord(installed.value.generation) &&
      typeof installed.value.generation.sha256 === "string",
  );
  const policy = parseBytes(
    await readFile(
      join(
        f.anchor,
        "academic-os-control-publication/native-source-policy",
        `${installed.value.generation.sha256}.json`,
      ),
    ),
    validatePolicy,
  );
  assert.equal(policy.slots[0].snapshot.object.birthtimeNs, expected);
  await writeFile(
    join(f.root, "source-date-evidence.json"),
    JSON.stringify(
      {
        setter: observed,
        expected,
        actual: policy.slots[0].snapshot.object.birthtimeNs,
        ordinaryMode: 0o777,
      },
      null,
      2,
    ),
  );
  await chmod(f.source, 0o700);
  await writeFile(
    f.config,
    JSON.stringify({
      schemaVersion: 1,
      driveMount: f.source,
      stateRoot: join(f.root, "state"),
    }),
    { mode: 0o600 },
  );
  const registry = await f.run("register", {
    ...f.registrationInput,
    requestId: "source-now-excluded",
    expectedPriorRegistration: input.deploymentRegistrationDigest,
  });
  assert.equal(registry.status, 0, JSON.stringify(registry.value));
  const excluded = await f.run("install-native-source-policy", {
    ...input,
    requestId: "excluded-negative-root",
    deploymentRegistrationDigest: registry.value.registrationDigest,
    expectedPriorGeneration: installed.value.generation.sha256,
  });
  assert.equal(excluded.value.code, "unsafe-namespace");
  const reverse = await fixture("reverse-overlap");
  context.diagnostic(`Retained reverse-overlap fixture ${reverse.root}`);
  const live = join(reverse.source, "registered-live");
  await mkdir(live, { mode: 0o700 });
  await writeFile(
    reverse.config,
    JSON.stringify({
      schemaVersion: 1,
      driveMount: live,
      stateRoot: join(reverse.root, "state"),
    }),
    { mode: 0o600 },
  );
  const reverseInput = await reverse.request();
  const ancestor = await reverse.run(
    "install-native-source-policy",
    reverseInput,
  );
  assert.equal(ancestor.value.code, "unsafe-namespace");
  assert.equal(
    (await reverse.records()).some(
      (row) => row.kind === "native-source-policy-install-intent",
    ),
    false,
  );
  await writeFile(
    reverse.config,
    JSON.stringify({
      schemaVersion: 1,
      driveMount: join(reverse.root, "live"),
      stateRoot: join(reverse.root, "state"),
    }),
    { mode: 0o600 },
  );
  const safeRegistry = await reverse.run("register", {
    ...reverse.registrationInput,
    requestId: "safe-alias-configuration",
    expectedPriorRegistration: reverseInput.deploymentRegistrationDigest,
  });
  assert.equal(safeRegistry.status, 0, JSON.stringify(safeRegistry.value));
  await symlink(reverse.source, join(reverse.enclosure, "source-alias"));
  const alias = await reverse.run("install-native-source-policy", {
    ...reverseInput,
    deploymentRegistrationDigest: safeRegistry.value.registrationDigest,
    slots: [
      {
        ...reverseInput.slots[0],
        snapshotLocatorBase64: raw(join(reverse.enclosure, "source-alias")),
      },
    ],
  });
  assert.equal(alias.value.code, "unsafe-namespace");
});
