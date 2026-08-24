import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  createFileRoutineArtifactStore,
  moduleSessionDirectory,
  routineArtifactRoots,
} from "../../src/routine/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function stateRootWith(input: {
  reports: string[];
  sessions: string[];
  strays: string[];
}): Promise<string> {
  const stateRoot = await mkdtemp(join(tmpdir(), "academic-os-routine-"));
  temporaryRoots.push(stateRoot);
  const roots = routineArtifactRoots(stateRoot);
  await mkdir(roots.reports, { recursive: true });
  await mkdir(roots.sessions, { recursive: true });
  for (const date of input.reports) {
    await writeFile(join(roots.reports, `${date}.md`), `# ${date}\n`);
  }
  for (const date of input.sessions) {
    await mkdir(join(roots.sessions, date), { recursive: true });
  }
  for (const stray of input.strays) {
    await mkdir(join(roots.sessions, stray), { recursive: true });
    await writeFile(join(roots.reports, stray), "not the routine's\n");
  }
  return stateRoot;
}

describe("the routine's artifact store", () => {
  it("lands one dated report per morning, and rewrites the day's own", async () => {
    const stateRoot = await stateRootWith({
      reports: [],
      sessions: [],
      strays: [],
    });
    const store = createFileRoutineArtifactStore(stateRoot);

    await store.writeReport({ date: "2026-08-23", text: "first\n" });
    const path = await store.writeReport({
      date: "2026-08-23",
      text: "second\n",
    });

    assert.equal(
      path,
      join(routineArtifactRoots(stateRoot).reports, "2026-08-23.md"),
    );
    assert.equal(await readFile(path, "utf8"), "second\n");
    assert.deepEqual(await store.listReportDates(), ["2026-08-23"]);
  });

  it("names only what it wrote, so nothing else can enter a purge window", async () => {
    const stateRoot = await stateRootWith({
      reports: ["2026-08-23"],
      sessions: ["2026-08-23"],
      strays: ["keep-me", "2026-8-1"],
    });
    const store = createFileRoutineArtifactStore(stateRoot);

    assert.deepEqual(await store.listReportDates(), ["2026-08-23"]);
    assert.deepEqual(await store.listSessionDates(), ["2026-08-23"]);
  });

  it("removes a day whole and leaves every neighbour standing", async () => {
    const stateRoot = await stateRootWith({
      reports: ["2026-07-23", "2026-08-23"],
      sessions: ["2026-08-15", "2026-08-23"],
      strays: ["keep-me"],
    });
    const roots = routineArtifactRoots(stateRoot);
    await writeFile(
      join(roots.sessions, "2026-08-15", "session.log"),
      "a transcript\n",
    );
    const store = createFileRoutineArtifactStore(stateRoot);

    await store.removeSession("2026-08-15");
    await store.removeReport("2026-07-23");

    assert.deepEqual(await store.listSessionDates(), ["2026-08-23"]);
    assert.deepEqual(await store.listReportDates(), ["2026-08-23"]);
    assert.ok((await readdir(roots.sessions)).includes("keep-me"));
    assert.ok((await readdir(roots.reports)).includes("keep-me"));
  });

  it("refuses to reach an artifact that is not named for a calendar day", async () => {
    const stateRoot = await stateRootWith({
      reports: [],
      sessions: [],
      strays: [],
    });
    const store = createFileRoutineArtifactStore(stateRoot);

    await assert.rejects(store.removeSession("../.."), /calendar day/u);
    await assert.rejects(store.removeReport("2026-13-01"), /calendar day/u);
  });

  it("gives each module its own directory under the morning it ran", () => {
    assert.equal(
      moduleSessionDirectory({
        stateRoot: "/private/state",
        date: "2026-08-23",
        module: "AB1234",
      }),
      "/private/state/routine/sessions/2026-08-23/AB1234",
    );
  });
});
