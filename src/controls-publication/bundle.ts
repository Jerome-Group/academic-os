import type { ModuleDataGeneration } from "../controls/generated/control-generation-2.js";
import type { ModuleDataControl } from "../controls/generated/module-data-1.js";
import type { ModuleHead } from "../controls/generated/module-head-1.js";
import type { ModuleIdentity } from "../controls/generated/module-identity-1.js";
import {
  moduleHeadPath,
  readControls,
  safeRelativePath,
} from "../controls/read-controls.js";
import {
  headSchemaId,
  identitySchemaId,
  moduleDataGenerationSchemaId,
  moduleDataSchemaId,
  validateIdentity,
  validateModuleData,
} from "../controls/schema-registry.js";
import { digest, encodePublication, freezeBytes, thawBytes } from "./codec.js";
import type {
  ModuleAggregate,
  PlannedFile,
  PublicationBundle,
} from "./generated/publication-contract-1.js";
import { requireFileBytes, requireInputBytes } from "./limits.js";
import { parseBytes, validateBundle } from "./schema.js";

export function moduleAggregate(identity: ModuleIdentity): ModuleAggregate {
  return {
    kind: "module",
    module: identity.module,
    moduleCode: identity.moduleCode,
  };
}

export function decodeIdentity(bytes: Uint8Array): ModuleIdentity {
  return parseBytes(bytes, validateIdentity);
}

export function decodeBundle(
  bytes: Uint8Array,
  aggregate: ModuleAggregate,
): PublicationBundle {
  requireInputBytes(bytes);
  const bundle = parseBytes(bytes, validateBundle);
  const roles = new Set<string>();
  const paths = new Set<string>(["generation.json"]);
  const values: ModuleDataControl[] = [];
  for (const control of bundle.controls) {
    if (
      !safeRelativePath(control.file) ||
      roles.has(control.role) ||
      paths.has(control.file)
    )
      throw new Error(
        "Duplicate control role or unsafe/conflicting control path.",
      );
    roles.add(control.role);
    paths.add(control.file);
    requireFileBytes(control.bytes.byteLength);
    const raw = thawBytes(control.bytes);
    const value =
      control.role === "module-identity"
        ? decodeIdentity(raw)
        : parseBytes(raw, validateModuleData);
    if (
      value.module !== aggregate.module ||
      value.moduleCode !== aggregate.moduleCode
    )
      throw new Error("Control identity differs from the admitted aggregate.");
    if ("role" in value) {
      if (value.role !== control.role)
        throw new Error("Control role differs from its binding.");
      values.push(value);
    }
  }
  for (const path of paths)
    if (
      [...paths].some((other) => other !== path && other.startsWith(`${path}/`))
    )
      throw new Error("Control paths conflict as a file and directory.");
  const artifacts = values.find((value) => value.role === "artifacts");
  if (
    artifacts?.role !== "artifacts" ||
    artifacts.artifacts.length ||
    artifacts.sources.length
  )
    throw new Error(
      "Native artifacts and sources have no admitted byte source.",
    );
  const dependencies = new Map<
    string,
    PublicationBundle["dependencies"][number]
  >();
  for (const dependency of bundle.dependencies) {
    requireFileBytes(dependency.bytes.byteLength);
    const raw = thawBytes(dependency.bytes);
    if (
      dependency.path !==
      `.academic-os/retained-inputs/${dependency.bytes.byteSha256}`
    )
      throw new Error(
        "Dependency must use its immutable module-relative hash path.",
      );
    const prior = dependencies.get(dependency.path);
    if (prior && digest(prior.bytes) !== digest(dependency.bytes))
      throw new Error("Conflicting dependency bytes.");
    dependencies.set(dependency.path, dependency);
    if (raw.byteLength !== dependency.bytes.byteLength)
      throw new Error("Dependency length mismatch.");
  }
  const used = new Set<PublicationBundle["dependencies"][number]>();
  for (const control of values) {
    if (control.role === "evidence")
      for (const entry of control.entries) {
        if (entry.locator.kind === "module-file")
          throw new Error("Module-file evidence is not admitted.");
        if (entry.locator.kind !== "retained-original") {
          if (entry.content.kind === "known")
            throw new Error(
              "Known evidence hash requires retained byte evidence.",
            );
          continue;
        }
        const locator = entry.locator;
        const dependency = bundle.dependencies.find(
          (item) =>
            item.kind === "retained-original" &&
            item.evidenceId === entry.id &&
            item.path === locator.path,
        );
        if (
          !dependency ||
          dependency.bytes.byteLength !== entry.locator.byteLength ||
          dependency.bytes.byteSha256 !== entry.locator.byteSha256
        )
          throw new Error(
            "Retained-original evidence bytes are missing or differ.",
          );
        if (
          entry.content.kind === "known" &&
          entry.content.value !== dependency.bytes.byteSha256
        )
          throw new Error("Evidence content hash differs from retained bytes.");
        used.add(dependency);
      }
    if (control.role === "preferences") {
      const shared = control.sharedBundle;
      const dependency = bundle.dependencies.find(
        (item) =>
          item.kind === "shared-preferences" &&
          item.id === shared.id &&
          item.version === shared.version &&
          item.bytes.byteSha256 === shared.byteSha256,
      );
      if (!dependency) throw new Error("Shared preferences bytes are missing.");
      used.add(dependency);
    }
  }
  if (used.size !== bundle.dependencies.length)
    throw new Error("Unreferenced or duplicate dependency binding.");
  return bundle;
}

