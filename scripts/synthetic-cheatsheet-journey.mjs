import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createModuleSeedPlan } from "../dist/src/seed/create-module-seed-plan.js";
import { loadModuleContract } from "../dist/src/contract/load-module-contract.js";
const workspace = await mkdtemp(
  join(tmpdir(), "academic-os-synthetic-midterm-"),
);
const root = join(workspace, "Modules/Y2S1/MH2100");
const personal = "10 Learning Materials/30 Personal Notes";
const support = `${personal}/support/midterm-aid`;
const source = `Synthetic acceptance source; not actual MH2100 coursework.
Assessment: synthetic midterm, one A4 monochrome page, body >= 10pt, two columns allowed.
Scope: limits of difference quotients, derivative at a point, chain rule.
Q1: Prove x^2 has derivative 2a at every real a using the difference quotient.
Q2: Differentiate sin(x^2); explain composition and the chain rule.
Q3: Explain why |x| has no derivative at zero using one-sided difference quotients.
Authority: synthetic issued assessment notice dated 2026-10-02; no actual exam permission asserted.`;
const contract = await loadModuleContract();
const definition = `schema_version: 2
contract_version: ${contract.version}
module: {code: MH2100, title: Synthetic calculus}
offering: {academic_year: 2026-2027, semester: 1, status: active}
structure:
  tutorials: {layout: flat}
  assessments:
    quizzes: {enabled: false}
    tests: {enabled: false}
    assignments: {enabled: false}
  projects: {enabled: false}
  labs: {enabled: false}
  resource_categories: []
sources:
  ntulearn:
    - {role: primary, destination: NTULearn, evidence: [synthetic-notice]}
evidence:
  synthetic-notice: {source: synthetic issued notice, checked_at: 2026-10-02}
exceptions: []
`;
const profile = `# MH2100 — Synthetic calculus
## Offering
| Field | Value | Evidence |
| --- | --- | --- |
| Academic year | 2026-2027 | Definition |
| Semester | 1 | Definition |
## Scope
Synthetic difference quotients and chain rule.
## Teaching Structure
- Synthetic lectures and questions.
## Assessment Structure
| Component | Weight | Timing | Evidence |
| --- | --- | --- | --- |
| Midterm | 20% | synthetic Week 6 | synthetic-notice.md |
## Source Authority
| Rank | Source | Role | Governs | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Synthetic notice | Primary | Synthetic assessment | synthetic-notice.md |
## Workspaces
| Workspace | Purpose | Pointer |
| --- | --- | --- |
| Learning | Synthetic practice | 70 Learning |
## Known Gaps
| Gap | Consequence | Next evidence |
| --- | --- | --- |
| No real assessment facts | Synthetic acceptance only | Actual exam notice outside this fixture |
`;
const seedPlan = createModuleSeedPlan({
  module: "MH2100",
  semester: "Y2S1",
  profile,
  definition,
  contract,
});
if (seedPlan.blockers.length > 0) throw new Error(seedPlan.blockers.join(" "));
for (const operation of seedPlan.operations) {
  const destination = join(root, operation.path);
  if (operation.kind === "directory")
    await mkdir(destination, { recursive: true });
  else {
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, operation.contents ?? "");
  }
}
await mkdir(join(root, support), { recursive: true });
await writeFile(join(root, "NTULearn/synthetic-notice.md"), source);
await writeFile(
  join(root, "00 Module Admin/40 Source Map.yaml"),
  "units:\n  Unit 1:\n    topics: [Derivative, Chain rule]\n    lectures: [NTULearn/synthetic-notice.md]\n    textbook: []\n    tutorials: []\n",
);
const runtime =
  process.env.CHEATSHEET_RUNTIME_PATH ??
  join(process.cwd(), "skills/cheatsheet/scripts/cheatsheet-tool.mjs");
