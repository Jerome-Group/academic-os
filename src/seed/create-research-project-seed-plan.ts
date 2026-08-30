import type { ResolvedResearchProject } from "../config/index.js";
import type { ResearchProjectContract } from "../conformance/research-project-contract.js";
import { validateResearchProjectDefinition } from "../conformance/validate-research-project-definition.js";
import { OperationalError } from "../operational-error.js";
import type {
  ResearchProjectInitialFile,
  ResearchProjectSeedPlan,
  SeedOperation,
} from "./types.js";

const profilePath = "00 Project Admin/00 Project Profile.md";
const definitionPath = "00 Project Admin/10 Project Definition.yaml";
const callerOwnedOverrides = new Set([
  "00 Project Admin/20 Source Register.yaml",
  "00 Project Admin/50 Deliverable Register.yaml",
  "10 Source Materials/references.bib",
]);
const commonOpenInteriors = [
  "10 Source Materials/10 Programme and Project",
  "10 Source Materials/20 Core Sources",
  "10 Source Materials/30 Reference Sources",
  "20 Supervisor Meetings",
  "70 Research/10 Reading",
  "70 Research/20 Mathematics",
  "70 Research/30 Experiments",
] as const;

export function createResearchProjectSeedPlan(input: {
  target: ResolvedResearchProject;
  profile: string;
  definition: string;
  contract: ResearchProjectContract;
  initialFiles?: readonly ResearchProjectInitialFile[];
}): ResearchProjectSeedPlan {
  const selectedProfile = input.target.profile ?? "generic";
  const structure = uniqueStructure([
    ...input.contract.universalStructure,
    ...input.contract.profiles[selectedProfile],
  ]);
  const contents = new Map(
    Object.entries(input.contract.seedFiles).map(([path, body]) => [
      path,
      body.replaceAll("{{PROJECT_NAME}}", input.target.folder),
    ]),
  );
  contents.set(profilePath, input.profile);
  contents.set(definitionPath, input.definition);
  const missingBodies = structure
    .filter(([, kind]) => kind === "file")
    .map(([path]) => path)
    .filter((path) => !contents.has(path));
  const definitionBlockers = validateResearchProjectDefinition(
    input.definition,
    input.target,
  )
    .filter(({ status }) => status !== "pass")
    .map(
      ({ ruleId, evidence }) =>
        `${ruleId} blocks seeding; requires a human decision: ${evidence}`,
    );
  const operations = initialFileOperations({
    structure,
    contents,
    initialFiles: input.initialFiles ?? [],
    selectedProfile,
  });
  return {
    target: {
      kind: "research-project",
      key: input.target.key,
      folder: input.target.folder,
    },
    contractVersion: input.contract.version,
    blockers: [
      ...definitionBlockers,
      ...(missingBodies.length === 0
        ? []
        : [
            `Seed-source templates are missing for: ${missingBodies.join(", ")}.`,
          ]),
    ],
    operations,
  };
}

