import { lstat, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";

import { sha256 } from "../checksum.js";
import { writtenControlPaths } from "../conformance/control-paths.js";
import { isContainedBy } from "../mounted/is-contained-by.js";
import { replaceMountedFile } from "../mounted/replace-mounted-file.js";
import {
  type CurationIdentityJournalSubject,
  openCurationIdentityJournal,
} from "./curation-identity-journal.js";
import type {
  CohortCurationRegisters,
  CurationIdentityPlan,
  CurationIdentityReport,
  ModuleCurationIdentityPlan,
} from "./types.js";

const registerPath = writtenControlPaths.curationRegister;

interface ProvenAppend {
  module: ModuleCurationIdentityPlan;
  target: string;
  contents: string;
}

export async function executeCurationIdentityMigration(input: {
  plan: CurationIdentityPlan;
  cohort: CohortCurationRegisters;
  mode: "preview" | "apply";
}): Promise<CurationIdentityReport> {
  const summary = {
    schemaVersion: 1,
    command: "curation migrate",
    mode: input.mode,
    counts: input.plan.counts,
    modules: input.plan.modules.map(publicModule),
    unresolved: input.cohort.unresolved,
  } as const;
  const pending = input.plan.modules.filter(
    ({ migrations }) => migrations.length > 0,
  );

  if (input.mode === "preview" || pending.length === 0) {
    return {
      ...summary,
      outcome: input.plan.outcome,
      appended: 0,
      refusals: [],
    };
  }

  // Nothing is written until every register has proved itself, so one file that moved under the
  // preview refuses the run rather than leaving a cohort half-migrated.
  const proven: ProvenAppend[] = [];
  const refusals: string[] = [];
  for (const module of pending) {
    const provedRegister = await proveRegister(module, input.cohort);
    if ("refusal" in provedRegister) {
      refusals.push(provedRegister.refusal);
      continue;
    }
    proven.push({
      module,
      target: provedRegister.target,
      contents: appendedRegister(provedRegister.current, module),
    });
  }
  if (refusals.length > 0) {
    return { ...summary, outcome: "refused", appended: 0, refusals };
  }

  const journal = await openCurationIdentityJournal(input.cohort.stateRoot);
  let appended = 0;
  for (const { module, target, contents } of proven) {
    const subject: CurationIdentityJournalSubject = {
      module: module.module,
      semester: module.semester,
      path: registerPath,
    };
    const to = sha256(contents);
    await journal.append({
      ...subject,
      type: "intent",
      appended: module.migrations.length,
      from: module.observedSha256,
      to,
    });
    const evidence = await writeRegister(module, target, contents, to);
    if (evidence !== undefined) {
      await journal.append({ ...subject, type: "refused", evidence });
      return {
        ...summary,
        // Earlier registers in this run already carry their new lines, and no rollback can unwrite
        // them without holding every original. The journal is the record of how far it got.
        outcome: appended === 0 ? "refused" : "partially-migrated",
        appended,
        refusals: [`${module.module} ${registerPath}: ${evidence}`],
        journal: journal.path,
      };
    }
    await journal.append({ ...subject, type: "result", outcome: "appended" });
    appended += module.migrations.length;
  }
  return {
    ...summary,
    outcome: "contract-v4",
    counts: migratedCounts(input.plan),
    modules: input.plan.modules.map((module) => ({
      ...publicModule(module),
      counts: migratedModuleCounts(module),
      migrations: [],
    })),
    appended,
    refusals: [],
    journal: journal.path,
  };
}

// The append, and the reading that proves it landed. A register whose bytes are not the ones
// intended is not an append that half-worked; it is one this run cannot claim, so it refuses.
async function writeRegister(
  module: ModuleCurationIdentityPlan,
  target: string,
  contents: string,
  expectedSha256: string,
): Promise<string | undefined> {
  try {
    await replaceMountedFile({
      path: target,
      contents,
      expectedSha256: module.observedSha256,
      readContents: readOptional,
    });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  const written = await readOptional(target);
  return written !== undefined && sha256(written) === expectedSha256
    ? undefined
    : "the register did not arrive intact.";
}

async function proveRegister(
  module: ModuleCurationIdentityPlan,
  cohort: CohortCurationRegisters,
): Promise<{ target: string; current: string } | { refusal: string }> {
  const where = `${module.module} ${registerPath}`;
  const moduleRoot = cohort.moduleRoots.get(module.module);
  if (moduleRoot === undefined) {
    return { refusal: `${where}: no module root is configured.` };
  }
  const target = join(moduleRoot, registerPath);
  const metadata = await lstat(target).catch(() => undefined);
  if (metadata === undefined) {
    return { refusal: `${where}: the register disappeared after it was read.` };
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    return { refusal: `${where}: the target is not an ordinary file.` };
  }
  const resolved = await realpath(target).catch(() => undefined);
  if (resolved === undefined || !isContainedBy(cohort.driveMount, resolved)) {
    return {
      refusal: `${where}: the target resolves outside the Drive mount.`,
    };
  }
  const current = await readOptional(target);
  if (current === undefined || sha256(current) !== module.observedSha256) {
    return {
      refusal: `${where}: the register changed after it was read for this run.`,
    };
  }
  return { target, current };
}

// Append-only: every line already in the register is reproduced byte for byte, and the superseding
// lines follow it. A file whose last line was never terminated gets its newline here, so the append
// starts a line rather than extending one.
function appendedRegister(
  current: string,
  module: ModuleCurationIdentityPlan,
): string {
  const history =
    current === "" || current.endsWith("\n") ? current : `${current}\n`;
  return `${history}${module.migrations.map(({ line }) => `${line}\n`).join("")}`;
}

async function readOptional(path: string): Promise<string | undefined> {
  return await readFile(path, "utf8").catch(() => undefined);
}

function publicModule(module: ModuleCurationIdentityPlan) {
  const { migrations, observedSha256: _observed, ...rest } = module;
  return {
    ...rest,
    migrations: migrations.map(({ line: _line, ...migration }) => migration),
  };
}

function migratedModuleCounts(
  module: ModuleCurationIdentityPlan,
): ModuleCurationIdentityPlan["counts"] {
  return {
    ...module.counts,
    "contract-v4": module.counts["contract-v4"] + module.counts.migrating,
    migrating: 0,
  };
}

function migratedCounts(
  plan: CurationIdentityPlan,
): CurationIdentityPlan["counts"] {
  return {
    ...plan.counts,
    "contract-v4": plan.counts["contract-v4"] + plan.counts.migrating,
    migrating: 0,
  };
}
