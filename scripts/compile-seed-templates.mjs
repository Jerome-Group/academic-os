#!/usr/bin/env node
// Compiles every seed-source LaTeX template in the form a module folder receives it, which is the
// only form that compiles: the templates reach their preamble as `preamble.tex`, and here it is
// still `preamble.template.tex`. Needs `latexmk` on PATH, so it is a local check rather than a CI
// one — CI has no TeX. Run it whenever a template or the preamble changes.
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readdir, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const templatesDirectory = "seed-templates/70 Learning/templates";
const seededName = (name) => name.replace(".template.", ".");

const workspace = await mkdtemp(join(tmpdir(), "seed-templates-"));
await cp(templatesDirectory, workspace, { recursive: true });
for (const name of await readdir(workspace)) {
  await rename(join(workspace, name), join(workspace, seededName(name)));
}

const documents = (await readdir(workspace))
  .filter((name) => name.endsWith(".tex") && name !== "preamble.tex")
  .sort();
const failures = [];
for (const document of documents) {
  try {
    execFileSync("latexmk", ["-pdf", "-outdir=build", document], {
      cwd: workspace,
      stdio: "pipe",
    });
    console.log(`ok    ${document}`);
  } catch (error) {
    failures.push(document);
    console.log(`FAIL  ${document}\n${error.stdout ?? error.message}`);
  }
}

console.log(`\n${workspace}`);
if (failures.length > 0) {
  console.error(`\n${failures.length} of ${documents.length} did not compile.`);
  process.exitCode = 1;
} else {
  console.log(`\nAll ${documents.length} compiled.`);
}
