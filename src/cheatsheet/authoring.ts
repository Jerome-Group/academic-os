import { readFile } from "node:fs/promises";
import { sha256 } from "../checksum.js";
import { resolveModuleFile } from "./module-path.js";
import type { CheatsheetAuthoringAuthority } from "./types.js";

async function provedText(
  root: string,
  path: string,
  digest: string,
): Promise<string> {
  const body = await readFile(resolveModuleFile(root, path), "utf8");
  if (sha256(body) !== digest) {
    throw new Error(`${path} no longer matches its declared SHA-256.`);
  }
  return body;
}

export async function buildCheatsheetReleaseSource(input: {
  moduleRoot: string;
  authoring: CheatsheetAuthoringAuthority;
}): Promise<{ source: string; sha256: string; inputs: string[] }> {
  if (input.authoring.kind === "self-contained") {
    const source = await provedText(
      input.moduleRoot,
      input.authoring.path,
      input.authoring.sha256,
    );
    return {
      source,
      sha256: sha256(source),
      inputs: [input.authoring.path],
    };
  }
  const fragments = await Promise.all(
    input.authoring.fragments.map(async (fragment) => ({
      path: fragment.path,
      body: await provedText(input.moduleRoot, fragment.path, fragment.sha256),
    })),
  );
  const source = `${fragments.map(({ body }) => body.trimEnd()).join("\n\n")}\n`;
  return {
    source,
    sha256: sha256(source),
    inputs: fragments.map(({ path }) => path),
  };
}
