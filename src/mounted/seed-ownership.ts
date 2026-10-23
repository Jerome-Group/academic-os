import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rmdir,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import type { SeedOperation } from "../seed/index.js";
import { seedFileBytes } from "../seed/seed-operation-bytes.js";
import { ensureMaterialized } from "./ensure-materialized.js";
import {
  appendSeedJournalEvent,
  seedTargetParentRoot,
  type SeedDirectoryClaim,
  type SeedEntryIdentity,
  type SeedJournal,
  type SeedOwnershipBaseline,
  type SeedOwnershipEvent,
} from "./seed-operation-journal.js";

interface SeedStage {
  root: string;
  generation: number;
  claim: Extract<SeedOwnershipEvent, { type: "stage-claimed" }> | undefined;
  cleaned: boolean;
  removing: string[];
  entries: Extract<SeedOwnershipEvent, { type: "entry-created" }>[];
}

export function seedStage(journal: SeedJournal): SeedStage {
  const planned = journal.events
    .filter((event) => event.type === "stage-planned")
    .at(-1);
  const generation = planned?.generation ?? 0;
  const root = planned?.stagingRoot ?? journal.started.stagingRoot;
  const claim = journal.events
    .filter((event) => event.type === "stage-claimed")
    .find((event) => event.generation === generation);
  const cleaned = journal.events.some(
    (event) =>
      event.type === "stage-cleaned" && event.generation === generation,
  );
  const removing = journal.events
    .filter((event) => event.type === "stage-entry-removing")
    .filter((event) => event.generation === generation)
    .map((event) => event.path);
  const entries = journal.events
    .filter((event) => event.type === "entry-created")
    .filter(
      (event) => event.phase === "staging" && event.generation === generation,
    );
  return { root, generation, claim, cleaned, removing, entries };
}

export async function captureSeedOwnership(
  parent: string,
  root: string,
  operations: SeedOperation[],
): Promise<SeedOwnershipBaseline> {
  const publicationDirectories: SeedDirectoryClaim[] = [];
  for (const path of [
    "",
    ...operations
      .filter(({ kind }) => kind === "directory")
      .map(({ path }) => path),
  ]) {
    const absolute = path === "" ? root : ownedPath(root, path);
    if ((await metadata(absolute)) === undefined) continue;
    publicationDirectories.push({
      path,
      identity: await directoryIdentity(absolute),
    });
  }
  return { parent: await directoryIdentity(parent), publicationDirectories };
}

export async function inspectSeedOwnership(
  journal: SeedJournal,
): Promise<string | undefined> {
  try {
    if (
      journal.started.schemaVersion !== 2 ||
      journal.started.ownership === undefined
    )
      throw new Error(
        "Incomplete legacy seed has no durable staging ownership; preserved.",
      );
    await proveSeedParent(journal);
    await verifyStage(journal);
    for (const claim of publicationDirectories(journal))
      await proveDirectory(
        claim.path === ""
          ? targetRoot(journal)
          : ownedPath(targetRoot(journal), claim.path),
        claim.identity,
      );
    return undefined;
  } catch (error) {
    return message(error);
  }
}

export async function claimSeedStage(journal: SeedJournal): Promise<void> {
  let stage = seedStage(journal);
  if (stage.removing.length > 0 && !stage.cleaned) {
    const refusal = await removeOwnedSeedStage(journal);
    if (refusal !== undefined) throw new Error(refusal);
    stage = seedStage(journal);
  }
  if (stage.cleaned) {
    await appendSeedJournalEvent(journal, {
      type: "stage-planned",
      generation: stage.generation + 1,
      stagingRoot: join(
        dirname(stage.root),
        `${basename(journal.started.stagingRoot).slice(0, -36)}${randomUUID()}`,
      ),
    });
    stage = seedStage(journal);
  }
  await proveSeedParent(journal);
  await verifyStage(journal);
  if (stage.claim !== undefined) return;
  await mkdir(stage.root);
  const identity = await directoryIdentity(stage.root);
  await appendSeedJournalEvent(journal, {
    type: "stage-claimed",
    generation: stage.generation,
    identity,
  });
}

