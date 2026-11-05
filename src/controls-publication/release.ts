import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isRecord } from "../conformance/value-shape.js";
import { readStrictJson } from "../controls/strict-json.js";
import { digest, sha256 } from "./codec.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
export const runtimeDirectory =
  basename(moduleDirectory) === "controls-publication" &&
  basename(dirname(moduleDirectory)) === "src" &&
  basename(dirname(dirname(moduleDirectory))) === "dist"
    ? resolve(moduleDirectory, "../../..")
    : moduleDirectory;

export async function publicationRelease(): Promise<string> {
  const manifestBytes = await readFile(
    new URL("./release.json", import.meta.url),
  );
  const parsed = readStrictJson(manifestBytes, "publication-release");
  if (parsed.kind !== "read" || !isRecord(parsed.value))
    throw new Error("Missing supported publication release manifest.");
  const manifest = parsed.value;
  if (
    manifest.encoding !== "academic-os-publication-release/1" ||
    typeof manifest.sourceDigest !== "string" ||
    typeof manifest.nativeDigest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(manifest.sourceDigest) ||
    !/^[a-f0-9]{64}$/u.test(manifest.nativeDigest)
  )
    throw new Error("Unsupported publication release manifest.");
  const native = await readFile(
    new URL("./native/publication-native.node", import.meta.url),
  );
  if (sha256(native) !== manifest.nativeDigest)
    throw new Error("Publication native artifact differs from this release.");
  return digest(manifest);
}
