import { readCurationRegisterEvents } from "../../curation/read-curation-register.js";
import { moduleControlPaths } from "../../conformance/control-paths.js";
import { readControlDocument } from "../../conformance/control-document.js";
import { readSourceMap } from "../../conformance/source-map.js";
import { isRecord } from "../../conformance/value-shape.js";
import { byteSha256, controlEvidence } from "../evidence.js";
import {
  diagnostic,
  type ControlDiagnostic,
  type ControlRead,
  type ControlReadInput,
  type LegacyDocument,
  type LegacyLearningRecord,
  type ObservedClaim,
} from "../types.js";

export function readLegacyModuleControls(
  input: ControlReadInput,
): Extract<ControlRead, { kind: "legacy" }> {
  const diagnostics: ControlDiagnostic[] = [];
  const documents: LegacyDocument[] = [];
  const records: LegacyLearningRecord[] = [];
  for (const file of input.files) {
    if (file.kind === "unreadable") {
      diagnostics.push(
        diagnostic(
          file.failure === "io"
            ? "legacy-control-read-failure"
            : "unreadable-legacy-control",
          file.path,
          file.reason,
          "Retain absence and inspect the original control safely; do not infer its contents.",
        ),
      );
      continue;
    }
    let source: string;
    try {
      source = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(file.bytes);
    } catch {
      diagnostics.push(
        diagnostic(
          "invalid-legacy-utf8",
          file.path,
          "Control is not valid UTF-8.",
          "Preserve the original bytes and inspect its encoding.",
        ),
      );
      continue;
    }
    const yaml = /\.ya?ml$/u.test(file.path);
    const frontmatter = source.match(
      /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u,
    )?.[1];
    const parsed =
      yaml || frontmatter !== undefined
        ? readControlDocument(yaml ? source : (frontmatter ?? ""))
        : undefined;
    let value = parsed && "value" in parsed ? parsed.value : undefined;
    if (file.path.endsWith(".jsonl")) {
      try {
        value = readCurationRegisterEvents(source);
      } catch (error) {
        diagnostics.push(
          diagnostic(
            "invalid-legacy-jsonl",
            file.path,
            error instanceof Error ? error.message : String(error),
            "Preserve the original register bytes and resolve the object-line parse error before interpreting events.",
          ),
        );
      }
    }
    if (parsed && "problems" in parsed)
      diagnostics.push(
        ...parsed.problems.map((problem) =>
          diagnostic(
            "invalid-legacy-yaml",
            file.path,
            problem,
            "Preserve the original bytes and resolve the legacy parse error before claiming a supported normalized read.",
          ),
        ),
      );
    documents.push({
      path: file.path,
      source,
      format: yaml
        ? "yaml"
        : file.path.endsWith(".jsonl")
          ? "jsonl"
          : "markdown",
      value: value ?? null,
    });
    if (/^70 Learning\/[^/]+\/records\/[^/]+\.md$/u.test(file.path)) {
      const representation = isRecord(value)
        ? supersedes(value.supersedes)
        : { supersedes: [], supersedesRepresentation: "absent" as const };
      records.push({
        path: file.path,
        value: value ?? null,
        target: claim(value, "target"),
        status: claim(value, "status"),
        unit: claim(value, "unit"),
        units: claim(value, "units"),
        topics: claim(value, "topics"),
        ...representation,
      });
      if (representation.supersedesRepresentation === "invalid")
        diagnostics.push(
          diagnostic(
            "invalid-legacy-supersedes",
            file.path,
            "supersedes is neither a string/integer record ID nor an ordered ID list.",
            "Retain the raw value and resolve it explicitly; do not invent supersession links.",
          ),
        );
    }
  }
  const definition = documents.find(
    (document) => document.path === moduleControlPaths.definition,
  )?.value;
  const source = documents.find(
    (document) => document.path === moduleControlPaths.sourceMap,
  );
  const sourceMap =
    source === undefined ? undefined : readSourceMap(source.source);
  if (sourceMap?.kind === "invalid")
    diagnostics.push(
      diagnostic(
        "invalid-legacy-source-map",
        moduleControlPaths.sourceMap,
        sourceMap.finding.evidence,
        "Use the original Source Map declaration order; resolve unsupported entries before interpreting units.",
      ),
    );
  return {
    kind: "legacy",
    shape: {
      kind: "legacy",
      declared: {
        schemaVersion: isRecord(definition)
          ? (definition.schema_version ?? null)
          : null,
        contractVersion: isRecord(definition)
          ? (definition.contract_version ?? null)
          : null,
      },
      procedureFingerprints: input.files.flatMap((file) =>
        file.kind === "file" && /^docs\/[^/]+Procedure\.md$/u.test(file.path)
          ? [{ path: file.path, sha256: byteSha256(file.bytes) }]
          : [],
      ),
      missingControls: Object.values(moduleControlPaths).filter(
        (path) => !documents.some((document) => document.path === path),
      ),
      reader: "legacy-observed/1",
    },
    evidence: controlEvidence(input.files),
    documents,
    records,
    diagnostics,
    sourceMap:
      sourceMap === undefined
        ? { kind: "absent" }
        : sourceMap.kind === "invalid"
          ? { kind: "invalid" }
          : {
              kind: "read",
              units: sourceMap.units,
              exerciseSets: sourceMap.exerciseSets,
            },
    coverage: "legacy-observation-only",
  };
}

function claim(value: unknown, key: string): ObservedClaim {
  return isRecord(value) && Object.hasOwn(value, key)
    ? { kind: "observed", value: value[key] }
    : { kind: "unknown" };
}

function supersedes(
  value: unknown,
): Pick<LegacyLearningRecord, "supersedes" | "supersedesRepresentation"> {
  if (value === undefined)
    return { supersedes: [], supersedesRepresentation: "absent" };
  if (isLegacyRecordId(value))
    return { supersedes: [value], supersedesRepresentation: "scalar" };
  if (Array.isArray(value) && value.every(isLegacyRecordId))
    return { supersedes: value, supersedesRepresentation: "list" };
  return { supersedes: [], supersedesRepresentation: "invalid" };
}

function isLegacyRecordId(value: unknown): value is string | number {
  return (
    typeof value === "string" ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
  );
}