const manifestPath = `${support}/manifest.yaml`;
const command = (operation, flags = []) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [runtime, operation, "--module-root", root, ...flags],
      { encoding: "utf8", stdio: "pipe" },
    ),
  );
const prepare = command("prepare", [
  "--module-code",
  "MH2100",
  "--assessment",
  "midterm",
]);
const preamble = await readFile(
  "seed-templates/70 Learning/templates/mathematics-cheatsheet-preamble.template.tex",
  "utf8",
);
const logo = await readFile(
  "seed-templates/70 Learning/templates/chatgpt-logo.template.tex",
  "utf8",
);
const tex = String.raw`\documentclass[a4paper,10pt]{article}
\newcommand{\SheetBodyPointSize}{10}\newcommand{\SheetBodyLeading}{12}
\newcommand{\SheetMathScriptPointSize}{7}\newcommand{\SheetMathScriptScriptPointSize}{5}
\newcommand{\SheetColumns}{2}
\newcommand{\SheetLeftMargin}{15mm}\newcommand{\SheetRightMargin}{15mm}
\newcommand{\SheetTopMargin}{15mm}\newcommand{\SheetBottomMargin}{15mm}
\newcommand{\SheetHeaderBaseline}{5mm}\newcommand{\SheetFooterBaseline}{5mm}
${logo}
${preamble}
\SheetSetup{title={Synthetic MH2100 acceptance},credit={},disclaimer={Synthetic only},publisher={},logo={}}
\setlength{\columnsep}{8mm}
\begin{document}\typeout{CHEATSHEET-BODY-PT=10}
\begin{center}\textbf{Synthetic MH2100 Midterm Aid}\\
Acceptance fixture only --- not actual coursework or exam permission\end{center}
\noindent Map: 1 Difference quotients; 2 Composition; 3 Failure at a corner.
\begin{CheatSheet}\spaceskip=0pt\xspaceskip=0pt\setlength{\parskip}{3pt}
\Topic[Q1]{Derivative from a limit}\label{Q1}
\textbf{Source Q1.} For a real function $f$ on a neighbourhood of $a$, the derivative is
\[f'(a)=\lim_{h\to0}\frac{f(a+h)-f(a)}h,\]
when this finite two-sided limit exists. The quotient compares output change with input change; the limit asks for its value at increasingly small scales.
For $f(x)=x^2$ and $h\ne0$,
\[\frac{(a+h)^2-a^2}{h}=2a+h\longrightarrow2a.\]
Thus $f'(a)=2a$ for every real $a$. Cancellation is valid before taking the limit because $h$ approaches zero through nonzero values.
\columnbreak
\Topic[Q2]{Chain rule}\label{Q2}
\textbf{Source Q2.} If $g$ is differentiable at $x$ and $F$ at $g(x)$, then
\[(F\circ g)'(x)=F'(g(x))g'(x).\]
The outer rate is evaluated at the inner output; the inner rate converts input change to that output change. With $g(x)=x^2$ and $F(u)=\sin u$,
\[\frac{d}{dx}\sin(x^2)=2x\cos(x^2).\]
Both functions are differentiable everywhere on $\mathbb R$. This result holds at zero too: no division by $x$ was used.
\Topic[Q3]{Check a corner}\label{Q3}
\textbf{Source Q3.} For $f(x)=|x|$ at zero,
\[\frac{|h|-|0|}{h}=\begin{cases}1&h>0,\\-1&h<0.\end{cases}\]
The right and left limits disagree, so $f'(0)$ does not exist. Continuity at zero alone does not imply differentiability there.
\paragraph{Assumptions and provenance}
All questions and constraints come from the explicitly synthetic notice. Worked reasoning is independently derived. No official solution or real assessment scope is claimed. Every question has a stable label.
\end{CheatSheet}
\end{document}`;
await writeFile(join(root, personal, "Synthetic Midterm Aid.tex"), tex);
const interruptedDraftSha256 = createHash("sha256")
  .update(await readFile(join(root, personal, "Synthetic Midterm Aid.tex")))
  .digest("hex");
