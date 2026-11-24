import { isDeepStrictEqual } from "node:util";
import { sha256 } from "../checksum.js";
import { normalizeCurationEventOptionals } from "../curation/normalize-curation-event-optionals.js";
import { unnumberedSourcePath } from "../curation/unnumbered-source-path.js";
import { controlFinding, failedControl } from "./control-finding.js";
import { writtenControlPaths } from "./control-paths.js";
import type { Finding } from "./types.js";
import { isRecord, nonEmptyString } from "./value-shape.js";

const registerPath = writtenControlPaths.curationRegister;
// Version 2 adds `rederived`, whose line names the derived artifacts an item's content reached the
// module through, and version 3 adds `withdrawn`, which records that the item's source has left the
// importer mirror. A line stays valid history exactly as it was written under the version it names,
// so one file holding all three is one file holding its own past.
const version1Decisions = ["curated", "source-only", "requires-decision"];
const version2Decisions = [...version1Decisions, "rederived"];
const version3Decisions = [...version2Decisions, "withdrawn"];
const decisionsByVersion = new Map([
  [1, version1Decisions],
  [2, version2Decisions],
  [3, version3Decisions],
]);
const supportedVersions = [...decisionsByVersion.keys()];
const newestDecisions = version3Decisions;

export function validateCurationRegister(source: string | undefined): Finding {
  if (source === undefined) {
    return failedControl("MF-CURATION-001", registerPath, [
      `No readable control exists at ${registerPath}.`,
    ]);
  }
  if (source === "") {
    return controlFinding(
      "MF-CURATION-001",
      registerPath,
      "pass",
      "Curation Register is the valid empty seed file.",
      "An empty register contains no malformed events.",
    );
  }
  const problems: string[] = [];
  const lines = source.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const parsed: Array<Record<string, unknown> | undefined> = [];
  const hashes = new Map<string, number[]>();
  const eventProblems: string[][] = [];
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    eventProblems.push([]);
    if (line.trim() === "") {
      problems.push(`Line ${lineNumber} is blank.`);
      parsed.push(undefined);
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      problems.push(
        `Line ${lineNumber} is not JSON: ${error instanceof Error ? error.message : String(error)}.`,
      );
      parsed.push(undefined);
      continue;
    }
    parsed.push(isRecord(value) ? value : undefined);
    const hash = sha256(line);
    hashes.set(hash, [...(hashes.get(hash) ?? []), index]);
    eventProblems[index] = validateEvent(value, lineNumber);
  }
  const reconciled = new Set<number>();
  const destinationsReconciled = new Set<number>();
  for (const [index, event] of parsed.entries()) {
    if (!event) continue;
    if (event.reconciliation === "original-curated-destination-unrecorded") {
      const targetIndex = reconcileMissingDestination({
        event,
        index,
        parsed,
        hashes,
        lines,
        reconciled,
        problems,
      });
      if (targetIndex !== undefined) {
        reconciled.add(targetIndex);
        destinationsReconciled.add(targetIndex);
      }
      continue;
    }
    if (event.destination_evidence !== undefined) {
      problems.push(
        `Line ${index + 1} destination_evidence requires destination reconciliation.`,
      );
    }
    const reference = event.supersedes;
    const marked = event.reconciliation === "original-decision-time-unrecorded";
    const rawReference =
      typeof reference === "string" && reference.startsWith("raw-sha256:");
    if (!marked && !rawReference && event.reconciliation === undefined)
      continue;
    if (
      !marked ||
      typeof reference !== "string" ||
      !/^raw-sha256:[0-9a-f]{64}$/u.test(reference)
    ) {
      problems.push(
        `Line ${index + 1} has invalid historical reconciliation metadata.`,
      );
      continue;
    }
    const targets = hashes.get(reference.slice("raw-sha256:".length)) ?? [];
    const targetIndex = targets[0];
    const target = targetIndex === undefined ? undefined : parsed[targetIndex];
    if (
      targets.length !== 1 ||
      targetIndex === undefined ||
      targetIndex >= index ||
      !target
    ) {
      problems.push(
        `Line ${index + 1} historical reconciliation must name one earlier raw line.`,
      );
      continue;
    }
    if (reconciled.has(targetIndex)) {
      problems.push(
        `Line ${index + 1} duplicates reconciliation of line ${targetIndex + 1}.`,
      );
      continue;
    }
    if (
      Object.hasOwn(target, "timestamp") ||
      target.reconciliation !== undefined ||
      validateEvent(target, targetIndex + 1).length > 0
    ) {
      problems.push(
        `Line ${index + 1} target line ${targetIndex + 1} is not valid history with only timestamp absent.`,
      );
      continue;
    }
    const targetRaw = lines[targetIndex];
    const currentRaw = lines[index];
    if (
      targetRaw === undefined ||
      currentRaw === undefined ||
      !roundTripsJsonNumbers(targetRaw) ||
      !roundTripsJsonNumbers(currentRaw)
    ) {
      problems.push(
        `Line ${index + 1} historical reconciliation cannot preserve a numeric JSON token exactly.`,
      );
      continue;
    }
    if (
      event.schema_version !== 3 ||
      !nonEmptyString(event.timestamp) ||
      validateEvent(event, index + 1).length > 0 ||
      !sameHistoricalDecision(target, event)
    ) {
      problems.push(
        `Line ${index + 1} changes the historical decision or is not a valid current event.`,
      );
      continue;
    }
    reconciled.add(targetIndex);
  }
  for (const [index, entries] of eventProblems.entries()) {
    problems.push(
      ...entries.filter(
        (problem) =>
          !destinationsReconciled.has(index) ||
          problem !==
            `Line ${index + 1} curated decision requires destination.`,
      ),
    );
  }
  for (const [index, event] of parsed.entries()) {
    if (event && !Object.hasOwn(event, "timestamp") && reconciled.has(index))
      continue;
    if (event && !nonEmptyString(event.timestamp)) {
      problems.push(`Line ${index + 1} requires non-empty timestamp.`);
    }
  }
  return problems.length === 0
    ? controlFinding(
        "MF-CURATION-001",
        registerPath,
        "pass",
        reconciled.size === 0
          ? `Curation Register contains ${lines.length} structurally valid event${lines.length === 1 ? "" : "s"}.`
          : destinationsReconciled.size === 0
            ? `Curation Register contains ${lines.length} accepted events; ${reconciled.size} historical decision instant${reconciled.size === 1 ? "" : "s"} unrecorded and reconciled.`
            : `Curation Register contains ${lines.length} accepted events; ${reconciled.size} historical omission${reconciled.size === 1 ? "" : "s"} reconciled.`,
        reconciled.size === 0
          ? "Every non-empty line is one supported curation-decision event."
          : destinationsReconciled.size === 0
            ? "The reconciled events retain unknown original decision times; later timestamps describe the reconciliation append."
            : "Historical bytes stay intact; reconciliation timestamps describe the append, not a new curation decision.",
      )
    : failedControl("MF-CURATION-001", registerPath, problems);
}