export function generationFiles(
  bundle: PublicationBundle,
  aggregate: ModuleAggregate,
  generationId: string,
): PlannedFile[] {
  const root = `.academic-os/control-generations/${generationId}`;
  const generation: ModuleDataGeneration = {
    $schema: moduleDataGenerationSchemaId,
    schemaVersion: 2,
    module: aggregate.module,
    moduleCode: aggregate.moduleCode,
    generationId,
    controls: bundle.controls.map((control) => ({
      file: control.file,
      role: control.role,
      schema:
        control.role === "module-identity"
          ? identitySchemaId
          : moduleDataSchemaId,
      byteSha256: control.bytes.byteSha256,
    })),
    coverage: "module-data",
  };
  const generationBytes = freezeBytes(encodePublication(generation));
  const head: ModuleHead = {
    $schema: headSchemaId,
    schemaVersion: 1,
    module: aggregate.module,
    moduleCode: aggregate.moduleCode,
    contractVersion: 8,
    generation: {
      file: `${root}/generation.json`,
      schema: moduleDataGenerationSchemaId,
      byteSha256: generationBytes.byteSha256,
      id: generationId,
    },
  };
  const files: PlannedFile[] = [
    ...bundle.controls.map(
      (control): PlannedFile => ({
        path: `${root}/${control.file}`,
        kind: "control",
        bytes: control.bytes,
      }),
    ),
    {
      path: `${root}/generation.json`,
      kind: "generation",
      bytes: generationBytes,
    },
    {
      path: moduleHeadPath,
      kind: "head",
      bytes: freezeBytes(encodePublication(head)),
    },
    ...[
      ...new Map(bundle.dependencies.map((item) => [item.path, item])).values(),
    ].map(
      (item): PlannedFile => ({
        path: item.path,
        kind: "retained-input",
        bytes: item.bytes,
      }),
    ),
  ];
  for (const file of files) requireFileBytes(file.bytes.byteLength);
  validateCompleteFiles(files, aggregate);
  return files;
}

export function validateCompleteFiles(
  files: PlannedFile[],
  aggregate: ModuleAggregate,
): void {
  const result = readControls({
    moduleCode: aggregate.moduleCode,
    files: files.map((file) => ({
      kind: "file",
      path: file.path,
      bytes: thawBytes(file.bytes),
    })),
  });
  if (
    result.kind !== "canonical" ||
    result.coverage !== "validated-module-data"
  )
    throw new Error(
      `Complete module graph refused: ${result.diagnostics.map((item) => item.message).join(" ")}`,
    );
}
