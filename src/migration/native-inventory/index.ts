import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  assembleNativeInventory,
  inventoryLimits,
  sha256,
} from "./assemble.js";
import { helperBinding } from "./native/helper-binding.js";
import { validateScanRecord } from "./schema.js";
import type { NativeScanRecord } from "./generated/native-scan-record-1.js";

export type {
  NativeInventory,
  NativeInventoryEntry,
} from "./generated/native-inventory-1.js";

const legacySingleFileSourceSha256 =
  "0927868fce1f26a78232eca216b3b9d27f56686e86b982c3ae440b5fe37d2b33";

async function boundHelperSources(): Promise<boolean> {
  const directory = new URL("./native/", import.meta.url);
  const formatter = sha256(await readFile(new URL("scan.c", directory)));
  if (formatter !== helperBinding.sourceSha256) return false;
  if (helperBinding.encoding === undefined)
    return formatter === legacySingleFileSourceSha256;
  if (helperBinding.encoding !== "academic-os-native-inventory-helper/2")
    return false;
  const expected = ["scan.c", "scan-core.c", "scan-core.h"];
  if (
    helperBinding.sourceFiles.length !== expected.length ||
    helperBinding.sourceFiles.some(
      (source, index) => source.path !== expected[index],
    )
  )
    return false;
  return (
    await Promise.all(
      helperBinding.sourceFiles.map(
        async (source) =>
          sha256(await readFile(new URL(source.path, directory))) ===
          source.sha256,
      ),
    )
  ).every(Boolean);
}

export async function inventoryNativeRoot(root: string) {
  const requested = resolve(root);
  const adapter = {
    platform: process.platform,
    sourceSha256: helperBinding.sourceSha256,
    executableSha256: helperBinding.executableSha256 ?? null,
  };
  const common = {
    rootPathHex: Buffer.from(requested).toString("hex"),
    adapter,
  };
  const records: NativeScanRecord[] = [];
  if (process.platform !== "darwin" || !helperBinding.available)
    return assembleNativeInventory({
      ...common,
      records,
      failure: "unsupported-platform",
    });
  try {
    if (
      helperBinding.platform !== process.platform ||
      helperBinding.architecture !== process.arch
    )
      return assembleNativeInventory({
        ...common,
        records,
        failure: "invalid-adapter-binding",
      });
    const executable = new URL("./native/scan.native", import.meta.url);
    if (
      !(await boundHelperSources()) ||
      sha256(await readFile(executable)) !== helperBinding.executableSha256
    )
      return assembleNativeInventory({
        ...common,
        records,
        failure: "invalid-adapter-binding",
      });
    const { stdout } = await promisify(execFile)(
      fileURLToPath(executable),
      [requested],
      {
        encoding: "utf8",
        maxBuffer: inventoryLimits.outputBytes,
        timeout: 120000,
        killSignal: "SIGKILL",
        env: { PATH: "/usr/bin:/bin" },
      },
    );
    for (const line of stdout.split("\n")) {
      if (line === "") continue;
      const value: unknown = JSON.parse(line);
      if (!validateScanRecord(value))
        return assembleNativeInventory({
          ...common,
          records: [],
          failure: "invalid-adapter-output",
        });
      records.push(value);
    }
    const report = assembleNativeInventory({ ...common, records });
    if (
      Buffer.byteLength(JSON.stringify(report, null, 2)) + 1 >
      inventoryLimits.outputBytes
    )
      return assembleNativeInventory({
        ...common,
        records: [],
        failure: "inventory-result-limit",
      });
    return report;
  } catch {
    return assembleNativeInventory({
      ...common,
      records: [],
      failure: "adapter-unavailable-or-limit",
    });
  }
}
