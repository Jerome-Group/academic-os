import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { it, type TestContext } from "node:test";

it("normal rebuilds remove deleted modules and tests and execute the current source", async (context) => {
  const { installation } = await buildFixture(context);
  const retiredSource = join(installation, "src/retired");
  const retiredTest = join(installation, "test/build/retired.test.ts");
  await mkdir(retiredSource);
  await writeFile(
    join(retiredSource, "value.ts"),
    'export const value = "previous revision";\n',
  );
  await writeFile(
    join(installation, "src/entry.ts"),
    'import { value } from "./retired/value.js"; process.stdout.write(value);\n',
  );
  await writeFile(
    retiredTest,
    'import { it } from "node:test"; it("retired branch suite", () => { throw new Error("orphan test executed"); });\n',
  );
  run({ cwd: installation, program: "npm", args: ["run", "build"] });
  assert.equal(
    run({
      cwd: installation,
      program: process.execPath,
      args: ["dist/src/entry.js"],
    }).stdout,
    "previous revision",
  );
  for (const path of [
    "dist/src/retired/value.js",
    "dist/src/retired/value.d.ts",
    "dist/test/build/retired.test.js",
    "dist/test/build/retired.test.d.ts",
  ])
    assert.ok((await lstat(join(installation, path))).isFile(), path);

  await rename(retiredSource, join(installation, "src/current"));
  await writeFile(
    join(installation, "src/current/value.ts"),
    'export const value = "current revision";\n',
  );
  await writeFile(
    join(installation, "src/entry.ts"),
    'import { value } from "./current/value.js"; process.stdout.write(value);\n',
  );
  await rm(retiredTest);
  await writeFile(
    join(installation, "test/build/current.test.ts"),
    'import assert from "node:assert/strict"; import { it } from "node:test"; import { value } from "../../src/current/value.js"; it("current branch suite", () => assert.equal(value, "current revision"));\n',
  );

  run({ cwd: installation, program: "npm", args: ["run", "build"] });
  const tests = run({ cwd: installation, program: "npm", args: ["test"] });
  assert.match(tests.stdout, /current branch suite/u);
  assert.doesNotMatch(
    tests.stdout,
    /retired branch suite|orphan test executed/u,
  );
  for (const path of [
    "dist/src/retired",
    "dist/test/build/retired.test.js",
    "dist/test/build/retired.test.d.ts",
  ])
    await assert.rejects(lstat(join(installation, path)), { code: "ENOENT" });
  assert.equal(
    run({
      cwd: installation,
      program: process.execPath,
      args: ["dist/src/entry.js"],
    }).stdout,
    "current revision",
  );
  assert.equal(
    await readFile(join(installation, "source-sentinel.txt"), "utf8"),
    "outside the compiler output\n",
  );
});

it("refuses a linked output directory without changing external files", async (context) => {
  const { root, installation } = await buildFixture(context);
  const outside = join(root, "outside");
  await mkdir(join(outside, "src"), { recursive: true });
  const sentinel = join(outside, "src/entry.js");
  await writeFile(sentinel, "protected external output\n");
  await symlink(outside, join(installation, "dist"), "junction");

  assertBuildRefused(installation);
  assert.equal(await readFile(sentinel, "utf8"), "protected external output\n");
  assert.equal(await readlink(join(installation, "dist")), outside);
});

it("refuses a file at the output directory without removing it", async (context) => {
  const { installation } = await buildFixture(context);
  const output = join(installation, "dist");
  await writeFile(output, "unknown real file\n");

  assertBuildRefused(installation);
  assert.equal(await readFile(output, "utf8"), "unknown real file\n");
});

it("refuses unsupported output entries before removing generated files", async (context) => {
  for (const { kind, path } of [
    { kind: "directory-link", path: "src/unowned" },
    { kind: "file-link", path: "src/unowned.js" },
    { kind: "file", path: "src/notes.txt" },
    { kind: "directory", path: "unowned" },
  ])
    await context.test(kind, async (child) => {
      const { root, installation } = await buildFixture(child);
      const output = join(installation, "dist");
      await mkdir(join(output, "src"), { recursive: true });
      const generated = join(output, "src/previous.js");
      await writeFile(generated, "previous compiled output\n");
      const outside = join(root, "outside");
      await mkdir(outside);
      const sentinel = join(outside, "entry.js");
      await writeFile(sentinel, "protected external output\n");
      const unexpected = join(output, path);
      if (kind === "directory-link")
        await symlink(outside, unexpected, "junction");
      else if (kind === "file-link") await symlink(sentinel, unexpected);
      else if (kind === "directory") await mkdir(unexpected);
      else await writeFile(unexpected, "unknown real file\n");

      assertBuildRefused(installation);
      assert.equal(
        await readFile(generated, "utf8"),
        "previous compiled output\n",
      );
      assert.equal(
        await readFile(sentinel, "utf8"),
        "protected external output\n",
      );
      if (kind === "directory-link" || kind === "file-link")
        assert.equal(
          await readlink(unexpected),
          kind === "directory-link" ? outside : sentinel,
        );
      else if (kind === "file")
        assert.equal(await readFile(unexpected, "utf8"), "unknown real file\n");
      else assert.ok((await lstat(unexpected)).isDirectory());
      await assert.rejects(lstat(join(output, "src/entry.js")), {
        code: "ENOENT",
      });
    });
});

it("refuses an output location outside the owned build directory", async (context) => {
  const { root, installation } = await buildFixture(context);
  const configPath = join(installation, "tsconfig.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.compilerOptions.outDir = "../outside";
  await writeFile(configPath, JSON.stringify(config));
  const outside = join(root, "outside");
  await mkdir(outside);
  const sentinel = join(outside, "sentinel.txt");
  await writeFile(sentinel, "protected external file\n");

  assertBuildRefused(installation);
  assert.equal(await readFile(sentinel, "utf8"), "protected external file\n");
  await assert.rejects(lstat(join(outside, "src/entry.js")), {
    code: "ENOENT",
  });
});

async function buildFixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "academic-build-provenance-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const installation = join(root, "installation");
  await mkdir(join(installation, "src"), { recursive: true });
  await mkdir(join(installation, "test/build"), { recursive: true });
  for (const name of ["package.json", "tsconfig.json", "scripts"])
    await cp(name, join(installation, name), { recursive: true });
  await symlink(
    resolve("node_modules"),
    join(installation, "node_modules"),
    "junction",
  );
  await writeFile(
    join(installation, "src/entry.ts"),
    'export const value = "current";\n',
  );
  await writeFile(
    join(installation, "source-sentinel.txt"),
    "outside the compiler output\n",
  );
  return { root, installation };
}

function assertBuildRefused(installation: string) {
  const result = run({
    cwd: installation,
    program: "npm",
    args: ["run", "build"],
    expectedStatus: 1,
  });
  assert.match(result.stderr, /Refusing to clean build output/u);
}

function run(input: {
  cwd: string;
  program: string;
  args: string[];
  expectedStatus?: number;
}) {
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  const result = spawnSync(input.program, input.args, {
    cwd: input.cwd,
    env: environment,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(
    result.status,
    input.expectedStatus ?? 0,
    result.stdout + result.stderr,
  );
  return result;
}
