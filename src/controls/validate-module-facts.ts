import type {
  Artifact,
  Decision,
  LearningRecord,
  ModuleDataControl,
  SourceMapControl,
  SourceUse,
  Target,
} from "./generated/module-data-1.js";
import { validateNativeRepresentations } from "./validate-native-representations.js";
import { safeRelativePath } from "./read-controls.js";

export function validateModuleFacts({
  value,
  path,
  artifacts,
  decisions,
  sourceMap,
  supersession,
  problem,
}: {
  value: ModuleDataControl;
  path: string;
  artifacts: ReadonlyMap<string, Artifact>;
  decisions: ReadonlyMap<string, Decision>;
  sourceMap: SourceMapControl | undefined;
  supersession: ReadonlyMap<string, readonly { id: string }[]>;
  problem: (
    code: string,
    path: string,
    pointer: string,
    message: string,
  ) => void;
}): void {
  const relative = (value: string, pointer: string) => {
    if (!safeRelativePath(value))
      problem(
        "unsafe-module-data-path",
        path,
        pointer,
        `Expected a normalized module-relative path, observed ${JSON.stringify(value)}.`,
      );
  };
  const accepted = (id: string, pointer: string) => {
    if (decisions.get(id)?.status !== "accepted")
      problem(
        "unaccepted-control-decision",
        path,
        pointer,
        `${id} must resolve to an accepted decision.`,
      );
  };
  const sourceUse = (use: SourceUse, pointer: string) => {
    const artifact = artifacts.get(use.artifact.id);
    if (artifact !== undefined && artifact.source.id !== use.source.id)
      problem(
        "conflicting-source-reference",
        path,
        pointer,
        `${use.artifact.id} belongs to ${artifact.source.id}, not ${use.source.id}.`,
      );
  };
  switch (value.role) {
    case "evidence":
      for (const [index, entry] of value.entries.entries())
        if (
          entry.locator.kind === "module-file" ||
          entry.locator.kind === "retained-original"
        )
          relative(entry.locator.path, `/entries/${index}/locator/path`);
      break;
    case "definition":
      for (const [index, importer] of value.importers.entries())
        relative(importer.root, `/importers/${index}/root`);
      if (
        new Set(value.importers.map((item) => item.root)).size !==
        value.importers.length
      )
        problem(
          "duplicate-importer-root",
          path,
          "/importers",
          "Importer roots must be unique.",
        );
      break;
    case "profile":
      for (const [index, workspace] of value.workspaces.entries())
        relative(workspace.path, `/workspaces/${index}/path`);
      break;
    case "artifacts":
      validateNativeRepresentations(value.artifacts, (code, pointer, message) =>
        problem(code, path, pointer, message),
      );
      for (const [index, source] of value.sources.entries())
        for (const [locator, observed] of source.locators.entries())
          if (observed.kind === "module-file")
            relative(
              observed.value,
              `/sources/${index}/locators/${locator}/value`,
            );
      for (const [index, artifact] of value.artifacts.entries()) {
        relative(artifact.path, `/artifacts/${index}/path`);
        if (
          artifact.representation.bundleMembers.some(
            (member) => member.id === artifact.id,
          )
        )
          problem(
            "invalid-native-bundle-membership",
            path,
            `/artifacts/${index}/representation/bundleMembers`,
            "A native artifact cannot be a member of itself.",
          );
        const rawPaths = new Set<string>();
        for (const [
          entryIndex,
          entry,
        ] of artifact.representation.entries.entries()) {
          const pointer = `/artifacts/${index}/representation/entries/${entryIndex}`;
          const raw = Buffer.from(entry.pathBytesBase64, "base64");
          if (
            raw.toString("base64") !== entry.pathBytesBase64 ||
            raw.includes(0) ||
            raw[0] === 47 ||
            raw
              .toString("latin1")
              .split("/")
              .some((part) => ["", ".", ".."].includes(part))
          )
            problem(
              "invalid-native-path-bytes",
              path,
              `${pointer}/pathBytesBase64`,
              "Native path bytes must be exact base64 of a contained relative path without empty, dot or NUL components.",
            );
          if (rawPaths.has(entry.pathBytesBase64))
            problem(
              "duplicate-native-path",
              path,
              pointer,
              "A native representation path is listed more than once.",
            );
          rawPaths.add(entry.pathBytesBase64);
          if (
            (entry.kind === "symlink") !==
              (entry.symlinkTargetBytesBase64 !== null) ||
            (entry.kind === "special") !== (entry.specialType !== null)
          )
            problem(
              "conflicting-native-entry-kind",
              path,
              pointer,
              "Symlink targets and special types must match the native entry kind.",
            );
        }
      }
      if (
        new Set(value.artifacts.map((item) => item.path)).size !==
        value.artifacts.length
      )
        problem(
          "duplicate-artifact-path",
          path,
          "/artifacts",
          "One exact module path cannot identify multiple artifacts.",
        );
      break;
    case "source-map":
      if (
        value.availability.kind === "unknown" &&
        (value.units.length || value.teachingWeeks.length)
      )
        problem(
          "conflicting-source-map-availability",
          path,
          "/availability",
          "An unknown historical Source Map cannot establish units or teaching weeks. Record mapped claims with evidence, or retain the unknown state.",
        );
      for (const [index, unit] of value.units.entries()) {
        for (const field of ["lectures", "textbook", "supplementary"] as const)
          unit[field].forEach((use, offset) => {
            sourceUse(use, `/units/${index}/${field}/${offset}`);
          });
        for (const [offset, block] of unit.tutorials.entries())
          block.sources.forEach((use, source) => {
            sourceUse(
              use,
              `/units/${index}/tutorials/${offset}/sources/${source}`,
            );
          });
      }
      break;
    case "terms":
      for (const [index, term] of value.entries.entries())
        if (
          ![...supersession.values()].some((refs) =>
            refs.some((ref) => ref.id === term.id),
          )
        )
          accepted(term.decision.id, `/entries/${index}/decision`);
      break;
    case "preferences":
      value.refinements.forEach((item, index) => {
        accepted(item.ownerDecision.id, `/refinements/${index}/ownerDecision`);
      });
      break;
    case "learning-records":
      value.records.forEach((record, index) => {
        const target = establishedTarget(record);
        if (target !== undefined)
          validateTarget(target, sourceMap, artifacts, (message) =>
            problem(
              "invalid-learning-target",
              path,
              `/records/${index}/target`,
              message,
            ),
          );
        if (
          record.kind === "legacy-evidence" &&
          record.established.includes("exact-single-topic-coverage") &&
          !(target?.kind === "revision" && target.topics.length === 1)
        )
          problem(
            "invalid-legacy-coverage-claim",
            path,
            `/records/${index}/established`,
            "Exact single-topic coverage requires an established revision target naming exactly one topic. Missing historical targets remain unknown.",
          );
      });
      for (const [index, assessment] of value.assessments.entries()) {
        if (
          assessment.kind === "rubric-linked" &&
          assessment.authority.kind !== "known"
        )
          problem(
            "missing-assessment-rubric",
            path,
            `/assessments/${index}/authority`,
            "A rubric-linked assessment requires its established rubric authority. Use a provisional judgment when no rubric is established.",
          );
        for (const [criterion, marks] of assessment.criteria.entries())
          if (decimalGreater(marks.estimated, marks.maximum))
            problem(
              "invalid-assessment-marks",
              path,
              `/assessments/${index}/criteria/${criterion}/estimated`,
              "Estimated marks exceed the stated maximum.",
            );
      }
      break;
    case "revisit":
      for (const [index, entry] of value.entries.entries()) {
        if (
          (entry.state === "owner-resolved") !==
          (entry.ownerDecision !== null)
        )
          problem(
            "invalid-revisit-resolution",
            path,
            `/entries/${index}`,
            "Only an Owner-resolved entry carries its accepted Owner decision.",
          );
        if (entry.ownerDecision !== null)
          accepted(entry.ownerDecision.id, `/entries/${index}/ownerDecision`);
      }
      break;
    case "textbooks":
      value.entries.forEach((item, index) => {
        if (item.pages.first > item.pages.last)
          problem(
            "invalid-textbook-pages",
            path,
            `/entries/${index}/pages`,
            "The last page precedes the first page.",
          );
      });
      break;
    case "curation":
      value.events.forEach((event, index) => {
        if (
          ["curated", "rederived"].includes(event.decision) &&
          event.artifacts.length === 0
        )
          problem(
            "missing-curation-artifact",
            path,
            `/events/${index}/artifacts`,
            `${event.decision} requires its actual destination artifacts.`,
          );
        if (event.decision === "withdrawn" && event.supersedes.length)
          problem(
            "invalid-withdrawal-supersession",
            path,
            `/events/${index}/supersedes`,
            "Withdrawal retains the earlier placement history and supersedes nothing.",
          );
      });
      break;
    case "provider-mirrors":
      for (const [index, mirror] of value.entries.entries())
        if (
          new Set(mirror.items.map((item) => item.providerId)).size !==
          mirror.items.length
        )
          problem(
            "duplicate-provider-item",
            path,
            `/entries/${index}/items`,
            "Provider IDs must be unique within one exact mirror target.",
          );
      if (
        new Set(
          value.entries.map((item) => `${item.provider}:${item.targetId}`),
        ).size !== value.entries.length
      )
        problem(
          "duplicate-provider-target",
          path,
          "/entries",
          "A provider target has more than one selected mirror.",
        );
      break;
    case "decisions":
    case "glossary":
    case "resources":
    case "verification":
    case "learning-workspace":
      break;
    default: {
      const _exhaustive: never = value;
      break;
    }
  }
}

