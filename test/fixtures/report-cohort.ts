import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";

import type { AcademicConfig } from "../../src/config/index.js";
import { validModuleControls } from "./module-controls.js";

export async function reportCohort(
  context: TestContext,
): Promise<AcademicConfig> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-report-cohort-"));
  context.after(() => rm(root, { recursive: true }));
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "State");
  const moduleRoot = join(driveMount, "Semester", "MH2100");
  await mkdir(stateRoot);
  const contents = [
    [
      "00 Module Admin/10 Module Definition.yaml",
      validModuleControls().definition ?? "",
    ],
    [
      "00 Module Admin/40 Source Map.yaml",
      "units:\n  first:\n    topics: [Synthetic]\n    lectures: [10 Learning Materials/10 Lecture Materials/synthetic.pdf]\n    textbook: []\n    tutorials: []\n",
    ],
    ["10 Learning Materials/10 Lecture Materials/synthetic.pdf", "synthetic"],
    [
      "NTULearn/Sync status.json",
      JSON.stringify({
        schemaVersion: 1,
        producer: "ntulearn",
        status: "complete",
        startedAt: "2026-09-07T21:00:00.000Z",
        finishedAt: "2026-09-07T21:10:00.000Z",
        lastSuccessfulAt: "2026-09-07T21:10:00.000Z",
        counts: {
          downloaded: 1,
          skipped: 0,
          markdown: 0,
          uncopied: 0,
          failures: 0,
        },
        unread: [],
      }),
    ],
  ] satisfies Array<[string, string]>;
  for (const [path, source] of contents) {
    await mkdir(dirname(join(moduleRoot, path)), { recursive: true });
    await writeFile(join(moduleRoot, path), source);
  }
  return {
    driveMount,
    stateRoot,
    activeSemester: "Y2S1",
    semesters: {
      Y2S1: { root: "Semester", status: "active", modules: ["MH2100"] },
    },
  };
}
