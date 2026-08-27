import { join } from "node:path";

import type { AcademicConfig } from "../config/index.js";
import { readDefinitionImporterSources } from "../conformance/index.js";
import { readModuleControls } from "../mounted/index.js";
import { hashSource } from "./hash-source.js";
import {
  ambiguous,
  indexMirror,
  observeCohortCurationRegisters,
} from "./observe-cohort-curation-registers.js";
import { curationSplitCandidates } from "./read-curation-splits.js";
import {
  readCurationRegisterEvents,
  walkedCurationItems,
} from "./read-curation-register.js";
import type {
  CohortCurationRederivations,
  CurationSplitCandidate,
  ObservedModuleRederivation,
  ObservedRederivationSource,
} from "./rederivation-types.js";

// The active cohort's registers, plus the bytes a split correction has to compare: each candidate
// source, and every destination its standing batch names. Told a copy from a cut by nothing else —
// MF-CURATION-005 decides per destination, and only the bytes say which is which.
//
// Built on the observation `curation migrate` already makes, so both passes see one cohort and one
// materialization. Only candidate items are hashed: reading a whole mirror to answer a question
// about a handful of split sources would read the Owner's material for no decision this pass can
// reach.
export async function observeCohortCurationRederivations(
  config: AcademicConfig,
): Promise<CohortCurationRederivations> {
  const cohort = await observeCohortCurationRegisters(config);
  const modules: ObservedModuleRederivation[] = [];
  const unresolved = [...cohort.unresolved];
  for (const observed of cohort.modules) {
    const moduleRoot = cohort.moduleRoots.get(observed.module);
    if (moduleRoot === undefined) {
      unresolved.push({
        module: observed.module,
        semester: observed.semester,
        reason: "No module root resolved for this register.",
      });
      continue;
    }
    modules.push({
      module: observed.module,
      semester: observed.semester,
      register: observed.register,
      integrations: observed.integrations,
      ...(await observeSplitBytes(moduleRoot, observed)),
    });
  }
  return { ...cohort, modules, unresolved };
}

async function observeSplitBytes(
  moduleRoot: string,
  observed: { register: string; integrations: readonly string[] },
): Promise<{
  sources: Map<string, ObservedRederivationSource>;
  artifacts: Map<string, string>;
}> {
  const sources = new Map<string, ObservedRederivationSource>();
  const artifacts = new Map<string, string>();
  const candidates = splitCandidates(observed);
  if (candidates.length === 0) return { sources, artifacts };

  const controls = await readModuleControls(moduleRoot);
  const mirror = await indexMirror(
    moduleRoot,
    readDefinitionImporterSources(controls.definition),
  );
  for (const candidate of candidates) {
    const found = mirror.get(candidate.key);
    if (found !== undefined && found !== ambiguous) {
      const digests = await hashSource(join(moduleRoot, found.location));
      if (digests !== undefined) {
        sources.set(candidate.key, {
          location: found.location,
          sourcePath: found.sourcePath,
          sha256: digests.sha256,
        });
      }
    }
    for (const { destination } of candidate.lines) {
      if (artifacts.has(destination)) continue;
      const digests = await hashSource(join(moduleRoot, destination));
      if (digests !== undefined) artifacts.set(destination, digests.sha256);
    }
  }
  return { sources, artifacts };
}

// A register that will not parse is a blocker the plan reports; nothing is hashed for it.
function splitCandidates(observed: {
  register: string;
  integrations: readonly string[];
}): CurationSplitCandidate[] {
  try {
    return curationSplitCandidates(
      walkedCurationItems(
        readCurationRegisterEvents(observed.register),
        observed.integrations,
      ),
    );
  } catch {
    return [];
  }
}