function establishedTarget(record: LearningRecord): Target | undefined {
  if (record.kind === "current") return record.target;
  return record.parsedTarget.kind === "established"
    ? record.parsedTarget.value
    : undefined;
}

function validateTarget(
  target: Target,
  map: SourceMapControl | undefined,
  artifacts: ReadonlyMap<string, Artifact>,
  reject: (message: string) => void,
): void {
  if (target.kind === "past-paper") {
    const paper = artifacts.get(target.paper.id);
    if (paper !== undefined && !paper.traits.content.includes("questions"))
      reject(
        "A past-paper target must bind an artifact with question content.",
      );
    return;
  }
  const unit = map?.units.find((unit) => unit.id === target.unit.id);
  if (unit === undefined) {
    reject(
      `Target unit ${target.unit.id} is absent from the ordered Source Map.`,
    );
    return;
  }
  if (
    target.kind === "tutorial" &&
    !unit.tutorials.some((block) => block.id === target.block.id)
  )
    reject(`Tutorial block ${target.block.id} does not belong to ${unit.id}.`);
  if (target.kind !== "revision") return;
  const indices = target.topics.map((topic) =>
    unit.topics.findIndex((entry) => entry.id === topic.id),
  );
  const first = indices[0];
  if (
    first === undefined ||
    first < 0 ||
    indices.some((position, index) => position !== first + index)
  )
    reject(
      `Revision topics must be one ordered contiguous block within unit ${unit.id}.`,
    );
}

function decimalGreater(left: string, right: string): boolean {
  const [leftWhole = "0", leftFraction = ""] = left.split(".");
  const [rightWhole = "0", rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  return (
    BigInt(leftWhole + leftFraction.padEnd(scale, "0")) >
    BigInt(rightWhole + rightFraction.padEnd(scale, "0"))
  );
}
