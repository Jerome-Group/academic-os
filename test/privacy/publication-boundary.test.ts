import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { it } from "node:test";

import { findPublicationBoundaryViolations } from "../../src/privacy/index.js";

it("detects credentials, academic content, and private state before publication", () => {
  const privateKey = [
    "-----BEGIN",
    " PRIVATE KEY-----",
    "\nnot-a-real-key\n",
    "-----END PRIVATE KEY-----",
  ].join("");
  const files = [
    { path: "modules/MH2100/lecture.pdf", contents: privateKey },
    { path: "notes.md", contents: "academic markdown" },
    {
      path: "study-guide.md",
      contents: "# Study Guide\n\nWeek 01: vector spaces.",
    },
    {
      path: "homework.ts",
      contents: "// Assignment 01: prove the theorem.",
    },
    { path: "sorting.ts", contents: "// SC1003 Lab: implement sorting." },
    { path: "proofs.md", contents: "Compactness argument." },
    { path: "reports/audit.json", contents: "private state" },
    { path: "src/credential.ts", contents: privateKey },
  ];

  assert.deepEqual(
    findPublicationBoundaryViolations(files).map(({ kind }) => kind),
    [
      "academic-content",
      "credential",
      "academic-content",
      "academic-content",
      "academic-content",
      "academic-content",
      "academic-content",
      "private-state",
      "credential",
    ],
  );
});

it("keeps every tracked or untracked publication candidate inside the boundary", async () => {
  const paths = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter((path) => path.length > 0);
  const candidates = await Promise.all(
    paths.map(async (path) => {
      try {
        return { path, contents: await readFile(path, "utf8") };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return undefined;
        throw error;
      }
    }),
  );
  const files = candidates.filter((candidate) => candidate !== undefined);

  assert.deepEqual(findPublicationBoundaryViolations(files), []);
});

it("admits a seed-source template carrying its destination's name", () => {
  const files = [
    {
      path: "seed-templates/70 Learning/templates/lecture-walkthrough.template.tex",
      contents: "\\section{Where this sits}",
    },
    {
      path: "seed-templates/70 Learning/templates/lecture-walkthrough.tex",
      contents: "\\section{Where this sits}",
    },
    {
      path: "seed-templates/70 Learning/templates/reference-sheet.template.tex",
      contents: "\\section{Week 03}",
    },
    {
      path: "seed-templates/70 Learning/templates/reference-sheet.template.pdf",
      contents: "%PDF-1.7",
    },
  ];

  assert.deepEqual(findPublicationBoundaryViolations(files), [
    { path: files[1]?.path, kind: "academic-content" },
    { path: files[2]?.path, kind: "academic-content" },
    { path: files[3]?.path, kind: "academic-content" },
  ]);
});

it("scans named normative research-project documents for injected coursework", () => {
  const normative = [
    "docs/research-project-folder-contract.md",
    "docs/research/ureca-spms-research-project-workspaces.md",
  ].map((path) => ({
    path,
    contents: "# Project 01\n\nMH2100 theorem and proof guidance.\n",
  }));
  const unnamed = {
    path: "docs/research/project-notes.md",
    contents: "# Project 01\n\nMH2100 theorem and proof guidance.\n",
  };

  assert.deepEqual(findPublicationBoundaryViolations(normative), [
    { path: normative[0]?.path, kind: "academic-content" },
    { path: normative[1]?.path, kind: "academic-content" },
  ]);
  assert.deepEqual(findPublicationBoundaryViolations([unnamed]), [
    { path: unnamed.path, kind: "academic-content" },
  ]);
});

it("scans README prose while admitting an ordinary normative overview", () => {
  const normative = {
    path: "README.md",
    contents:
      "# academic-os\n\nResearch projects use a separate configured root.\n\n`academic-os audit --module MH2200` audits one target.\n",
  };
  const coursework = {
    path: "README.md",
    contents: "# Theorem\n\nProof of the module result.\n",
  };

  assert.deepEqual(findPublicationBoundaryViolations([normative]), []);
  assert.deepEqual(findPublicationBoundaryViolations([coursework]), [
    { path: coursework.path, kind: "academic-content" },
  ]);
});

it("rejects private Calendar workspace and provider-response files", () => {
  const files = [
    {
      path: "calendar/owned-calendars.json",
      contents: '{"Academic":"provider-calendar-id"}',
    },
    {
      path: "calendar-provider-responses/setup.json",
      contents: '{"id":"provider-calendar-id"}',
    },
    {
      path: "tmp/setup.calendar-provider-response.json",
      contents: '{"id":"provider-calendar-id"}',
    },
  ];

  assert.deepEqual(findPublicationBoundaryViolations(files), [
    { path: files[0]?.path, kind: "private-state" },
    { path: files[1]?.path, kind: "private-state" },
    { path: files[2]?.path, kind: "private-state" },
  ]);
});