await writeFile(
  join(workspace, "interrupted-authoring.json"),
  JSON.stringify({
    injection: "stop after durable TeX before PDF and manifest",
    interruptedDraftSha256,
  }),
);
let interruptedReleaseRefused = false;
try {
  command("audit", ["--manifest", manifestPath]);
} catch {
  interruptedReleaseRefused = true;
}
if (!interruptedReleaseRefused)
  throw new Error("Incomplete interrupted authoring was accepted.");
const resumedDraft = await readFile(
  join(root, personal, "Synthetic Midterm Aid.tex"),
);
if (
  createHash("sha256").update(resumedDraft).digest("hex") !==
  interruptedDraftSha256
)
  throw new Error("Resume altered durable draft.");
await mkdir(join(workspace, "compile"), { recursive: true });
execFileSync(
  "latexmk",
  [
    "-norc",
    "-pdf",
    "-interaction=nonstopmode",
    "-halt-on-error",
    "-no-shell-escape",
    `-auxdir=${join(workspace, "compile")}`,
    "Synthetic Midterm Aid.tex",
  ],
  { cwd: join(root, personal), stdio: "ignore" },
);
const pdf = await readFile(join(root, personal, "Synthetic Midterm Aid.pdf"));
const hash = (b) => createHash("sha256").update(b).digest("hex");
const manifest = `schema_version: 1
artifact:
  id: midterm-aid
  title: Synthetic midterm aid
  scope: Synthetic derivative and chain rule questions
  release_tex: ${personal}/Synthetic Midterm Aid.tex
  release_pdf: ${personal}/Synthetic Midterm Aid.pdf
  support: ${support}
authoring:
  kind: self-contained
  path: ${personal}/Synthetic Midterm Aid.tex
  sha256: ${hash(tex)}
constraints:
  paper: A4
  pages: {maximum: 1}
  color: monochrome
  columns: 2
  body_pt: {preferred: 10, floor: 10}
sources:
  - id: notice
    path: NTULearn/synthetic-notice.md
    sha256: ${hash(source)}
    authority: issued-current
    locators: [Q1, Q2, Q3]
    required_locators: [Q1, Q2, Q3]
coverage: ${support}/coverage.csv
release:
  tex_sha256: ${hash(tex)}
  pdf_sha256: ${hash(pdf)}
  review: {status: unreviewed}
`;
await writeFile(join(root, support, "manifest.yaml"), manifest);
await writeFile(
  join(root, support, "coverage.csv"),
  "item_id,source_id,locator,topic_id,priority,disposition,artifact_locator,note\nq1,notice,Q1,derivative,required,condensed,Q1,\nq2,notice,Q2,chain-rule,required,condensed,Q2,\nq3,notice,Q3,corner,required,condensed,Q3,\n",
);
const repeated = command("prepare", [
  "--module-code",
  "MH2100",
  "--assessment",
  "midterm",
]);
if (JSON.stringify(prepare) !== JSON.stringify(repeated))
  throw new Error("Repeated context differs without input changes.");
const audit = command("audit", ["--manifest", manifestPath]);
const verify = command("verify", [
  "--manifest",
  manifestPath,
  "--evidence-directory",
  `${support}/build-evidence`,
]);
const build = verify.buildEvidence;
if (build === undefined)
  throw new Error("Selected build evidence was not retained.");
const preservation = command("preservation", [
  "--manifest",
  manifestPath,
  "--baseline-tex",
  build.source.path,
  "--baseline-sha256",
  hash(tex),
]);
const scratch = ".scratch/cheatsheets/midterm-aid/synthetic";
await mkdir(join(root, scratch), { recursive: true });
await writeFile(join(root, scratch, "candidate.tex"), tex);
const recipe =
  "# Synthetic composition provenance; not executed by the helper.\n";
