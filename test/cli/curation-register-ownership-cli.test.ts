import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { type TestContext, test } from "node:test";
import { fileURLToPath } from "node:url";
import { md5Bytes, sha256 } from "../../src/checksum.js";
import { writtenControlPaths } from "../../src/conformance/control-paths.js";
import { journalFixture, journalProcess } from "../support/journal-process.js";

const cli = fileURLToPath(new URL("../../src/cli.js", import.meta.url));
const preload = fileURLToPath(
  new URL(
    "../../../test/support/curation-ownership-preload.mjs",
    import.meta.url,
  ),
);
const source = "Synthetic whole source.\n";
const sourcePath = "03 Combined Notes.pdf";
const wholeCopy = "10 Learning Materials/whole.pdf";
const derived = "10 Learning Materials/cut.pdf";

async function fixture(t: TestContext, name: string) {
  const root = await journalFixture(t, `curation-${name}`);
  const stateRoot = join(root, "State");
  const driveMount = join(root, "Mount");
  await mkdir(stateRoot);
  const prefix = `${[
    JSON.stringify({
      schema_version: 1,
      source_id: "legacy-id",
      integration: "ntulearn",
      role: "handout",
      source_path: "04 Handout.pdf",
      checksum: `md5:${md5Bytes(Buffer.from(source))}`,
      decision: "source-only",
      evidence: "Synthetic source identity.",
      timestamp: "2026-01-04T00:00:00Z",
    }),
    ...[wholeCopy, derived].map((destination) =>
      JSON.stringify({
        schema_version: 3,
        source_id: "Combined Notes.pdf",
        integration: "ntulearn",
        role: "lecture",
        source_path: sourcePath,
        checksum: `sha256:${sha256(source)}`,
        decision: "curated",
        destination,
        evidence: "Synthetic split batch.",
        timestamp: "2026-01-05T00:00:00Z",
      }),
    ),
  ].join("\n")}\n`;
  const targets = new Map<string, string>();
  const configs = new Map<string, string>();
  for (const module of ["AA9999", "BB9999"]) {
    const moduleRoot = join(driveMount, "Modules", "Y9S9", module);
    const files = [
      [writtenControlPaths.curationRegister, prefix],
      [
        writtenControlPaths.definition,
        "sources:\n  ntulearn:\n    - {role: primary, destination: NTULearn, evidence: [course-site]}\n",
      ],
      [`NTULearn/${sourcePath}`, source],
      ["NTULearn/04 Handout.pdf", source],
      [wholeCopy, source],
      [derived, "Synthetic derived bytes.\n"],
    ];
    for (const [path, contents] of files) {
      assert.ok(path !== undefined && contents !== undefined);
      const target = join(moduleRoot, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, contents);
    }
    targets.set(module, join(moduleRoot, writtenControlPaths.curationRegister));
    const configPath = join(root, `${module}.json`);
    await writeFile(
      configPath,
      JSON.stringify({
        driveMount,
        stateRoot,
        activeSemester: "Y9S9",
        semesters: {
          Y9S9: { root: "Modules/Y9S9", status: "active", modules: [module] },
        },
      }),
    );
    configs.set(module, configPath);
  }
  return { root, stateRoot, driveMount, targets, configs, prefix };
}

function invocation(
  t: TestContext,
  f: Awaited<ReturnType<typeof fixture>>,
  name: string,
  command: "migrate" | "rederive",
  options: {
    point?: string;
    module?: string;
    config?: string;
    preview?: boolean;
  } = {},
) {
  const module = options.module ?? "AA9999";
  const config = options.config ?? f.configs.get(module);
  const target = f.targets.get(module);
  assert.ok(config && target);
  return journalProcess(
    t,
    f.root,
    name,
    [
      "--import",
      preload,
      cli,
      "curation",
      command,
      "--config",
      config,
      "--json",
      ...(options.preview ? [] : ["--apply"]),
    ],
    {
      AOS_CURATION_TARGET: target,
      AOS_CURATION_POINT: options.point,
      AOS_CURATION_TRACE: join(f.root, `${name}.trace.jsonl`),
    },
  );
}

