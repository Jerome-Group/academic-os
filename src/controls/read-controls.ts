import { posix, win32 } from "node:path";
import { isRecord } from "../conformance/value-shape.js";
import { byteSha256, controlEvidence } from "./evidence.js";
import { readLegacyModuleControls } from "./legacy/read-module-controls.js";
import {
  generationSchemaId,
  headSchemaId,
  identitySchemaId,
  schemaDiagnostics,
  validateGeneration,
  validateHead,
  validateIdentity,
} from "./schema-registry.js";
import { readStrictJson } from "./strict-json.js";
import {
  diagnostic,
  type ControlDiagnostic,
  type ControlObservation,
  type ControlRead,
  type ControlReadInput,
} from "./types.js";

export const moduleHeadPath = "00 Module Admin/00 Module.json";

export function readControls(input: ControlReadInput): ControlRead {
  const evidence = controlEvidence(input.files);
  const duplicates = input.files.filter(
    (file, index) =>
      input.files.findIndex((other) => other.path === file.path) !== index,
  );
  if (duplicates.length)
    return {
      kind: "unsupported",
      shape: { kind: "unsupported", detected: "conflicting-observations" },
      evidence,
      coverage: "no-supported-read",
      diagnostics: duplicates.map((file) =>
        diagnostic(
          "conflicting-observations",
          file.path,
          "Multiple observations claim the same path.",
          "Collect one coherent observation per exact relative path and retry.",
        ),
      ),
    };
  const headObservation = input.files.find(
    (file) => file.path === moduleHeadPath,
  );
  if (headObservation === undefined) return readLegacyModuleControls(input);
  const diagnostics: ControlDiagnostic[] = [];
  const refuse = (): ControlRead => ({
    kind: "unsupported",
    shape: { kind: "unsupported", detected: "canonical" },
    evidence,
    diagnostics,
    coverage: "no-supported-read",
  });
  const headValue = decode(headObservation, headSchemaId, diagnostics);
  if (!validateHead(headValue)) {
    diagnostics.push(...schemaDiagnostics(validateHead, moduleHeadPath));
    return refuse();
  }
  const head = headValue;
  if (head.moduleCode !== input.moduleCode)
    diagnostics.push(
      identityConflict(
        moduleHeadPath,
        "moduleCode does not match the observed target.",
      ),
    );
  const generationRoot = `.academic-os/control-generations/${head.generation.id}`;
  const generationPath = `${generationRoot}/generation.json`;
  if (head.generation.file !== generationPath)
    diagnostics.push(
      diagnostic(
        "invalid-generation-path",
        moduleHeadPath,
        "Head generation path must select its exact immutable generation.json.",
        `Use ${generationPath}.`,
        "/generation/file",
      ),
    );
  if (head.generation.schema !== generationSchemaId)
    diagnostics.push(unsupportedSchema(moduleHeadPath, head.generation.schema));
  if (diagnostics.length) return refuse();
  const generationObservation = referenced(
    input.files,
    generationPath,
    head.generation.byteSha256,
    diagnostics,
  );
  const generationValue =
    generationObservation === undefined
      ? undefined
      : decode(generationObservation, generationSchemaId, diagnostics);
  if (!validateGeneration(generationValue)) {
    diagnostics.push(...schemaDiagnostics(validateGeneration, generationPath));
    return refuse();
  }
  const generation = generationValue;
  if (
    generation.module !== head.module ||
    generation.moduleCode !== head.moduleCode ||
    generation.generationId !== head.generation.id
  )
    diagnostics.push(
      identityConflict(
        generationPath,
        "Generation identity conflicts with the selected head.",
      ),
    );
  const controls: Extract<
    ControlRead,
    { kind: "canonical" }
  >["controls"][number][] = [];
  const roles = new Set<string>();
  const paths = new Set<string>();
  for (const ref of generation.controls) {
    if (!safeRelativePath(ref.file) || ref.file === "generation.json") {
      diagnostics.push(
        diagnostic(
          "unsafe-control-path",
          generationPath,
          `Unsafe generation control path ${JSON.stringify(ref.file)}.`,
          "Use a normalized relative file path inside the selected generation, without links, dot segments or backslashes.",
        ),
      );
      continue;
    }
    const path = `${generationRoot}/${ref.file}`;
    if (roles.has(ref.role) || paths.has(path)) {
      diagnostics.push(
        diagnostic(
          "conflicting-control-identity",
          generationPath,
          "A control role or path is declared more than once.",
          "Give each control one unique role and path in the immutable generation.",
        ),
      );
      continue;
    }
    roles.add(ref.role);
    paths.add(path);
    if (ref.schema !== identitySchemaId) {
      diagnostics.push(unsupportedSchema(path, ref.schema));
      continue;
    }
    if (ref.role !== "module-identity") {
      diagnostics.push(
        diagnostic(
          "unsupported-control-role",
          path,
          `Schema ${ref.schema} cannot fulfill role ${ref.role}.`,
          "Use module-identity for the supported identity read; other control readers remain unimplemented.",
        ),
      );
      continue;
    }
    const file = referenced(input.files, path, ref.byteSha256, diagnostics);
    const value =
      file === undefined ? undefined : decode(file, ref.schema, diagnostics);
    if (!validateIdentity(value)) {
      diagnostics.push(...schemaDiagnostics(validateIdentity, path));
      continue;
    }
    if (value.module !== head.module || value.moduleCode !== head.moduleCode)
      diagnostics.push(
        identityConflict(
          path,
          "Control identity conflicts with the selected head.",
        ),
      );
    controls.push({ role: "module-identity", path, value });
  }
  if (!roles.has("module-identity"))
    diagnostics.push(
      diagnostic(
        "missing-identity-control",
        generationPath,
        "Generation lacks a module-identity control.",
        "Bind an exact identity control before claiming a supported canonical read.",
      ),
    );
  if (diagnostics.length) return refuse();
  return {
    kind: "canonical",
    shape: { kind: "canonical", head, generation },
    evidence,
    controls,
    diagnostics,
    coverage: "incomplete-module-contract",
    unsupportedReads: [
      "definition",
      "profile",
      "source-map",
      "learning-records",
      "workflows",
      "module-conformance",
      "migration-readiness",
    ],
  };
}

