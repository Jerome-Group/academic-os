import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { it } from "node:test";

const latexAvailable = spawnSync("latexmk", ["-norc", "-version"]).status === 0;
const compiler = resolve("scripts/compile-seed-templates.mjs");
const journey = resolve("scripts/synthetic-cheatsheet-journey.mjs");

async function writeTemplates(root: string, body: string): Promise<void> {
  for (const directory of [
    "seed-templates/70 Learning/templates",
    "seed-templates/research-project/60 Templates",
  ]) {
    await mkdir(join(root, directory), { recursive: true });
    await writeFile(join(root, directory, "example.template.tex"), body);
  }
}

it("compiles seed templates without executing host startup files", {
  skip: !latexAvailable,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "seed-template-startup-"));
  try {
    const home = join(root, "home");
    const temporary = join(root, "temporary");
    await Promise.all([mkdir(home), mkdir(temporary)]);
    await writeFile(
      join(home, ".latexmkrc"),
      'open(my $out, ">", "$ENV{HOME}/startup-executed") or die $!; close($out); die "quality-startup-sentinel\\n";\n',
    );
    await writeTemplates(
      root,
      String.raw`\documentclass{article}\begin{document}Synthetic template.\end{document}`,
    );
    const result = spawnSync(process.execPath, [compiler], {
      cwd: root,
      env: { ...process.env, HOME: home, TMPDIR: temporary },
      encoding: "utf8",
    });
    assert.equal(existsSync(join(home, "startup-executed")), false);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /All LaTeX seed templates compiled/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("reports latexmk stderr when a seed template fails compilation", {
  skip: !latexAvailable,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "seed-template-diagnostic-"));
  try {
    const home = join(root, "home");
    const temporary = join(root, "temporary");
    await Promise.all([mkdir(home), mkdir(temporary)]);
    await writeTemplates(
      root,
      String.raw`\documentclass{article}\begin{document}Synthetic template.\end{document}`,
    );
    for (const directory of [
      "seed-templates/70 Learning/templates",
      "seed-templates/research-project/60 Templates",
    ]) {
      await rename(
        join(root, directory, "example.template.tex"),
        join(root, directory, "&example.template.tex"),
      );
    }
    const result = spawnSync(process.execPath, [compiler], {
      cwd: root,
      env: { ...process.env, HOME: home, TMPDIR: temporary },
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(
      result.stdout + result.stderr,
      /Latexmk: Filename '&example\.tex' contains initial '&'/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("runs the synthetic cheatsheet journey without executing host startup files", {
  skip: !latexAvailable,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "synthetic-journey-startup-"));
  try {
    const home = join(root, "home");
    const temporary = join(root, "temporary");
    await Promise.all([mkdir(home), mkdir(temporary)]);
    await writeFile(
      join(home, ".latexmkrc"),
      'open(my $out, ">", "$ENV{HOME}/startup-executed") or die $!; close($out); die "quality-startup-sentinel\\n";\n',
    );
    const result = spawnSync(process.execPath, [journey], {
      env: { ...process.env, HOME: home, TMPDIR: temporary },
      encoding: "utf8",
    });
    assert.equal(existsSync(join(home, "startup-executed")), false);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).status, "passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
