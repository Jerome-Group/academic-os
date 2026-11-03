import { readFile } from "node:fs/promises";
import { sha256Bytes } from "../checksum.js";
import { resolveModuleFile } from "./module-path.js";

export function decodeCheatsheetText(bytes: Uint8Array, name: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new Error(
      `${name} must contain valid UTF-8; replacement decoding is forbidden.`,
    );
  }
}

export async function readCheatsheetModuleText(
  moduleRoot: string,
  path: string,
) {
  const bytes = await readFile(await resolveModuleFile(moduleRoot, path));
  return {
    bytes,
    text: decodeCheatsheetText(bytes, path),
    sha256: sha256Bytes(bytes),
  };
}