function initialFileOperations(input: {
  structure: ReadonlyArray<readonly [string, "directory" | "file"]>;
  contents: ReadonlyMap<string, string>;
  initialFiles: readonly ResearchProjectInitialFile[];
  selectedProfile: string;
}): SeedOperation[] {
  const operations = new Map<string, SeedOperation>(
    input.structure.map(([path, kind]) => [
      path,
      {
        kind,
        path,
        ...(kind === "file"
          ? { contents: input.contents.get(path) ?? "" }
          : {}),
      },
    ]),
  );
  const canonicalDestinations = new Set<string>();
  const initialFileDestinations = new Set<string>();
  const openInteriors = researchOpenInteriors(
    input.structure,
    input.selectedProfile,
  );
  for (const initialFile of input.initialFiles) {
    const destination = requireCanonicalDestination(initialFile.destination);
    const canonical = canonicalPathIdentity(destination);
    if (canonicalDestinations.has(canonical)) {
      throw invalidInitialFile(
        `Initial intake has duplicate destination ${destination}.`,
      );
    }
    canonicalDestinations.add(canonical);
    if (destination === profilePath || destination === definitionPath) {
      throw invalidInitialFile(
        `${destination} remains controlled by the dedicated --profile and --definition flags.`,
      );
    }
    if (destination.startsWith("00 Project Admin/")) {
      if (!callerOwnedOverrides.has(destination)) {
        throw invalidInitialFile(
          `Initial intake cannot add to closed Project Admin: ${destination}.`,
        );
      }
      if (initialFile.encoding !== "utf8") {
        throw invalidInitialFile(
          `Caller-owned control ${destination} requires utf8 encoding.`,
        );
      }
      operations.set(destination, textOperation(destination, initialFile));
      initialFileDestinations.add(destination);
      continue;
    }
    if (destination === "10 Source Materials/references.bib") {
      if (initialFile.encoding !== "utf8") {
        throw invalidInitialFile(
          "Caller-owned control 10 Source Materials/references.bib requires utf8 encoding.",
        );
      }
      operations.set(destination, textOperation(destination, initialFile));
      initialFileDestinations.add(destination);
      continue;
    }
    const existing = operations.get(destination);
    if (existing !== undefined) {
      if (existing.kind === "directory") {
        throw invalidInitialFile(
          `Initial intake has a file/directory type conflict at ${destination}.`,
        );
      }
      throw invalidInitialFile(
        `Initial intake cannot replace pinned or fixed ${existing.kind} ${destination}.`,
      );
    }
    const openInterior = openInteriors.find((root) =>
      destination.startsWith(`${root}/`),
    );
    if (openInterior === undefined) {
      throw invalidInitialFile(
        `Initial intake destination is not inside an existing open content interior: ${destination}.`,
      );
    }
    assertNoFileAncestor(destination, operations, initialFileDestinations);
    operations.set(destination, fileOperation(destination, initialFile));
    initialFileDestinations.add(destination);
    deriveAncestorDirectories(destination, openInterior, operations);
  }
  for (const destination of initialFileDestinations) {
    const child = [...initialFileDestinations].find(
      (candidate) =>
        candidate !== destination && candidate.startsWith(`${destination}/`),
    );
    if (child !== undefined) {
      throw invalidInitialFile(
        `Initial intake has a file/directory type conflict between ${destination} and ${child}.`,
      );
    }
  }
  assertNoCaseVariantOperations(operations.values());
  return [...operations.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

function assertNoCaseVariantOperations(
  operations: Iterable<SeedOperation>,
): void {
  const byIdentity = new Map<string, string>();
  for (const operation of operations) {
    const identity = canonicalPathIdentity(operation.path);
    const existing = byIdentity.get(identity);
    if (existing !== undefined && existing !== operation.path) {
      throw invalidInitialFile(
        `Initial intake has case-variant path conflict between ${existing} and ${operation.path}.`,
      );
    }
    byIdentity.set(identity, operation.path);
  }
}

function researchOpenInteriors(
  structure: ReadonlyArray<readonly [string, "directory" | "file"]>,
  selectedProfile: string,
): string[] {
  const directories = structure
    .filter(([, kind]) => kind === "directory")
    .map(([path]) => path);
  const resourceInteriors = directories.filter((path) =>
    /^90 Resources\/[^/]+$/u.test(path),
  );
  const profileDeliverableInteriors = directories.filter((path) =>
    /^30 Deliverables\/[^/]+$/u.test(path),
  );
  return [
    ...commonOpenInteriors,
    ...(selectedProfile === "generic" ||
    profileDeliverableInteriors.length === 0
      ? ["30 Deliverables"]
      : profileDeliverableInteriors),
    ...resourceInteriors,
  ];
}

function requireCanonicalDestination(destination: string): string {
  const segments = destination.split("/");
  if (
    destination.length === 0 ||
    destination.startsWith("/") ||
    destination.endsWith("/") ||
    destination.includes("\\") ||
    destination.includes("\0") ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.startsWith(".") ||
        segment === "Icon\r",
    )
  ) {
    throw invalidInitialFile(
      `Initial intake destination must be a canonical relative path: ${destination}.`,
    );
  }
  return destination;
}

function assertNoFileAncestor(
  destination: string,
  operations: ReadonlyMap<string, SeedOperation>,
  initialFileDestinations: ReadonlySet<string>,
): void {
  const segments = destination.split("/");
  for (let index = 1; index < segments.length; index += 1) {
    const ancestor = segments.slice(0, index).join("/");
    if (
      operations.get(ancestor)?.kind === "file" ||
      initialFileDestinations.has(ancestor)
    ) {
      throw invalidInitialFile(
        `Initial intake has a file/directory type conflict at ${ancestor}.`,
      );
    }
  }
}

function deriveAncestorDirectories(
  destination: string,
  openInterior: string,
  operations: Map<string, SeedOperation>,
): void {
  const segments = destination.split("/");
  const rootDepth = openInterior.split("/").length;
  for (let depth = rootDepth + 1; depth < segments.length; depth += 1) {
    const path = segments.slice(0, depth).join("/");
    const existing = operations.get(path);
    if (existing?.kind === "file") {
      throw invalidInitialFile(
        `Initial intake has a file/directory type conflict at ${path}.`,
      );
    }
    if (existing === undefined)
      operations.set(path, { kind: "directory", path });
  }
}

function textOperation(
  destination: string,
  initialFile: Extract<ResearchProjectInitialFile, { encoding: "utf8" }>,
): SeedOperation {
  return { kind: "file", path: destination, contents: initialFile.contents };
}

function fileOperation(
  destination: string,
  initialFile: ResearchProjectInitialFile,
): SeedOperation {
  return initialFile.encoding === "utf8"
    ? textOperation(destination, initialFile)
    : {
        kind: "file",
        path: destination,
        contentsBase64: initialFile.contentsBase64,
      };
}

function canonicalPathIdentity(path: string): string {
  return path.normalize("NFC").toLocaleLowerCase("en-US");
}

function invalidInitialFile(message: string): OperationalError {
  return new OperationalError("invalid-config", message);
}

function uniqueStructure(
  structure: ReadonlyArray<readonly [string, "directory" | "file"]>,
): ReadonlyArray<readonly [string, "directory" | "file"]> {
  const byPath = new Map<string, "directory" | "file">();
  for (const [path, kind] of structure) {
    const prior = byPath.get(path);
    if (prior !== undefined && prior !== kind) {
      throw new TypeError(`Research contract gives ${path} conflicting kinds.`);
    }
    byPath.set(path, kind);
  }
  return [...byPath].sort(([left], [right]) => left.localeCompare(right));
}