function reconcileMissingDestination({
  event,
  index,
  parsed,
  hashes,
  lines,
  reconciled,
  problems,
}: {
  event: Record<string, unknown>;
  index: number;
  parsed: Array<Record<string, unknown> | undefined>;
  hashes: Map<string, number[]>;
  lines: string[];
  reconciled: Set<number>;
  problems: string[];
}): number | undefined {
  const fail = (reason: string): undefined => {
    problems.push(`Line ${index + 1} destination reconciliation ${reason}.`);
    return undefined;
  };
  const priorIndex = (reference: unknown): number | undefined => {
    if (
      typeof reference !== "string" ||
      !/^raw-sha256:[0-9a-f]{64}$/u.test(reference)
    )
      return undefined;
    const targets = hashes.get(reference.slice("raw-sha256:".length)) ?? [];
    return targets.length === 1 ? targets[0] : undefined;
  };
  const targetIndex = priorIndex(event.supersedes);
  const evidenceIndex = priorIndex(event.destination_evidence);
  if (
    targetIndex === undefined ||
    evidenceIndex === undefined ||
    targetIndex >= evidenceIndex ||
    evidenceIndex >= index
  ) {
    return fail(
      "requires unique raw references ordered original, destination evidence, append",
    );
  }
  const target = parsed[targetIndex];
  const evidence = parsed[evidenceIndex];
  if (!target || !evidence || reconciled.has(targetIndex)) {
    return fail(
      "requires an unreconciled original and complete evidence event",
    );
  }
  if (
    target.schema_version !== 3 ||
    target.decision !== "curated" ||
    !nonEmptyString(target.source_path) ||
    Object.hasOwn(target, "destination") ||
    target.reconciliation !== undefined ||
    target.destination_evidence !== undefined ||
    !nonEmptyString(target.timestamp) ||
    validateEvent(
      { ...target, destination: "placeholder.pdf" },
      targetIndex + 1,
    ).length > 0
  ) {
    return fail(
      "original must be schema 3 curated history missing only destination",
    );
  }
  if (
    evidence.schema_version !== 3 ||
    evidence.decision !== "curated" ||
    evidence.reconciliation !== undefined ||
    evidence.destination_evidence !== undefined ||
    !nonEmptyString(evidence.timestamp) ||
    validateEvent(evidence, evidenceIndex + 1).length > 0
  ) {
    return fail("evidence must be a complete ordinary schema 3 curated event");
  }
  const identityFields = [
    "integration",
    "source_id",
    "source_path",
    "role",
    "checksum",
  ];
  if (
    typeof target.checksum !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(target.checksum) ||
    identityFields.some((field) => target[field] !== evidence[field])
  ) {
    return fail("evidence must preserve source identity and SHA-256 checksum");
  }
  if (
    event.schema_version !== 3 ||
    !nonEmptyString(event.timestamp) ||
    validateEvent(event, index + 1).length > 0 ||
    event.destination !== evidence.destination ||
    !sameHistoricalDecision(
      { ...target, destination: evidence.destination },
      Object.fromEntries(
        Object.entries(event).filter(
          ([field]) => field !== "destination_evidence",
        ),
      ),
    )
  ) {
    return fail(
      "append must preserve the original and exact evidenced destination",
    );
  }
  for (const lineIndex of [targetIndex, evidenceIndex, index]) {
    const raw = lines[lineIndex];
    if (raw === undefined || !roundTripsJsonNumbers(raw)) {
      return fail("cannot preserve a numeric JSON token exactly");
    }
  }
  const standingPath = unnumberedSourcePath(target.source_path);
  for (let laterIndex = evidenceIndex + 1; laterIndex < index; laterIndex++) {
    const later = parsed[laterIndex];
    if (
      !later ||
      later.integration !== target.integration ||
      (later.source_id !== target.source_id &&
        (typeof later.source_path !== "string" ||
          unnumberedSourcePath(later.source_path) !== standingPath))
    )
      continue;
    if (
      later.decision !== "curated" ||
      later.destination !== evidence.destination ||
      identityFields.some((field) => later[field] !== target[field])
    ) {
      return fail(`contradicts later decision on line ${laterIndex + 1}`);
    }
  }
  return targetIndex;
}

