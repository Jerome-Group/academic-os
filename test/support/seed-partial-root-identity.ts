import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  seedMountedModule,
  seedMountedResearchProject,
} from "../../src/mounted/index.js";

type SeedInput =
  | {
      kind: "module";
      config: Parameters<typeof seedMountedModule>[0];
      plan: Parameters<typeof seedMountedModule>[1];
    }
  | {
      kind: "research-project";
      config: Parameters<typeof seedMountedResearchProject>[0];
      plan: Parameters<typeof seedMountedResearchProject>[1];
    };

export async function assertSeedPartialRootIdentity(
  input: SeedInput & { targetRoot: string },
): Promise<void> {
  const execution = promisify(execFile)(process.execPath, [
    "--input-type=module",
    "--eval",
    `
import assert from "node:assert/strict";
import filesystem from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { text } from "node:stream/consumers";
import { seedMountedModule, seedMountedResearchProject } from ${JSON.stringify(new URL("../../src/mounted/index.js", import.meta.url).href)};

const { kind, config, plan, targetRoot } = JSON.parse(await text(process.stdin));
await filesystem.mkdir(targetRoot);
const canonicalTarget = await filesystem.realpath(targetRoot);
const originalLstat = filesystem.lstat;
const inode = 9007199254740993n;
const observed = new Set();
filesystem.lstat = async (path, options) => {
  const metadata = await originalLstat(path, options);
  if (String(path) === canonicalTarget) {
    const representation = typeof metadata.ino;
    observed.add(representation);
    metadata.ino = representation === "bigint" ? inode : Number(inode);
  }
  return metadata;
};
syncBuiltinESMExports();
try {
  const seed = kind === "module" ? seedMountedModule : seedMountedResearchProject;
  const report = await seed(config, plan, "apply");
  assert.deepEqual([...observed].sort(), ["bigint", "number"]);
  assert.equal(report.outcome, "completed", report.evidence.join("\\n"));
  const repeated = await seed(config, plan, "apply", { resume: true });
  assert.equal(repeated.outcome, "completed", repeated.evidence.join("\\n"));
  assert.deepEqual(repeated.operations, []);
} finally {
  filesystem.lstat = originalLstat;
  syncBuiltinESMExports();
}
`,
  ]);
  execution.child.stdin?.end(JSON.stringify(input));
  await execution;
}
