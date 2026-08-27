import { lstat, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";

import { sha256 } from "../checksum.js";
import { writtenControlPaths } from "../conformance/control-paths.js";
import { isContainedBy } from "../mounted/is-contained-by.js";
import { replaceMountedFile } from "../mounted/replace-mounted-file.js";
import type {
  CurationRegisterJournal,
  CurationRegisterJournalSubject,
} from "./curation-register-journal.js";
import { hashSource } from "./hash-source.js";

const registerPath = writtenControlPaths.curationRegister;

// One module's share of a register append: which register, which sources the new lines will name,
// and the exact JSON each adds. Both curation passes reduce to this, which is why the proving below
// is written once — a rule of `docs/agents/safe-drive-testing.md` that has to be fixed in two
// places is a rule that will one day be fixed in one.
export interface PendingRegisterAppend {
  module: string;
  semester: string;
  observedSha256: string;
  // Module-relative, and re-hashed immediately before the write against the digest the plan built.
  sources: ReadonlyArray<{ location: string; sha256: string }>;
  lines: readonly string[];
}

export interface RegisterAppendRoots {
  driveMount: string;
  moduleRoots: ReadonlyMap<string, string>;
}

export interface RegisterAppendOutcome {
  appended: number;
  written: Set<string>;
  // Populated when nothing was written at all: the whole proving pass finishes before any register
  // is touched, so one file that moved under the preview refuses the run rather than leaving a
  // cohort half-written.
  refusals: string[];
  // Populated when a write failed after earlier ones landed. No rollback can unwrite them without
  // holding every original, so the run stops and says how far it got.
  stopped?: { module: string; evidence: string };
}

export async function appendProvedRegisterLines(input: {
  pending: readonly PendingRegisterAppend[];
  roots: RegisterAppendRoots;
  journal: () => Promise<CurationRegisterJournal>;
}): Promise<RegisterAppendOutcome> {
  const proven: Array<{
    pending: PendingRegisterAppend;
    target: string;
    contents: string;
  }> = [];
  const refusals: string[] = [];
  for (const pending of input.pending) {
    const provedRegister = await proveRegister(pending, input.roots);
    if ("refusal" in provedRegister) {
      refusals.push(provedRegister.refusal);
      continue;
    }
    refusals.push(...(await unprovedSources(pending, input.roots)));
    proven.push({
      pending,
      target: provedRegister.target,
      contents: appendedRegister(provedRegister.current, pending.lines),
    });
  }
  if (refusals.length > 0) {
    return { appended: 0, written: new Set(), refusals };
  }

  const journal = await input.journal();
  const written = new Set<string>();
  let appended = 0;
  for (const { pending, target, contents } of proven) {
    const subject: CurationRegisterJournalSubject = {
      module: pending.module,
      semester: pending.semester,
      path: registerPath,
    };
    const to = sha256(contents);
    await journal.append({
      ...subject,
      type: "intent",
      appended: pending.lines.length,
      from: pending.observedSha256,
      to,
    });
    const evidence = await writeRegister(pending, target, contents, to);
    if (evidence !== undefined) {
      await journal.append({ ...subject, type: "refused", evidence });
      return {
        appended,
        written,
        refusals: [`${pending.module} ${registerPath}: ${evidence}`],
        stopped: { module: pending.module, evidence },
      };
    }
    await journal.append({ ...subject, type: "result", outcome: "appended" });
    written.add(pending.module);
    appended += pending.lines.length;
  }
  return { appended, written, refusals: [] };
}

// Rule 4 of a mounted write: what the plan was built against is read again immediately before the
// write. The digest an appended line asserts is the item's identity from then on, so a source that
// has taken new bytes since the preview would be recorded under a checksum already wrong — and the
// next arrival walk would re-decide it, which is the loop these passes exist to close.
async function unprovedSources(
  pending: PendingRegisterAppend,
  roots: RegisterAppendRoots,
): Promise<string[]> {
  const moduleRoot = roots.moduleRoots.get(pending.module);
  if (moduleRoot === undefined) {
    return [`${pending.module}: no module root is configured.`];
  }
  const refusals: string[] = [];
  for (const source of pending.sources) {
    const digests = await hashSource(join(moduleRoot, source.location));
    if (digests?.sha256 !== source.sha256) {
      refusals.push(
        `${pending.module} ${source.location}: the source changed after it was read for this run.`,
      );
    }
  }
  return refusals;
}

// The append, and the reading that proves it landed. A register whose bytes are not the ones
// intended is not an append that half-worked; it is one this run cannot claim, so it refuses.
async function writeRegister(
  pending: PendingRegisterAppend,
  target: string,
  contents: string,
  expectedSha256: string,
): Promise<string | undefined> {
  try {
    await replaceMountedFile({
      path: target,
      contents,
      expectedSha256: pending.observedSha256,
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

// Rules 1 to 3: the target resolves inside its own module folder on the Drive mount, it is an
// ordinary file the caller owns, and its bytes still hash to what the preview read.
async function proveRegister(
  pending: PendingRegisterAppend,
  roots: RegisterAppendRoots,
): Promise<{ target: string; current: string } | { refusal: string }> {
  const where = `${pending.module} ${registerPath}`;
  const moduleRoot = roots.moduleRoots.get(pending.module);
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
  if (
    resolved === undefined ||
    !isContainedBy(roots.driveMount, resolved) ||
    !isContainedBy(moduleRoot, resolved)
  ) {
    return {
      refusal: `${where}: the target resolves outside its own module folder on the Drive mount.`,
    };
  }
  const current = await readOptional(target);
  if (current === undefined || sha256(current) !== pending.observedSha256) {
    return {
      refusal: `${where}: the register changed after it was read for this run.`,
    };
  }
  return { target, current };
}

// Append-only: every line already in the register is reproduced exactly as it was read, and the new
// lines follow it. A file whose last line was never terminated gets its newline here, so the append
// starts a line rather than extending one; a file already using CRLF keeps its own endings and
// gains LF ones, which every reader of this format splits on either way.
function appendedRegister(current: string, lines: readonly string[]): string {
  const history =
    current === "" || current.endsWith("\n") ? current : `${current}\n`;
  return `${history}${lines.map((line) => `${line}\n`).join("")}`;
}

async function readOptional(path: string): Promise<string | undefined> {
  return await readFile(path, "utf8").catch(() => undefined);
}
