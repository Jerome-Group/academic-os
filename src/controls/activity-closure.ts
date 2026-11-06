import type { Preparation } from "../module-activity/generated/workflow.js";
import { activityBytes, readActivityJson } from "./activity-packets.js";
import { digest, freezeBytes, sha256 } from "./canonical-json.js";
import type { ModuleDataControl } from "./generated/module-data-1.js";
import { moduleHeadPath, readControls } from "./read-controls.js";
import type { ControlReadInput } from "./types.js";

export function readActivityClosure(input: ControlReadInput) {
  const minimumWireBytes = input.files.reduce(
    (total, file) =>
      total +
      (file.kind === "file" ? 4 * Math.ceil(file.bytes.byteLength / 3) : 0),
    0,
  );
  if (minimumWireBytes > 8_388_608)
    throw new Error(
      `Module closure needs at least ${minimumWireBytes} encoded bytes; activity packet limit 8388608.`,
    );
  const read = readControls(input);
  if (
    read.kind !== "canonical" ||
    read.coverage !== "validated-module-data" ||
    read.shape.generation.schemaVersion !== 2
  )
    throw new Error(
      `Complete Module data closure required. ${read.diagnostics.map((d) => d.message).join(" ")}`,
    );
  const files = input.files
    .map((file) => {
      if (file.kind !== "file")
        throw new Error(`Unreadable activity source ${file.path}.`);
      return { path: file.path, bytes: freezeBytes(file.bytes) };
    })
    .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const first = files[0];
  if (!first) throw new Error("Empty Module closure.");
  const head = files.find((file) => file.path === moduleHeadPath);
  if (!head) throw new Error("Missing exact Module head.");
  const root = read.shape.head.generation.file.slice(
    0,
    -"generation.json".length,
  );
  const controls = read.shape.generation.controls.map((binding) => {
    const file = files.find((file) => file.path === root + binding.file);
    if (!file) throw new Error(`Missing control bytes ${binding.role}.`);
    return { role: binding.role, file: binding.file, bytes: file.bytes };
  });
  const values = read.controls;
  function control<R extends ModuleDataControl["role"]>(
    role: R,
  ): Extract<ModuleDataControl, { role: R }> {
    const value = values.find((c) => c.role === role)?.value;
    if (!value || !("role" in value) || value.role !== role)
      throw new Error(`Missing role ${role}.`);
    return value as Extract<ModuleDataControl, { role: R }>;
  }
  function retained(path: string) {
    const file = files.find((file) => file.path === path);
    if (!file) throw new Error(`Missing retained bytes ${path}.`);
    return file;
  }
  const evidence = control("evidence");
  const shared = control("preferences").sharedBundle;
  const sharedFile = retained(
    `.academic-os/retained-inputs/${shared.byteSha256}`,
  );
  if (sharedFile.bytes.byteSha256 !== shared.byteSha256)
    throw new Error("Shared preference byte binding differs.");
  const dependencies = [
    ...evidence.entries.flatMap((entry) =>
      entry.locator.kind === "retained-original"
        ? [
            {
              kind: "retained-original" as const,
              evidenceId: entry.id,
              ...retained(entry.locator.path),
            },
          ]
        : [],
    ),
    {
      kind: "shared-preferences" as const,
      id: shared.id,
      version: shared.version,
      ...retained(`.academic-os/retained-inputs/${shared.byteSha256}`),
    },
  ];
  const expected = new Set([
    moduleHeadPath,
    read.shape.head.generation.file,
    ...controls.map((c) => root + c.file),
    ...dependencies.map((d) => d.path),
  ]);
  if (
    files.length !== expected.size ||
    files.some((f) => !expected.has(f.path))
  )
    throw new Error("Closure has extra, duplicate or unbound files.");
  const bundle = {
    $schema: "urn:academic-os:publication-bundle:1" as const,
    schemaVersion: 1 as const,
    controls,
    dependencies,
    nativeArtifactEffects: [] as never[],
  };
  function evidenceBytes(id: string) {
    const entry = evidence.entries.find((e) => e.id === id);
    if (entry?.locator.kind !== "retained-original")
      throw new Error(`Exact retained evidence required for ${id}.`);
    const file = retained(entry.locator.path);
    const bytes = activityBytes(file.bytes);
    if (
      entry.locator.byteLength !== bytes.byteLength ||
      entry.locator.byteSha256 !== sha256(bytes) ||
      entry.content.kind !== "known" ||
      entry.content.value !== sha256(bytes)
    )
      throw new Error(`Retained evidence differs for ${id}.`);
    return file.bytes;
  }
  return {
    read,
    files: [first, ...files.slice(1)] satisfies Preparation["files"],
    head,
    control,
    bundle,
    evidenceBytes,
  };
}

export type ActivityClosure = ReturnType<typeof readActivityClosure>;

export function preparationClosure(preparation: Preparation): ActivityClosure {
  const head = preparation.files.find((f) => f.path === moduleHeadPath);
  if (!head || head.bytes.byteSha256 !== preparation.baseHeadByteSha256)
    throw new Error("Preparation head binding differs.");
  const parsed = readActivityClosure({
    moduleCode: moduleCodeFromFiles(preparation),
    files: preparation.files.map((f) => ({
      kind: "file",
      path: f.path,
      bytes: activityBytes(f.bytes),
    })),
  });
  if (
    parsed.read.shape.generation.generationId !==
      preparation.baseGenerationId ||
    parsed.read.shape.head.module !== preparation.moduleId
  )
    throw new Error("Preparation generation or Module binding differs.");
  return parsed;
}

function moduleCodeFromFiles(preparation: Preparation): string {
  const head = preparation.files.find((f) => f.path === moduleHeadPath);
  if (!head) throw new Error("Missing preparation head.");
  const value: unknown = readActivityJson(activityBytes(head.bytes));
  if (
    !value ||
    typeof value !== "object" ||
    !("moduleCode" in value) ||
    typeof value.moduleCode !== "string"
  )
    throw new Error("Missing Module code.");
  return value.moduleCode;
}

export function sameValue(a: unknown, b: unknown): boolean {
  return digest(a) === digest(b);
}