await writeFile(join(root, support, "assemble.py"), recipe);
await writeFile(
  join(root, support, "construction.json"),
  JSON.stringify({
    recipe: { path: `${support}/assemble.py`, sha256: hash(recipe) },
    inputs: [{ path: "NTULearn/synthetic-notice.md", sha256: hash(source) }],
    base_tex_sha256: hash(tex),
    output_tex_sha256: hash(tex),
  }),
);
const regeneration = command("regeneration-check", [
  "--manifest",
  manifestPath,
  "--candidate",
  `${scratch}/candidate.tex`,
  "--construction",
  `${support}/construction.json`,
]);
if (regeneration.published !== false)
  throw new Error("Regeneration check unexpectedly published a release.");
await writeFile(
  join(root, scratch, "references.tex"),
  String.raw`See \SheetRef{chain}. Gaussian and $x^2$ remain unchanged.`,
);
await writeFile(
  join(root, support, "references.json"),
  JSON.stringify({
    chain: { kind: "named-result", id: "chain-rule", display: "Chain rule" },
  }),
);
const references = command("present-references", [
  "--source",
  `${scratch}/references.tex`,
  "--references",
  `${support}/references.json`,
]);
if (
  references.formatted !== 1 ||
  references.published !== false ||
  !references.source.includes("Gaussian")
)
  throw new Error("Structured reference presentation failed.");
const observed = (value, method, evidence, kind = "measured") => ({
  kind,
  value,
  method,
  evidence,
});
const xml = await readFile(join(root, build.fullXml.path), "utf8");
const boxes = [...xml.matchAll(/<text\b([^>]*)>[\s\S]*?<\/text>/gu)].map(
  (match) => {
    const attr = (key) =>
      ((Number(new RegExp(`\\b${key}="(-?[0-9.]+)"`, "u").exec(match[1])?.[1]) /
        3) *
        25.4) /
      72;
    return {
      left: attr("left"),
      top: attr("top"),
      bottom: attr("top") + attr("height"),
    };
  },
);
const columns = [1, 2].map((column) => {
  const lines = boxes
    .filter(
      (box) =>
        box.top >= 15 &&
        box.bottom <= 282 &&
        (column === 1 ? box.left < 105 : box.left >= 105),
    )
    .sort((a, b) => a.top - b.top);
  if (lines.length === 0)
    throw new Error(`No inspected text in synthetic column ${column}.`);
  let end = lines[0].bottom;
  let gap = 0;
  for (const line of lines.slice(1)) {
    gap = Math.max(gap, line.top - end);
    end = Math.max(end, line.bottom);
  }
  return {
    page: 1,
    column,
    geometry: observed(
      {
        topMm: 15,
        bottomMm: 282,
        contentTopMm: lines[0].top,
        contentBottomMm: end,
        largestInternalGapBaselines: gap / ((12 * 25.4) / 72),
      },
      "Full XML text bounding boxes classified by physical column; text-box gaps only.",
      [build.fullXml, build.releasedRenders[0]],
    ),
    continuation: observed(
      { status: "none" },
      "Synthetic Q1 is deliberately in column 1; Q2 and Q3 begin and end in column 2. Frozen-column review remains separate.",
      [build.releasedRenders[0]],
      "manual",
    ),
  };
});
const measurement = {
  schemaVersion: 2,
  release: {
    artifactId: "midterm-aid",
    manifestSha256: hash(manifest),
    texSha256: hash(tex),
    pdfSha256: hash(pdf),
  },
  build,
  metrics: {
    pages: observed(1, "pdfinfo selected isolated build", [build.pdfInfo]),
    bodyPt: observed(10, "Visible XML dominant native text at zoom 3", [
      build.fontXml,
    ]),
    overfullBoxes: observed(
      0,
      "Selected build log contains no overfull boxes",
      [build.log],
    ),
    missingGlyphs: observed(
      0,
      "Selected build log contains no missing-character diagnostics",
      [build.log],
    ),
  },
  columns,
};
await writeFile(
  join(workspace, "measurements.json"),
  JSON.stringify(measurement),
);
const fit = command("fit", [
  "--manifest",
  manifestPath,
  "--measurements",
  join(workspace, "measurements.json"),
]);
const packaged = command("package-review", [
  "--manifest",
  manifestPath,
  "--destination",
  join(workspace, "review"),
]);
const packagedPdfHash = hash(
  await readFile(join(workspace, "review", "Synthetic Midterm Aid.pdf")),
);
let repeatPackageRefused = false;
try {
  command("package-review", [
    "--manifest",
    manifestPath,
    "--destination",
    join(workspace, "review"),
  ]);
} catch {
  repeatPackageRefused = true;
}
if (
  !repeatPackageRefused ||
  hash(
    await readFile(join(workspace, "review", "Synthetic Midterm Aid.pdf")),
  ) !== packagedPdfHash
)
  throw new Error("Repeated packaging did not preserve published bytes.");
