import { isRecord } from "../conformance/value-shape.js";
import type {
  Artifact,
  Decision,
  SourceMapControl,
} from "./generated/module-data-1.js";
import { validateModuleFacts } from "./validate-module-facts.js";
import {
  diagnostic,
  type CanonicalControl,
  type ControlDiagnostic,
  type ControlObservation,
} from "./types.js";

import {
  moduleDataRoles,
  canonicalReferenceKinds,
} from "./generated/supported-controls.js";
export { moduleDataRoles };

export function validateModuleGraph(
  controls: readonly CanonicalControl[],
  generationPath: string,
  observations: readonly ControlObservation[] = [],
): ControlDiagnostic[] {
  const diagnostics: ControlDiagnostic[] = [];
  const identities = new Map<
    string,
    { kind: string; path: string; pointer: string }
  >();
  const supersession = new Map<string, readonly { id: string }[]>();
  const artifacts = new Map<string, Artifact>();
  const decisions = new Map<string, Decision>();
  let sourceMap: SourceMapControl | undefined;
  const problem = (
    code: string,
    path: string,
    pointer: string,
    message: string,
  ) => {
    diagnostics.push(
      diagnostic(
        code,
        path,
        message,
        "Correct the referenced canonical data in a new candidate generation and validate again; selected generations remain immutable.",
        pointer,
      ),
    );
  };
  for (const role of ["module-identity", ...moduleDataRoles])
    if (!controls.some((control) => control.role === role))
      problem(
        "missing-module-data-role",
        generationPath,
        "/controls",
        `Full module data requires role ${role}, including an explicit empty control when applicable.`,
      );

  const add = (
    kind: string,
    entries: readonly { id: string; supersedes?: readonly { id: string }[] }[],
    path: string,
    pointer: string,
  ) => {
    for (const [index, entry] of entries.entries()) {
      const location = `${pointer}/${index}`;
      const previous = identities.get(entry.id);
      if (previous !== undefined)
        problem(
          "duplicate-control-id",
          path,
          `${location}/id`,
          `${entry.id} already identifies ${previous.kind} at ${previous.path}${previous.pointer}.`,
        );
      else identities.set(entry.id, { kind, path, pointer: location });
      if (entry.supersedes !== undefined)
        supersession.set(entry.id, entry.supersedes);
    }
  };
  for (const control of controls) {
    if (control.role === "module-identity") continue;
    const value = control.value;
    const path = control.path;
    switch (value.role) {
      case "evidence":
        add("evidence", value.entries, path, "/entries");
        break;
      case "artifacts":
        add("source", value.sources, path, "/sources");
        add("artifact", value.artifacts, path, "/artifacts");
        for (const artifact of value.artifacts)
          artifacts.set(artifact.id, artifact);
        break;
      case "source-map":
        sourceMap = value;
        add("teaching-week", value.teachingWeeks, path, "/teachingWeeks");
        add("unit", value.units, path, "/units");
        for (const [index, unit] of value.units.entries()) {
          add("topic", unit.topics, path, `/units/${index}/topics`);
          add(
            "tutorial-block",
            unit.tutorials,
            path,
            `/units/${index}/tutorials`,
          );
        }
        break;
      case "terms":
        add("term", value.entries, path, "/entries");
        break;
      case "decisions":
        add("decision", value.entries, path, "/entries");
        for (const decision of value.entries)
          decisions.set(decision.id, decision);
        break;
      case "preferences":
        add("preference", value.refinements, path, "/refinements");
        break;
      case "learning-records":
        add("learning-record", value.records, path, "/records");
        add("assessment", value.assessments, path, "/assessments");
        break;
      case "revisit":
        add("revisit", value.entries, path, "/entries");
        break;
      case "glossary":
        add("concept", value.entries, path, "/entries");
        break;
      case "resources":
        add("resource", value.entries, path, "/entries");
        break;
      case "textbooks":
        add("textbook", value.entries, path, "/entries");
        break;
      case "curation":
        add("curation-event", value.events, path, "/events");
        break;
      case "provider-mirrors":
        add("provider-mirror", value.entries, path, "/entries");
        break;
      case "verification":
        add("verification-check", value.checks, path, "/checks");
        break;
      case "learning-workspace":
        add("workspace-note", value.notes, path, "/notes");
        break;
      case "definition":
        add("exception", value.exceptions, path, "/exceptions");
        break;
      case "profile":
        add("profile-claim", value.scope, path, "/scope");
        add("teaching-component", value.teaching, path, "/teaching");
        add("assessment-component", value.assessments, path, "/assessments");
        add("profile-gap", value.gaps, path, "/gaps");
        break;
      default: {
        const exhaustive: never = value;
        return exhaustive;
      }
    }
  }
  for (const control of controls) {
    if (control.role === "module-identity") continue;
    const path = control.path;
    visitReferences(control.value, "", (reference, pointer) => {
      const target = identities.get(reference.id);
      if (target === undefined)
        problem(
          "missing-control-reference",
          path,
          pointer,
          `No ${reference.kind} has ID ${reference.id}.`,
        );
      else if (target.kind !== reference.kind)
        problem(
          "wrong-kind-control-reference",
          path,
          pointer,
          `${reference.id} identifies ${target.kind}, but this field requires ${reference.kind}.`,
        );
    });
    validateModuleFacts({
      value: control.value,
      path,
      artifacts,
      decisions,
      sourceMap,
      controls,
      observations,
      supersession,
      problem,
    });
  }
  const completed = new Set<string>();
  for (const id of supersession.keys()) {
    if (completed.has(id)) continue;
    const active = new Set<string>();
    const stack: { id: string; exit: boolean }[] = [{ id, exit: false }];
    while (stack.length) {
      const next = stack.pop();
      if (next === undefined) break;
      if (next.exit) {
        active.delete(next.id);
        completed.add(next.id);
        continue;
      }
      if (active.has(next.id)) {
        const location = identities.get(next.id);
        problem(
          "control-supersession-cycle",
          location?.path ?? generationPath,
          `${location?.pointer ?? ""}/supersedes`,
          `Supersession cycle reaches ${next.id}.`,
        );
        continue;
      }
      if (completed.has(next.id)) continue;
      active.add(next.id);
      stack.push({ id: next.id, exit: true });
      for (const ref of supersession.get(next.id) ?? [])
        stack.push({ id: ref.id, exit: false });
    }
  }
  return diagnostics;
}

function visitReferences(
  value: unknown,
  pointer: string,
  visit: (reference: { kind: string; id: string }, pointer: string) => void,
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      visitReferences(entry, `${pointer}/${index}`, visit);
    });
    return;
  }
  if (!isRecord(value)) return;
  if (
    Object.keys(value).length === 2 &&
    typeof value.kind === "string" &&
    typeof value.id === "string" &&
    canonicalReferenceKinds.some((kind) => kind === value.kind)
  ) {
    visit({ kind: value.kind, id: value.id }, pointer);
    return;
  }
  for (const [key, entry] of Object.entries(value))
    visitReferences(
      entry,
      `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
      visit,
    );
}