function validateEvent(input: unknown, line: number): string[] {
  if (!isRecord(input)) return [`Line ${line} is not a JSON object.`];
  const value = normalizeCurationEventOptionals(input);
  const problems: string[] = [];
  const requiredStrings = [
    "source_id",
    "integration",
    "role",
    "source_path",
    "evidence",
  ];
  const declared = readDecisions(value.schema_version);
  if (declared === undefined) {
    problems.push(
      `Line ${line} has unsupported schema_version ${JSON.stringify(value.schema_version)}; supported versions are ${joinedWithAnd(supportedVersions)}.`,
    );
  }
  // A line whose version says nothing is still read for its decision, against the newest
  // vocabulary — so an unsupported version reports what else is wrong with the line beside it.
  const decisions = declared ?? newestDecisions;
  for (const field of requiredStrings) {
    if (!nonEmptyString(value[field])) {
      problems.push(`Line ${line} requires non-empty ${field}.`);
    }
  }
  if (
    nonEmptyString(value.source_path) &&
    !isRelative(value.source_path) &&
    !isManualOrigin(value.integration)
  ) {
    problems.push(
      `Line ${line} importer source_path must be integration-relative; absolute observed locators are allowed only for manual integration user, owner-download or a name ending -manual.`,
    );
  }
  if (value.checksum !== undefined && !nonEmptyString(value.checksum)) {
    problems.push(`Line ${line} checksum must be non-empty when present.`);
  }
  if (!nonEmptyString(value.decision) || !decisions.includes(value.decision)) {
    problems.push(
      `Line ${line} decision is not one of ${decisions.join(", ")}.`,
    );
  }
  problems.push(...outcomeProblems(value, line));
  if (nonEmptyString(value.timestamp) && !validTimestamp(value.timestamp)) {
    problems.push(`Line ${line} timestamp is not an ISO 8601 instant.`);
  }
  if (value.supersedes !== undefined && !nonEmptyString(value.supersedes)) {
    problems.push(`Line ${line} supersedes must be non-empty when present.`);
  }
  return problems;
}

function isManualOrigin(integration: unknown): boolean {
  return (
    nonEmptyString(integration) &&
    (integration === "user" ||
      integration === "owner-download" ||
      integration.endsWith("-manual"))
  );
}

function sameHistoricalDecision(
  old: Record<string, unknown>,
  current: Record<string, unknown>,
): boolean {
  const excluded = new Set([
    "schema_version",
    "evidence",
    "timestamp",
    "supersedes",
    "reconciliation",
  ]);
  const fields = new Set([...Object.keys(old), ...Object.keys(current)]);
  for (const field of fields) {
    if (excluded.has(field)) continue;
    if (!isDeepStrictEqual(old[field], current[field])) return false;
  }
  return true;
}

