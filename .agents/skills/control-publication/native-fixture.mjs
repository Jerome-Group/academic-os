import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decoded, makeFixture } from "./fixture.mjs";
export const raw = (path) => Buffer.from(path).toString("base64");
export const success = (call) => {
  assert.equal(call.status, 0, call.stdout + call.stderr);
  return decoded(call);
};
export const refused = (call, code) => {
  const value = decoded(call);
  assert.notEqual(call.status, 0, JSON.stringify(value));
  if (code) assert.equal(value.code, code, JSON.stringify(value));
  return value;
};
export async function nativeFixture(root, evidence, name, mutate) {
  const f = await makeFixture(root, evidence, name, mutate);
  const enclosure = join(f.evidence, "private"),
    snapshot = join(enclosure, "snapshot");
  for (const path of [
    enclosure,
    snapshot,
    join(f.evidence, "live"),
    join(f.evidence, "state"),
  ])
    await mkdir(path, { mode: 0o700 });
  const configuration = join(f.evidence, "configuration.json");
  await writeFile(
    configuration,
    JSON.stringify({
      schemaVersion: 1,
      driveMount: join(f.evidence, "live"),
      stateRoot: join(f.evidence, "state"),
    }),
    { mode: 0o600 },
  );
  const registration = {
    requestId: "native-register",
    configurations: [raw(configuration)],
    repositories: [
      raw(root),
      raw(f.host),
      raw(f.source),
      raw(join(f.host, "src/controls-publication")),
    ],
    expectedPriorRegistration: null,
  };
  let serial = 0;
  const run = async (action, input, bundled = false) => {
    const inputPath = join(f.evidence, `native-input-${++serial}.json`);
    await writeFile(inputPath, JSON.stringify(input), { mode: 0o600 });
    return f.command(process.execPath, [
      bundled
        ? join(f.host, "host-deployment.mjs")
        : join(f.host, "src/controls-publication/host-deployment.js"),
      action,
      action === "retry-native-source-policy" ? "--request" : "--input",
      action === "retry-native-source-policy" ? input : inputPath,
    ]);
  };
  const stoppedRun = async (action, input, key, whileStopped) => {
    const path = join(f.evidence, `native-stopped-input-${++serial}.json`);
    await writeFile(path, JSON.stringify(input), { mode: 0o600 });
    return f.stoppedCommand(
      [
        join(f.host, "src/controls-publication/host-deployment.js"),
        action,
        "--input",
        path,
      ],
      key,
      whileStopped,
    );
  };
  const prepare = async () => {
    const registered = success(await run("register", registration));
    return {
      requestId: "native-install",
      deploymentRegistrationDigest: registered.registrationDigest,
      expectedPriorGeneration: null,
      slots: [
        {
          sourceKey: "private-one",
          enclosureLocatorBase64: raw(enclosure),
          snapshotLocatorBase64: raw(snapshot),
        },
      ],
    };
  };
  return {
    ...f,
    productRoot: root,
    stoppedRun,
    enclosure,
    snapshot,
    registration,
    run,
    prepare,
  };
}
