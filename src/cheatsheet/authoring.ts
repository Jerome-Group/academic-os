import { sha256Bytes } from "../checksum.js";
import {
  constructionFor,
  proveCheatsheetConstruction,
} from "./construction.js";
import { readCheatsheetModuleText } from "./exact-text.js";
import type { CheatsheetAuthoringAuthority } from "./types.js";

async function provedText(root: string, path: string, digest: string) {
  const read = await readCheatsheetModuleText(root, path);
  if (read.sha256 !== digest)
    throw new Error(`${path} no longer matches its declared SHA-256.`);
  return read;
}

export async function buildCheatsheetReleaseSource(input: {
  moduleRoot: string;
  authoring: CheatsheetAuthoringAuthority;
}): Promise<{
  source: string;
  bytes: Uint8Array;
  sha256: string;
  inputs: string[];
}> {
  if (input.authoring.kind === "self-contained") {
    const read = await provedText(
      input.moduleRoot,
      input.authoring.path,
      input.authoring.sha256,
    );
    const construction = constructionFor(input.authoring);
    if (construction !== undefined) {
      if (construction.outputTexSha256 !== read.sha256)
        throw new Error(
          "Construction output differs from the authoritative release.",
        );
      await proveCheatsheetConstruction(input.moduleRoot, construction);
    }
    return {
      source: read.text,
      bytes: read.bytes,
      sha256: read.sha256,
      inputs: [input.authoring.path],
    };
  }
  const fragments = await Promise.all(
    input.authoring.fragments.map(async (fragment) => ({
      path: fragment.path,
      ...(await provedText(input.moduleRoot, fragment.path, fragment.sha256)),
    })),
  );
  const source = `${fragments.map(({ text }) => text.trimEnd()).join("\n\n")}\n`;
  const bytes = Buffer.from(source, "utf8");
  return {
    source,
    bytes,
    sha256: sha256Bytes(bytes),
    inputs: fragments.map(({ path }) => path),
  };
}
