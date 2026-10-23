import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { runCliWithEnvironment } from "../support/run-cli.js";

const preload = new URL("../support/fake-calendar-preload.js", import.meta.url)
  .href;

for (const kind of ["ordinary", "..private", "alias", "outside"]) {
  it(`validates ${kind} private state before Calendar setup can observe a provider`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "academic-state-boundary-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const driveMount = join(root, "Drive");
    await mkdir(driveMount);
    let stateRoot = join(
      kind === "outside" ? root : driveMount,
      kind === "alias" ? "..private" : kind,
    );
    await mkdir(stateRoot);
    if (kind === "alias") {
      const alias = join(root, "private-alias");
      await symlink(stateRoot, alias);
      stateRoot = alias;
    }
    const config = join(root, "config.json");
    await writeFile(
      config,
      JSON.stringify({
        driveMount,
        stateRoot,
        calendar: {
          managementHorizon: "2026-10-01T00:00:00.000Z",
          credentials: {
            scheduledRead: join(root, "read.json"),
            interactiveWrite: join(root, "write.json"),
          },
        },
      }),
    );
    const provider = join(root, "provider.json");
    await writeFile(
      provider,
      JSON.stringify({
        calendars: [
          {
            id: "academic",
            summary: "Academic",
            primary: true,
            accessRole: "owner",
          },
          { id: "commitments", summary: "Commitments", accessRole: "owner" },
          { id: "routine", summary: "Routine", accessRole: "owner" },
        ],
        requests: [],
      }),
    );
    const before = await readFile(provider);
    const result = await runCliWithEnvironment(
      {
        NODE_OPTIONS: `--import=${preload}`,
        ACADEMIC_OS_FAKE_CALENDAR_STATE: provider,
      },
      "calendar",
      "setup",
      "--config",
      config,
      "--json",
    );
    if (kind === "outside") {
      assert.equal(result.exitCode, 0, JSON.stringify(result));
      assert.equal(JSON.parse(result.stdout).outcome, "configured");
      assert.equal(JSON.parse(result.stdout).workspace, "written");
      assert.equal(
        (await realpath(stateRoot)).startsWith(
          `${await realpath(driveMount)}/`,
        ),
        false,
      );
      assert.equal(
        JSON.parse(await readFile(provider, "utf8")).requests.length,
        1,
      );
    } else {
      assert.equal(result.exitCode, 2, JSON.stringify(result));
      assert.equal(JSON.parse(result.stdout).error.code, "unsafe-state-root");
      assert.deepEqual(await readFile(provider), before);
    }
  });
}