export async function proveSeedOperation(
  journal: SeedJournal,
  phase: "staging" | "publication",
  root: string,
  operation: SeedOperation,
): Promise<void> {
  await proveSeedParent(journal);
  const stage = seedStage(journal);
  const claims =
    phase === "staging"
      ? [
          { path: "", identity: stage.claim?.identity },
          ...stage.entries
            .filter((entry) => entry.operation.kind === "directory")
            .map((entry) => ({
              path: entry.operation.path,
              identity: entry.identity,
            })),
        ]
      : publicationDirectories(journal);
  const parts = operation.path.split("/");
  for (let length = 0; length < parts.length; length += 1) {
    const path = parts.slice(0, length).join("/");
    const claim = claims.find((entry) => entry.path === path);
    if (claim?.identity === undefined)
      throw new Error(`Unclaimed ${phase} ancestor ${path || root}.`);
    await proveDirectory(
      path === "" ? root : ownedPath(root, path),
      claim.identity,
    );
  }
  if (operation.kind === "directory") {
    const claim = claims.find((entry) => entry.path === operation.path);
    if (claim?.identity !== undefined) {
      await proveDirectory(ownedPath(root, operation.path), claim.identity);
    } else if (
      (await metadata(ownedPath(root, operation.path))) !== undefined
    ) {
      throw new Error(`Unclaimed ${phase} directory ${operation.path}.`);
    }
  }
}

export async function createOwnedSeedOperation(
  journal: SeedJournal,
  phase: "staging" | "publication",
  root: string,
  operation: SeedOperation,
): Promise<void> {
  await proveSeedOperation(journal, phase, root, operation);
  const path = ownedPath(root, operation.path);
  if (operation.kind === "directory") await mkdir(path);
  else {
    const file = await open(path, "wx");
    try {
      await file.writeFile(seedFileBytes(operation));
      await file.sync();
    } finally {
      await file.close();
    }
  }
  const current = await metadata(path);
  if (
    current === undefined ||
    current.isSymbolicLink() ||
    (operation.kind === "file" ? !current.isFile() : !current.isDirectory())
  )
    throw new Error(`Created ${phase} entry changed: ${operation.path}.`);
  const sha256 =
    operation.kind === "file" ? hash(await readFile(path)) : undefined;
  if (sha256 !== undefined && sha256 !== hash(seedFileBytes(operation)))
    throw new Error(`Created ${phase} bytes changed: ${operation.path}.`);
  await appendSeedJournalEvent(journal, {
    type: "entry-created",
    phase,
    generation: phase === "staging" ? seedStage(journal).generation : 0,
    operation: { kind: operation.kind, path: operation.path },
    identity: identity(current),
    ...(sha256 === undefined ? {} : { sha256 }),
  });
}

export async function removeOwnedSeedStage(
  journal: SeedJournal,
): Promise<string | undefined> {
  try {
    await proveSeedParent(journal);
    await verifyStage(journal);
    const stage = seedStage(journal);
    if (stage.cleaned) return undefined;
    if (stage.claim === undefined) {
      await appendSeedJournalEvent(journal, {
        type: "stage-cleaned",
        generation: stage.generation,
      });
      return undefined;
    }
    if (
      (await metadata(stage.root)) === undefined &&
      stage.removing.includes("")
    ) {
      await appendSeedJournalEvent(journal, {
        type: "stage-cleaned",
        generation: stage.generation,
      });
      return undefined;
    }
    for (const entry of [...stage.entries].sort(
      (a, b) =>
        b.operation.path.split("/").length -
          a.operation.path.split("/").length ||
        b.operation.path.localeCompare(a.operation.path),
    )) {
      const path = ownedPath(stage.root, entry.operation.path);
      if (
        (await metadata(path)) === undefined &&
        stage.removing.includes(entry.operation.path)
      )
        continue;
      await proveSeedOperation(journal, "staging", stage.root, entry.operation);
      await verifyEntry(path, entry);
      if (!stage.removing.includes(entry.operation.path))
        await appendSeedJournalEvent(journal, {
          type: "stage-entry-removing",
          generation: stage.generation,
          path: entry.operation.path,
        });
      if ((await metadata(path)) !== undefined) {
        await proveSeedOperation(
          journal,
          "staging",
          stage.root,
          entry.operation,
        );
        await verifyEntry(path, entry);
        if (entry.operation.kind === "file") await unlink(path);
        else await rmdir(path);
      }
    }
    await proveSeedParent(journal);
    await proveDirectory(stage.root, stage.claim.identity);
    if (!stage.removing.includes(""))
      await appendSeedJournalEvent(journal, {
        type: "stage-entry-removing",
        generation: stage.generation,
        path: "",
      });
    await rmdir(stage.root);
    await appendSeedJournalEvent(journal, {
      type: "stage-cleaned",
      generation: stage.generation,
    });
    return undefined;
  } catch (error) {
    return `Staging preserved; cleanup refused: ${message(error)}`;
  }
}

