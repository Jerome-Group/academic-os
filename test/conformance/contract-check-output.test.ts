import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

test("failed contract checks flush large diagnostics before returning failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "contract-output-"));
  try {
    const fixture = join(root, "synthetic-failure.test.mjs");
    await writeFile(
      fixture,
      "import {test} from 'node:test'; test('bounded diagnostic fixture',()=>{console.log('x'.repeat(200_000));throw new Error('SYNTHETIC_FAILURE_DIAGNOSTIC_END');});\n",
    );
    const helper = new URL(
      "../../../scripts/check-contract-tests.mjs",
      import.meta.url,
    );
    let failed = false;
    try {
      await promisify(execFile)(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import {runPassingTests} from ${JSON.stringify(helper.href)}; await runPassingTests([${JSON.stringify(fixture)}]);`,
        ],
        { timeout: 10_000, maxBuffer: 1024 * 1024 },
      );
    } catch (error) {
      const result = error as Error & {
        code: number;
        stdout: string;
        stderr: string;
      };
      assert.equal(result.code, 1);
      assert.ok(result.stdout.length > 200_000);
      assert.match(result.stdout, /SYNTHETIC_FAILURE_DIAGNOSTIC_END/u);
      assert.match(result.stdout, /fail 1/u);
      failed = true;
    }
    assert.equal(failed, true, "Synthetic test must fail visibly.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