async function journals(stateRoot: string) {
  const directory = join(stateRoot, "journals");
  const files = await readdir(directory, { recursive: true }).catch(() => []);
  return await Promise.all(
    files
      .filter((path) => path.endsWith(".jsonl"))
      .sort()
      .map(async (path) => ({
        path,
        events: (await readFile(join(directory, path), "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line)),
      })),
  );
}

test("two curation processes retain every append they report successful", async (t) => {
  const f = await fixture(t, "concurrent-prefix");
  const target = f.targets.get("AA9999") ?? "";
  const owner = invocation(t, f, "owner", "migrate", { point: "final-read" });
  await owner.wait("barrier");
  const contender = invocation(t, f, "contender", "rederive", {
    point: "final-read",
  });
  await Promise.race([
    contender.done,
    contender.wait("barrier").catch(() => undefined),
  ]);
  owner.child.send("release");
  const first = await owner.done;
  if (contender.child.exitCode === null && contender.child.signalCode === null)
    contender.child.send("release");
  const second = await contender.done;
  const firstReport = JSON.parse(first.stdout);
  const secondReport = JSON.parse(second.stdout);
  const contents = await readFile(target, "utf8");
  const events = contents
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  await writeFile(
    join(f.root, "readback.json"),
    JSON.stringify(
      {
        firstReport,
        secondReport,
        contents,
        journals: await journals(f.stateRoot),
      },
      null,
      2,
    ),
  );
  assert.equal(first.code, 0, first.stderr);
  assert.equal(firstReport.appended, 1);
  assert.ok(contents.startsWith(f.prefix));
  assert.ok(
    events.some((event) => event.supersedes === "legacy-id"),
    "the successful migration must survive the competing rederivation",
  );
  if (secondReport.appended > 0)
    assert.ok(
      events.some((event) => event.decision === "rederived"),
      "the successful rederivation must survive the competing migration",
    );
  else {
    assert.equal(second.code, 2, second.stderr);
    assert.match(secondReport.refusals.join(" "), /another invocation owns/u);
  }
});

for (const point of ["final-read", "readback", "result-sync"]) {
  test(`curation migrate owns its register through ${point} and fences rederive`, async (t) => {
    const f = await fixture(t, point);
    const target = f.targets.get("AA9999") ?? "";
    const owner = invocation(t, f, "owner", "migrate", { point });
    await owner.wait("barrier");
    const before = await readFile(target, "utf8");
    const journalBefore = await journals(f.stateRoot);
    const loser = await invocation(t, f, "loser", "rederive").done;
    assert.equal(loser.code, 2, loser.stderr);
    const refused = JSON.parse(loser.stdout);
    assert.equal(refused.appended, 0);
    assert.match(
      refused.refusals.join(" "),
      /another invocation owns this curation register/u,
    );
    assert.equal(await readFile(target, "utf8"), before);
    assert.deepEqual(await journals(f.stateRoot), journalBefore);
    const independent = await invocation(t, f, "independent", "migrate", {
      module: "BB9999",
    }).done;
    assert.equal(independent.code, 0, independent.stderr);
    assert.equal(JSON.parse(independent.stdout).appended, 1);
    owner.child.send("release");
    const completed = await owner.done;
    assert.equal(completed.code, 0, completed.stderr);
    assert.equal(JSON.parse(completed.stdout).appended, 1);
    const migrated = await readFile(target, "utf8");
    assert.ok(migrated.startsWith(f.prefix));
    const fresh = await invocation(t, f, "fresh-rederive", "rederive").done;
    assert.equal(fresh.code, 0, fresh.stderr);
    assert.equal(JSON.parse(fresh.stdout).appended, 1);
    assert.ok((await readFile(target, "utf8")).startsWith(migrated));
    const repeated = await invocation(t, f, "repeat", "rederive").done;
    assert.equal(JSON.parse(repeated.stdout).appended, 0);
    await writeFile(
      join(f.root, "journal-readback.json"),
      JSON.stringify(await journals(f.stateRoot), null, 2),
    );
  });
}

test("a stopped curation owner stays busy and a killed owner permits a fresh apply", async (t) => {
  const f = await fixture(t, "death");
  const target = f.targets.get("AA9999") ?? "";
  const owner = invocation(t, f, "owner", "migrate", { point: "final-read" });
  await owner.wait("barrier");
  owner.child.kill("SIGSTOP");
  const loser = await invocation(t, f, "stopped-loser", "rederive").done;
  assert.equal(loser.code, 2, loser.stderr);
  assert.match(
    JSON.parse(loser.stdout).refusals.join(" "),
    /another invocation owns/u,
  );
  assert.equal(await readFile(target, "utf8"), f.prefix);
  owner.child.kill("SIGKILL");
  assert.equal((await owner.done).signal, "SIGKILL");
  const fresh = await invocation(t, f, "successor", "migrate").done;
  assert.equal(fresh.code, 0, fresh.stderr);
  assert.equal(JSON.parse(fresh.stdout).appended, 1);
  assert.ok((await readFile(target, "utf8")).startsWith(f.prefix));
  const history = await journals(f.stateRoot);
  assert.deepEqual(
    history.map(({ events }) => events.map((event) => event.type)).sort(),
    [["intent"], ["intent", "result"]],
  );
  await writeFile(
    join(f.root, "journal-readback.json"),
    JSON.stringify(history, null, 2),
  );
});

test("an interrupted published append is preserved and a stale observed plan refuses", async (t) => {
  const f = await fixture(t, "published-interruption");
  const target = f.targets.get("AA9999") ?? "";
  const stale = invocation(t, f, "stale", "rederive", { point: "observation" });
  await stale.wait("barrier");
  const owner = invocation(t, f, "owner", "migrate", { point: "readback" });
  await owner.wait("barrier");
  const published = await readFile(target, "utf8");
  assert.ok(published.startsWith(f.prefix));
  assert.notEqual(published, f.prefix);
  owner.child.kill("SIGKILL");
  assert.equal((await owner.done).signal, "SIGKILL");
  stale.child.send("release");
  const refused = await stale.done;
  assert.equal(refused.code, 2, refused.stderr);
  assert.equal(JSON.parse(refused.stdout).appended, 0);
  assert.match(
    JSON.parse(refused.stdout).refusals.join(" "),
    /register changed after it was read/u,
  );
  assert.equal(await readFile(target, "utf8"), published);
  const repeated = await invocation(t, f, "fresh-migrate", "migrate").done;
  assert.equal(repeated.code, 0, repeated.stderr);
  assert.equal(JSON.parse(repeated.stdout).appended, 0);
  const corrected = await invocation(t, f, "fresh-rederive", "rederive").done;
  assert.equal(corrected.code, 0, corrected.stderr);
  assert.equal(JSON.parse(corrected.stdout).appended, 1);
  assert.ok((await readFile(target, "utf8")).startsWith(published));
  await writeFile(
    join(f.root, "journal-readback.json"),
    JSON.stringify(await journals(f.stateRoot), null, 2),
  );
});

for (const spelling of ["symlink", "case"]) {
  test(`${spelling} mount and private-state aliases share one register owner`, async (t) => {
    const f = await fixture(t, "aliases");
    const mountAlias = join(
      f.root,
      spelling === "case" ? "mOUNT" : "mount-alias",
    );
    const stateAlias = join(
      f.root,
      spelling === "case" ? "sTATE" : "state-alias",
    );
    if ((await realpath(mountAlias).catch(() => undefined)) === undefined)
      await symlink(f.driveMount, mountAlias, "dir");
    if ((await realpath(stateAlias).catch(() => undefined)) === undefined)
      await symlink(f.stateRoot, stateAlias, "dir");
    assert.equal(await realpath(mountAlias), f.driveMount);
    assert.equal(await realpath(stateAlias), f.stateRoot);
    const aliasConfig = join(f.root, "alias.json");
    const config = JSON.parse(
      await readFile(f.configs.get("AA9999") ?? "", "utf8"),
    );
    await writeFile(
      aliasConfig,
      JSON.stringify({
        ...config,
        driveMount: mountAlias,
        stateRoot: stateAlias,
      }),
    );
    const owner = invocation(t, f, "owner", "migrate", { point: "final-read" });
    await owner.wait("barrier");
    const loser = await invocation(t, f, "alias-loser", "rederive", {
      config: aliasConfig,
    }).done;
    assert.equal(loser.code, 2, loser.stderr);
    assert.match(
      JSON.parse(loser.stdout).refusals.join(" "),
      /another invocation owns/u,
    );
    owner.child.send("release");
    assert.equal((await owner.done).code, 0);
  });
}

test("unsafe ownership state refuses apply and previews leave state empty", async (t) => {
  const f = await fixture(t, "unavailable");
  const preview = await invocation(t, f, "preview", "migrate", {
    preview: true,
  }).done;
  assert.equal(preview.code, 1, preview.stderr);
  assert.deepEqual(await readdir(f.stateRoot), []);
  const ownerDirectory = join(f.stateRoot, "journal-ownership");
  await mkdir(ownerDirectory);
  await chmod(ownerDirectory, 0o755);
  const unavailable = await invocation(t, f, "unavailable", "migrate").done;
  assert.equal(unavailable.code, 2, unavailable.stderr);
  assert.equal(JSON.parse(unavailable.stdout).appended, 0);
  assert.match(
    JSON.parse(unavailable.stdout).refusals.join(" "),
    /mutation ownership is unavailable/u,
  );
  assert.equal(await readFile(f.targets.get("AA9999") ?? "", "utf8"), f.prefix);
  assert.deepEqual(await journals(f.stateRoot), []);
});