// JSON.parse rounds some decimal tokens before the field comparison. A reconciliation must
// reject those lines rather than claim that the original unknown values were retained.
function roundTripsJsonNumbers(raw: string): boolean {
  const number = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  let insideString = false;
  let escaped = false;
  for (let offset = 0; offset < raw.length; offset++) {
    const char = raw.charAt(offset);
    if (insideString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') insideString = false;
      continue;
    }
    if (char === '"') {
      insideString = true;
      continue;
    }
    if (char !== "-" && (char < "0" || char > "9")) continue;
    number.lastIndex = offset;
    const token = number.exec(raw)?.[0];
    if (token === undefined || JSON.stringify(Number(token)) !== token)
      return false;
    offset = number.lastIndex - 1;
  }
  return true;
}

function validTimestamp(value: string): boolean {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}Z$/u.test(value)
    ? value.replace(" ", "T")
    : value;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/u.exec(
      normalized,
    );
  if (!match) return false;
  const [, year, month, day, hour, minute, second, zone] = match;
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined ||
    zone === undefined
  )
    return false;
  const offsetHour = zone === "Z" ? 0 : Number(zone.slice(1, 3));
  const offsetMinute = zone === "Z" ? 0 : Number(zone.slice(4, 6));
  if (offsetHour > 23 || offsetMinute > 59) return false;
  const instant = Date.parse(normalized);
  if (Number.isNaN(instant)) return false;
  const offset =
    zone === "Z"
      ? 0
      : (zone.startsWith("+") ? 1 : -1) * (offsetHour * 60 + offsetMinute);
  const local = new Date(instant + offset * 60_000);
  return (
    local.getUTCFullYear() === Number(year) &&
    local.getUTCMonth() + 1 === Number(month) &&
    local.getUTCDate() === Number(day) &&
    local.getUTCHours() === Number(hour) &&
    local.getUTCMinutes() === Number(minute) &&
    local.getUTCSeconds() === Number(second)
  );
}

// Where the item's content went: a curated line names the copy's destination, a rederived line
// names every artifact the content reached instead, and the two are never the same line.
function outcomeProblems(
  value: Record<string, unknown>,
  line: number,
): string[] {
  const problems: string[] = [];
  if (value.decision === "curated" && !nonEmptyString(value.destination)) {
    problems.push(`Line ${line} curated decision requires destination.`);
  }
  if (value.decision !== "curated" && value.destination !== undefined) {
    problems.push(
      `Line ${line} destination is allowed only for curated decisions.`,
    );
  }
  if (value.destination !== undefined && !nonEmptyString(value.destination)) {
    problems.push(
      `Line ${line} destination must be a non-empty string when present.`,
    );
  }
  if (nonEmptyString(value.destination) && !isRelative(value.destination)) {
    problems.push(`Line ${line} destination must be module-relative.`);
  }
  if (value.decision === "rederived") {
    problems.push(...derivedProblems(value.derived, line));
  } else if (value.derived !== undefined) {
    problems.push(
      `Line ${line} derived is allowed only for rederived decisions.`,
    );
  }
  // A withdrawal closes the item's source and settles nothing about the copy that source produced.
  // Superseding the line that placed the copy would take the record of where the item went off the
  // top of the register, which reads as the deletion MF-CURATION-002 promises never happens.
  if (value.decision === "withdrawn") {
    if (value.supersedes !== undefined) {
      problems.push(
        `Line ${line} withdrawn decision supersedes nothing: the line that placed the copy stays the record of where the item went.`,
      );
    }
    if (value.checksum !== undefined) {
      problems.push(
        `Line ${line} withdrawn decision records no checksum: its source is not there to hash.`,
      );
    }
  }
  return problems;
}

function derivedProblems(derived: unknown, line: number): string[] {
  if (!Array.isArray(derived) || derived.length === 0) {
    return [
      `Line ${line} rederived decision requires a non-empty derived list.`,
    ];
  }
  return derived.flatMap((path) => {
    if (!nonEmptyString(path)) {
      return [`Line ${line} derived must hold non-empty paths.`];
    }
    return isRelative(path)
      ? []
      : [
          `Line ${line} derived path ${JSON.stringify(path)} must be module-relative.`,
        ];
  });
}

function joinedWithAnd(versions: readonly number[]): string {
  return `${versions.slice(0, -1).join(", ")} and ${versions.at(-1)}`;
}

function readDecisions(schemaVersion: unknown): string[] | undefined {
  return typeof schemaVersion === "number"
    ? decisionsByVersion.get(schemaVersion)
    : undefined;
}

// A path a register line records stays inside the tree it is written against — the importer root
// for a source, the module folder for everything the decision produced.
function isRelative(path: string): boolean {
  return !path.startsWith("/") && !path.split("/").includes("..");
}