async function verifyStage(journal: SeedJournal): Promise<void> {
  const stage = seedStage(journal);
  const current = await metadata(stage.root);
  if (stage.cleaned || stage.claim === undefined) {
    if (current !== undefined)
      throw new Error(
        "Staging path is occupied without a live ownership claim; preserved.",
      );
    return;
  }
  if (current === undefined && stage.removing.includes("")) return;
  await proveDirectory(stage.root, stage.claim.identity);
  const paths: string[] = [];
  async function inventory(root: string, prefix: string): Promise<void> {
    for (const name of await readdir(root)) {
      const path = prefix === "" ? name : `${prefix}/${name}`;
      paths.push(path);
      const entry = stage.entries.find(
        (entry) => entry.operation.path === path,
      );
      if (entry === undefined)
        throw new Error(`Unclaimed staging descendant ${path}; preserved.`);
      await verifyEntry(ownedPath(stage.root, path), entry);
      if (entry.operation.kind === "directory")
        await inventory(ownedPath(stage.root, path), path);
    }
  }
  await inventory(stage.root, "");
  for (const entry of stage.entries)
    if (
      !paths.includes(entry.operation.path) &&
      !stage.removing.includes(entry.operation.path)
    )
      throw new Error(
        `Claimed staging entry is missing: ${entry.operation.path}.`,
      );
}

async function verifyEntry(
  path: string,
  receipt: {
    operation: { kind: "directory" | "file"; path: string };
    identity: SeedEntryIdentity;
    sha256?: string;
  },
): Promise<void> {
  const current = await metadata(path);
  if (current === undefined)
    throw new Error(`Staging entry is missing: ${receipt.operation.path}.`);
  if (
    current.isSymbolicLink() ||
    !sameIdentity(identity(current), receipt.identity) ||
    (receipt.operation.kind === "directory"
      ? !current.isDirectory()
      : !current.isFile())
  )
    throw new Error(
      `Staging entry identity changed: ${receipt.operation.path}.`,
    );
  await ensureMaterialized(path);
  if (
    receipt.operation.kind === "file" &&
    hash(await readFile(path)) !== receipt.sha256
  )
    throw new Error(`Staging bytes changed: ${receipt.operation.path}.`);
}

function publicationDirectories(journal: SeedJournal): SeedDirectoryClaim[] {
  const claims = [...(journal.started.ownership?.publicationDirectories ?? [])];
  const rootClaim = journal.events.find(
    (event) => event.type === "root-claimed",
  );
  if (rootClaim !== undefined)
    claims.push({
      path: "",
      identity: { device: rootClaim.device, inode: rootClaim.inode },
    });
  for (const event of journal.events)
    if (
      event.type === "entry-created" &&
      event.phase === "publication" &&
      event.operation.kind === "directory"
    )
      claims.push({ path: event.operation.path, identity: event.identity });
  return claims;
}

export async function proveSeedParent(journal: SeedJournal): Promise<void> {
  const baseline = journal.started.ownership;
  if (baseline === undefined)
    throw new Error("Staging ownership baseline is unavailable.");
  await proveDirectory(
    seedTargetParentRoot(journal.started.target),
    baseline.parent,
  );
}

async function proveDirectory(
  path: string,
  expected: SeedEntryIdentity,
): Promise<void> {
  if (!sameIdentity(await directoryIdentity(path), expected))
    throw new Error(`Seed ancestor identity changed: ${path}.`);
}

async function directoryIdentity(path: string): Promise<SeedEntryIdentity> {
  const current = await metadata(path);
  if (
    current === undefined ||
    !current.isDirectory() ||
    current.isSymbolicLink() ||
    (await realpath(path)) !== resolve(path)
  )
    throw new Error(
      `Seed ancestor is missing, linked or unmaterialized: ${path}.`,
    );
  await ensureMaterialized(path);
  return identity(current);
}

function identity(
  current: NonNullable<Awaited<ReturnType<typeof metadata>>>,
): SeedEntryIdentity {
  return { device: String(current.dev), inode: String(current.ino) };
}
async function metadata(path: string) {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
}
function sameIdentity(a: SeedEntryIdentity, b: SeedEntryIdentity): boolean {
  return a.device === b.device && a.inode === b.inode;
}
function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Seed ownership could not be verified.";
}
function targetRoot(journal: SeedJournal): string {
  const target = journal.started.target;
  return "kind" in target ? target.projectRoot : target.moduleRoot;
}
function ownedPath(root: string, path: string): string {
  const absolute = resolve(root, path);
  const local = relative(root, absolute);
  if (
    local === "" ||
    local === ".." ||
    local.startsWith(`..${sep}`) ||
    resolve(root, local) !== absolute ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  )
    throw new Error(`Unsafe seed entry path ${path}.`);
  return absolute;
}