command("package-review", [
  "--manifest",
  manifestPath,
  "--destination",
  join(workspace, "review-retry"),
]);
let staleRefused = false;
await writeFile(
  join(root, "NTULearn/synthetic-notice.md"),
  `${source}\nChanged source`,
);
try {
  command("audit", ["--manifest", manifestPath]);
} catch {
  staleRefused = true;
}
if (!staleRefused) throw new Error("Stale source was accepted.");
await writeFile(join(root, "NTULearn/synthetic-notice.md"), source);
const recovered = command("audit", ["--manifest", manifestPath]);
if (recovered.texSha256 !== audit.texSha256)
  throw new Error("Recovery changed authoring identity.");
execFileSync(
  "pdftoppm",
  [
    "-scale-to",
    "1400",
    "-png",
    "-singlefile",
    join(root, personal, "Synthetic Midterm Aid.pdf"),
    join(workspace, "preview"),
  ],
  { stdio: "pipe" },
);
console.log(
  JSON.stringify(
    {
      status: "passed",
      runtime: { path: runtime, sha256: hash(await readFile(runtime)) },
      root,
      workspace,
      seeded: {
        contractVersion: contract.version,
        operations: seedPlan.operations.length,
      },
      prepare,
      proposedSelection: {
        source: "NTULearn/synthetic-notice.md",
        locators: ["Q1", "Q2", "Q3"],
        authority: "synthetic issued-current",
        constraints: {
          paper: "A4",
          maximumPages: 1,
          bodyPtFloor: 10,
          columns: 2,
          color: "monochrome",
        },
        evidence: "synthetic notice text",
      },
      fitInput: {
        provenance:
          "Build metrics and per-column XML text-box geometry are measured; continuation is an explicit fixture observation, independent visual/semantic review remains separate",
        measurement,
      },
      semanticExpectations: {
        requiredQuestions: [
          "Q1 difference quotient with h nonzero",
          "Q2 differentiable composition and evaluation at inner output",
          "Q3 one-sided limits at zero",
        ],
        review:
          "Independent mathematical and rendered-page review required for this exact PDF hash; this script is deterministic workflow verification, not a model evaluation.",
      },
      fit,
      preservation,
      regeneration,
      references,
      verify,
      packageFiles: packaged.files,
      review: "unreviewed",
      repeat: "identical",
      staleSource: "refused",
      repeatedPackage:
        "refused; existing bytes preserved; fresh destination recovered",
      recovery: "same release hashes",
      interruptedAuthoring: {
        injection: "bounded stop before PDF/manifest",
        refusedIncompleteRelease: interruptedReleaseRefused,
        resumedDraftSha256: interruptedDraftSha256,
        retainedExactDraft: true,
      },
      preview: join(workspace, "preview.png"),
    },
    null,
    2,
  ),
);
