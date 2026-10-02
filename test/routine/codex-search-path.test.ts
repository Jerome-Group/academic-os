import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { afterEach, it } from "node:test";

import { sessionSpawnOptions } from "../../src/routine/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function executable(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "#!/bin/sh\nprintf 'synthetic-search-helper\\n'\n", {
    mode: 0o700,
  });
}

async function fixture(layout: "nested" | "flat" | "wrapper" = "nested") {
  const root = await mkdtemp(join(tmpdir(), "academic-codex-path-"));
  roots.push(root);
  const packageRoot = join(root, "codex-cli");
  const codexPath =
    layout === "flat"
      ? join(root, "flat", "codex")
      : layout === "wrapper"
        ? join(packageRoot, "bin", "codex")
        : join(packageRoot, "CodexCLI.app", "Contents", "MacOS", "codex");
  await executable(codexPath);
  const inheritedPath = join(root, "empty-inherited-path");
  await mkdir(inheritedPath);
  const helperDirectory =
    layout === "flat" ? dirname(codexPath) : join(packageRoot, "codex-path");
  await executable(join(helperDirectory, "rg"));
  const manifestPath = join(packageRoot, "codex-package.json");
  const manifest = {
    layoutVersion: 1,
    variant: "codex",
    entrypoint: "bin/codex",
    pathDir: "codex-path",
  };
  if (layout !== "flat")
    await writeFile(manifestPath, JSON.stringify(manifest));
  return {
    root,
    packageRoot,
    codexPath,
    inheritedPath,
    helperDirectory,
    manifestPath,
    manifest,
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

function productionOptions(input: Fixture) {
  const previous = process.env.PATH;
  process.env.PATH = input.inheritedPath;
  try {
    return sessionSpawnOptions({
      codexPath: input.codexPath,
      moduleRoot: input.root,
      timeoutMs: 1000,
    });
  } finally {
    if (previous === undefined) delete process.env.PATH;
    else process.env.PATH = previous;
  }
}

for (const layout of ["nested", "flat", "wrapper"] as const) {
  it(`runs the search helper through production spawn options with a ${layout} installation and hermetic PATH`, async () => {
    const input = await fixture(layout);
    const options = productionOptions(input);
    const result = spawnSync("rg", ["--version"], {
      ...options,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "synthetic-search-helper\n");
    assert.equal(options.env.PATH?.split(delimiter)[0], input.helperDirectory);
    assert.ok(
      options.env.PATH?.split(delimiter).includes(dirname(input.codexPath)),
    );
    assert.equal(
      options.env.PATH?.split(delimiter).at(-1),
      input.inheritedPath,
    );
  });
}

const invalidEvidence: [string, (input: Fixture) => Promise<void>][] = [
  [
    "missing metadata",
    async (input) => {
      await rm(input.manifestPath);
    },
  ],
  [
    "malformed metadata",
    async (input) => {
      await writeFile(input.manifestPath, "{");
    },
  ],
  [
    "unsupported layout",
    async (input) => {
      await writeFile(
        input.manifestPath,
        JSON.stringify({ ...input.manifest, layoutVersion: 2 }),
      );
    },
  ],
  [
    "different variant",
    async (input) => {
      await writeFile(
        input.manifestPath,
        JSON.stringify({ ...input.manifest, variant: "untrusted" }),
      );
    },
  ],
  [
    "different entrypoint",
    async (input) => {
      await writeFile(
        input.manifestPath,
        JSON.stringify({ ...input.manifest, entrypoint: "other/codex" }),
      );
    },
  ],
  [
    "absolute helper directory",
    async (input) => {
      await writeFile(
        input.manifestPath,
        JSON.stringify({ ...input.manifest, pathDir: input.helperDirectory }),
      );
    },
  ],
  [
    "escaping helper directory",
    async (input) => {
      await executable(join(input.root, "external", "rg"));
      await writeFile(
        input.manifestPath,
        JSON.stringify({ ...input.manifest, pathDir: "../external" }),
      );
    },
  ],
  [
    "PATH delimiter injection",
    async (input) => {
      await writeFile(
        input.manifestPath,
        JSON.stringify({
          ...input.manifest,
          pathDir: `codex-path${delimiter}external`,
        }),
      );
    },
  ],
  [
    "missing helper",
    async (input) => {
      await rm(join(input.helperDirectory, "rg"));
    },
  ],
  [
    "nonexecutable helper",
    async (input) => {
      await chmod(join(input.helperDirectory, "rg"), 0o600);
    },
  ],
  [
    "symlink helper",
    async (input) => {
      const target = join(input.root, "external-rg");
      await executable(target);
      await rm(join(input.helperDirectory, "rg"));
      await symlink(target, join(input.helperDirectory, "rg"));
    },
  ],
  [
    "symlink helper directory",
    async (input) => {
      const target = join(input.root, "external");
      await executable(join(target, "rg"));
      await rm(input.helperDirectory, { recursive: true });
      await symlink(target, input.helperDirectory);
    },
  ],
  [
    "symlink metadata",
    async (input) => {
      const target = join(input.root, "external-manifest.json");
      await writeFile(target, JSON.stringify(input.manifest));
      await rm(input.manifestPath);
      await symlink(target, input.manifestPath);
    },
  ],
];

for (const [name, change] of invalidEvidence) {
  it(`refuses to add an untrusted package directory with ${name}`, async () => {
    const input = await fixture();
    await change(input);
    await executable(join(input.packageRoot, "rg"));
    const options = productionOptions(input);
    assert.equal(
      options.env.PATH,
      [dirname(input.codexPath), input.inheritedPath].join(delimiter),
    );
    const result = spawnSync("rg", ["--version"], {
      ...options,
      encoding: "utf8",
    });
    assert.equal(
      (result.error as NodeJS.ErrnoException | undefined)?.code,
      "ENOENT",
    );
  });
}

it("does not search arbitrary ancestors for package metadata", async () => {
  const input = await fixture();
  const codexPath = join(input.packageRoot, "unrelated", "codex");
  await executable(codexPath);
  const options = productionOptions({ ...input, codexPath });
  assert.equal(
    options.env.PATH,
    [dirname(codexPath), input.inheritedPath].join(delimiter),
  );
});
