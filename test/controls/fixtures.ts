import { createHash } from "node:crypto";
import type { ControlObservation } from "../../src/controls/index.js";

export const moduleCode = "ABCD1234E";
export const moduleId = `module:synthetic:${moduleCode}`;
export const headPath = "00 Module Admin/00 Module.json";
export const generationPath =
  ".academic-os/control-generations/g1/generation.json";
export const identityPath = ".academic-os/control-generations/g1/identity.json";
export function file(
  path: string,
  source: string,
): ControlObservation & { kind: "file" } {
  return { kind: "file", path, bytes: Buffer.from(source) };
}
export function jsonFile(path: string, value: unknown) {
  return file(path, `${JSON.stringify(value, null, 2)}\n`);
}
export function sha(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalFixture(
  options: {
    generation?: Record<string, unknown>;
    head?: Record<string, unknown>;
    identity?: Record<string, unknown>;
    identityFile?: string;
  } = {},
) {
  const identityFile = options.identityFile ?? "identity.json";
  const identity = jsonFile(
    `.academic-os/control-generations/g1/${identityFile}`,
    {
      $schema: "urn:academic-os:module-identity:1",
      schemaVersion: 1,
      module: moduleId,
      moduleCode,
      title: "Synthetic subject",
      ...options.identity,
    },
  );
  const generation = jsonFile(generationPath, {
    $schema: "urn:academic-os:control-generation:1",
    schemaVersion: 1,
    module: moduleId,
    moduleCode,
    generationId: "g1",
    controls: [
      {
        role: "module-identity",
        file: identityFile,
        schema: "urn:academic-os:module-identity:1",
        byteSha256: sha(identity.bytes),
      },
    ],
    ...options.generation,
  });
  const head = jsonFile(headPath, {
    $schema: "urn:academic-os:module-head:1",
    schemaVersion: 1,
    module: moduleId,
    moduleCode,
    contractVersion: 8,
    generation: {
      id: "g1",
      file: generationPath,
      schema: "urn:academic-os:control-generation:1",
      byteSha256: sha(generation.bytes),
    },
    ...options.head,
  });
  return [head, generation, identity];
}

export function legacyFixture(): ControlObservation[] {
  return [
    file(
      "00 Module Admin/20 Curation Register.jsonl",
      '{"checksum":"abcdef0123456789abcdef0123456789","destination":"90 Resources/Native bundle","decision":"curated","unknown":{"preserve":true}}\n{"sha256":"' +
        "0".repeat(64) +
        '","decision":"source-only"}\n{"decision":"unresolved"}\n',
    ),
    file(
      "00 Module Admin/10 Module Definition.yaml",
      `schema_version: 2\ncontract_version: 3\nmodule:\n  code: ${moduleCode}\n  title: Synthetic subject\n`,
    ),
    file(
      "docs/20 Teaching Procedure.md",
      "# Synthetic procedure generation A\n",
    ),
    file(
      "docs/40 Cheatsheet Procedure.md",
      "# Synthetic procedure generation B\n",
    ),
    file(
      "00 Module Admin/40 Source Map.yaml",
      'units:\n  "10":\n    topics: [First topic, Second topic]\n    lectures: []\n    textbook: []\n    tutorials: ["20 Tutorials/Handout.md"]\n  "2":\n    topics: [Third topic]\n    lectures: []\n    textbook: []\n    tutorials:\n      - block: Exercises A\n        exercises: questions 1-2\n        sources:\n          - file: 20 Tutorials/Handout.md\n            locator: pages 1-2\n            role: questions\n            missing: [solutions]\n',
    ),
    file(
      "70 Learning/10 Lectures/records/partial.md",
      "---\ndate: 2025-01-01\nunit: '10'\nsources: []\nkind: session\nsupersedes: earlier.md\n---\nPartial evidence.\n",
    ),
    file(
      "70 Learning/30 Revision/records/current.md",
      "---\nunit: '10'\ntarget: First topic\ntopics: [First topic, Second topic]\nkind: session\nstatus: complete\nsupersedes: [earlier.md, partial.md]\n---\nCoverage claim.\n",
    ),
    file(
      "70 Learning/20 Tutorials/records/tutorial.md",
      `---\nmodule: ${moduleCode}\ntutorial: A\nstatus: reviewed\n---\nTutorial-specific legacy fields.\n`,
    ),
  ];
}
