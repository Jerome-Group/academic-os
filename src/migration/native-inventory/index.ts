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
    const source = new URL("./native/scan.c", import.meta.url);
    if (
      sha256(await readFile(source)) !== helperBinding.sourceSha256 ||
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
    return assembleNativeInventory({ ...common, records });
  } catch {
    return assembleNativeInventory({
      ...common,
      records: [],
      failure: "adapter-unavailable-or-limit",
    });
  }
}
