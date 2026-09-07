#!/usr/bin/env node
// Compiles each seed-source LaTeX template in the form its target folder receives it. Needs
// `latexmk` on PATH, so it stays out of `npm run check` — CI has no TeX. A failed compilation
// keeps its workspace so the log can be read.
import { execFileSync } from "node:child_process";
import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const templateGroups = [
  {
    label: "module",
    source: "seed-templates/70 Learning/templates",
    exclude: new Set([
      "chatgpt-logo.tex",
      "mathematics-cheatsheet-preamble.tex",
      "preamble.tex",
    ]),
  },
  {
    label: "research-project",
    source: "seed-templates/research-project/60 Templates",
    exclude: new Set(["preamble.tex"]),
  },
];
const seededName = (name) => name.replace(".template.", ".");
const failures = [];
const retainedWorkspaces = [];

for (const group of templateGroups) {
  const workspace = await mkdtemp(
    join(tmpdir(), `seed-templates-${group.label}-`),
  );
  await cp(group.source, workspace, { recursive: true });
  for (const name of await readdir(workspace)) {
    await rename(join(workspace, name), join(workspace, seededName(name)));
  }
  if (group.label === "research-project") {
    for (const name of await readdir(workspace)) {
      const path = join(workspace, name);
      const body = await readFile(path, "utf8");
      await writeFile(
        path,
        body.replaceAll("{{PROJECT_NAME}}", "Example Project"),
        "utf8",
      );
    }
  }
  const documents = (await readdir(workspace))
    .filter((name) => name.endsWith(".tex") && !group.exclude.has(name))
    .sort();
  let groupFailed = false;
  for (const document of documents) {
    try {
      execFileSync("latexmk", ["-pdf", "-outdir=build", document], {
        cwd: workspace,
        stdio: "pipe",
      });
      console.log(`ok    ${group.label}/${document}`);
    } catch (error) {
      groupFailed = true;
      failures.push(`${group.label}/${document}`);
      console.log(
        `FAIL  ${group.label}/${document}\n${error.stdout ?? error.message}`,
      );
    }
  }
  if (groupFailed) {
    retainedWorkspaces.push(workspace);
  } else {
    await rm(workspace, { recursive: true });
  }
}

if (failures.length > 0) {
  console.error(
    `\n${failures.length} templates did not compile. Logs: ${retainedWorkspaces.join(", ")}`,
  );
  process.exitCode = 1;
} else {
  console.log(`\nAll LaTeX seed templates compiled.`);
}
