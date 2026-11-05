import { readFile } from "node:fs/promises";
import { sha256Bytes } from "../checksum.js";
import { decodeCheatsheetText } from "./exact-text.js";
import { resolveModuleFile } from "./module-path.js";
import type { CheatsheetAuthoringAuthority } from "./types.js";

export interface CheatsheetConstructionFile {
  path: string;
  sha256: string;
}
export interface CheatsheetConstructionProvenance {
  recipe: CheatsheetConstructionFile;
  inputs: CheatsheetConstructionFile[];
  baseTexSha256: string;
  outputTexSha256: string;
}

function mapping(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${name} must be a mapping.`);
  return value as Record<string, unknown>;
}
function digest(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))
    throw new Error(`${name} must be a lowercase SHA-256 digest.`);
  return value;
}
function file(value: unknown, name: string): CheatsheetConstructionFile {
  const item = mapping(value, name);
  if (
    typeof item.path !== "string" ||
    item.path.includes("\\") ||
    item.path
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  )
    throw new Error(`${name}.path must be a normalized module-relative path.`);
  return { path: item.path, sha256: digest(item.sha256, `${name}.sha256`) };
}
export function parseCheatsheetConstruction(
  value: unknown,
): CheatsheetConstructionProvenance {
  const construction = mapping(value, "authoring.construction");
  const recipe = file(construction.recipe, "authoring.construction.recipe");
  if (!Array.isArray(construction.inputs) || construction.inputs.length === 0)
    throw new Error("authoring.construction.inputs must name ordered inputs.");
  const paths = new Set([recipe.path]);
  const inputs = construction.inputs.map((input, index) => {
    const parsed = file(input, `authoring.construction.inputs[${index}]`);
    if (paths.has(parsed.path))
      throw new Error(`Construction repeats ${parsed.path}.`);
    paths.add(parsed.path);
    return parsed;
  });
  return {
    recipe,
    inputs,
    baseTexSha256: digest(
      construction.base_tex_sha256,
      "authoring.construction.base_tex_sha256",
    ),
    outputTexSha256: digest(
      construction.output_tex_sha256,
      "authoring.construction.output_tex_sha256",
    ),
  };
}

export function constructionFor(
  authoring: CheatsheetAuthoringAuthority,
): CheatsheetConstructionProvenance | undefined {
  if (!("construction" in authoring) || authoring.construction === undefined)
    return undefined;
  if (authoring.kind !== "self-contained")
    throw new Error(
      "Construction provenance is only valid for self-contained authority.",
    );
  // Parsed manifests use camelCase; the runtime boundary remains validated in manifest.ts.
  const candidate = mapping(authoring.construction, "authoring.construction");
  return parseCheatsheetConstruction({
    ...candidate,
    base_tex_sha256: candidate.baseTexSha256,
    output_tex_sha256: candidate.outputTexSha256,
  });
}

export async function proveCheatsheetConstruction(
  moduleRoot: string,
  construction: CheatsheetConstructionProvenance,
): Promise<void> {
  for (const input of [construction.recipe, ...construction.inputs]) {
    const bytes = await readFile(
      await resolveModuleFile(moduleRoot, input.path),
    );
    if (sha256Bytes(bytes) !== input.sha256)
      throw new Error(
        `Construction input ${input.path} no longer matches its declared SHA-256.`,
      );
  }
}

export async function checkCheatsheetRegenerationCandidate(input: {
  moduleRoot: string;
  authoring: Extract<CheatsheetAuthoringAuthority, { kind: "self-contained" }>;
  candidatePath: string;
  construction: CheatsheetConstructionProvenance;
}): Promise<{
  baseTexSha256: string;
  candidateTexSha256: string;
  review: "unreviewed";
  published: false;
}> {
  if (
    !input.candidatePath.startsWith(".scratch/cheatsheets/") ||
    input.candidatePath
      .split("/")
      .some(
        (segment) => segment === "" || segment === "." || segment === "..",
      ) ||
    input.candidatePath === input.authoring.path
  )
    throw new Error(
      "Regeneration candidate must be staged under .scratch/cheatsheets/; the authoritative release is never overwritten.",
    );
  const release = await readFile(
    await resolveModuleFile(input.moduleRoot, input.authoring.path),
  );
  const baseTexSha256 = sha256Bytes(release);
  if (
    baseTexSha256 !== input.authoring.sha256 ||
    baseTexSha256 !== input.construction.baseTexSha256
  )
    throw new Error(
      "Authoritative release changed; reconcile its exact bytes before regeneration.",
    );
  await proveCheatsheetConstruction(input.moduleRoot, input.construction);
  const candidate = await readFile(
    await resolveModuleFile(input.moduleRoot, input.candidatePath),
  );
  decodeCheatsheetText(candidate, input.candidatePath);
  const candidateTexSha256 = sha256Bytes(candidate);
  if (candidateTexSha256 !== input.construction.outputTexSha256)
    throw new Error(
      "Staged candidate does not match construction output identity.",
    );
  return {
    baseTexSha256,
    candidateTexSha256,
    review: "unreviewed",
    published: false,
  };
}