function decode(
  file: ControlObservation,
  expectedSchema: string,
  diagnostics: ControlDiagnostic[],
): unknown {
  if (file.kind === "unreadable") {
    diagnostics.push(
      diagnostic(
        "unreadable-canonical-control",
        file.path,
        file.reason,
        "Restore a safe regular UTF-8 file at this exact path; canonical state cannot fall back to legacy.",
      ),
    );
    return undefined;
  }
  const parsed = readStrictJson(file.bytes, file.path);
  if (parsed.kind === "invalid") {
    diagnostics.push(...parsed.diagnostics);
    return undefined;
  }
  if (isRecord(parsed.value) && parsed.value.$schema !== expectedSchema)
    diagnostics.push(
      unsupportedSchema(file.path, String(parsed.value.$schema)),
    );
  return parsed.value;
}

function referenced(
  files: readonly ControlObservation[],
  path: string,
  expectedHash: string,
  diagnostics: ControlDiagnostic[],
): ControlObservation | undefined {
  const file = files.find((file) => file.path === path);
  if (file === undefined) {
    diagnostics.push(
      diagnostic(
        "missing-canonical-reference",
        path,
        "Selected canonical file is absent.",
        "Restore the exact referenced immutable bytes or select a complete generation explicitly; do not fall back to legacy.",
      ),
    );
    return undefined;
  }
  if (file.kind === "file" && byteSha256(file.bytes) !== expectedHash)
    diagnostics.push(
      diagnostic(
        "canonical-hash-mismatch",
        path,
        `Expected byte SHA256 ${expectedHash}; observed ${byteSha256(file.bytes)}.`,
        "Restore the referenced bytes or publish a separately verified generation; never edit the selected immutable generation in place.",
      ),
    );
  return file;
}

function identityConflict(path: string, message: string): ControlDiagnostic {
  return diagnostic(
    "canonical-identity-conflict",
    path,
    message,
    "Resolve the aggregate and target identity conflict explicitly before reading controls.",
  );
}
function unsupportedSchema(path: string, schema: string): ControlDiagnostic {
  return diagnostic(
    "unsupported-control-schema",
    path,
    `Unsupported referenced schema ${JSON.stringify(schema)}.`,
    "Use a schema supported by this installed reader or install a reviewed compatible reader; legacy fallback is disabled.",
  );
}
export function safeRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !win32.isAbsolute(path) &&
    !posix.isAbsolute(path) &&
    path
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}
