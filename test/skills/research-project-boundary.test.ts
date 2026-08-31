import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";

const skillPath = "skills/research-project/SKILL.md";
const manifestPath = "skills/research-project/agents/openai.yaml";
const finderPath = "skills/research-project/scripts/find-candidates.zsh";
const execFileAsync = promisify(execFile);

async function readSkillText(): Promise<string> {
  const parts = await Promise.all([
    readFile(skillPath, "utf8"),
    readFile(manifestPath, "utf8"),
  ]);
  return parts.join("\n");
}

describe("the research-project skill", () => {
  it("fires only when the Owner invokes it", async () => {
    const [skill, manifest] = await Promise.all([
      readFile(skillPath, "utf8"),
      readFile(manifestPath, "utf8"),
    ]);

    assert.match(skill, /^disable-model-invocation: true$/mu);
    assert.match(manifest, /^ {2}allow_implicit_invocation: false$/mu);
  });

  it("discovers both supported Drive mount families without system configuration", async () => {
    const text = await readSkillText();

    assert.match(text, /Library\/CloudStorage\/GoogleDrive-/u);
    assert.match(text, /\/Volumes\/\*/u);
    assert.match(text, /Modules\/Research/u);
    assert.doesNotMatch(text, /academic-os\.config\.json/u);
  });

  it("executes against a missing mount family and deduplicates resolved aliases", {
    skip: process.platform !== "darwin",
  }, async () => {
    const fixture = await mkdtemp(join(tmpdir(), "research-project-skill-"));
    const cloudRoot = join(fixture, "cloud");
    const volumesRoot = join(fixture, "volumes");
    const project = join(
      cloudRoot,
      "GoogleDrive-owner",
      "My Drive",
      "Modules",
      "Research",
      "Project One",
    );
    const definition = join(
      project,
      "00 Project Admin",
      "10 Project Definition.yaml",
    );
    const volumeResearch = join(
      volumesRoot,
      "Disk",
      "My Drive",
      "Modules",
      "Research",
    );

    try {
      await mkdir(join(project, "00 Project Admin"), { recursive: true });
      await writeFile(definition, "project:\n  key: project-one\n", "utf8");
      await mkdir(volumeResearch, { recursive: true });
      await symlink(project, join(volumeResearch, "Project One"));

      const both = await execFileAsync(finderPath, [cloudRoot, volumesRoot]);
      assert.deepEqual(both.stdout.trim().split("\n"), [
        await realpath(project),
      ]);

      const volumeOnly = await execFileAsync(finderPath, [
        join(fixture, "missing-cloud-root"),
        volumesRoot,
      ]);
      assert.deepEqual(volumeOnly.stdout.trim().split("\n"), [
        await realpath(project),
      ]);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("selects by public project identity and resolves mount aliases", async () => {
    const text = await readSkillText();

    for (const identity of ["folder", "key", "title"]) {
      assert.match(text, new RegExp(`\\b${identity}\\b`, "u"));
    }
    assert.match(text, /resolved/u);
    assert.match(text, /genuinely different/u);
    assert.match(text, /before the first standalone `--`/u);
    assert.match(text, /cannot be read or parsed/u);
  });

  it("loads project controls and hands every area to the live router", async () => {
    const text = await readFile(skillPath, "utf8");

    for (const control of [
      "AGENTS.md",
      "00 Project Admin/00 Project Profile.md",
      "00 Project Admin/10 Project Definition.yaml",
    ]) {
      assert.match(
        text,
        new RegExp(control.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
      );
    }

    for (const route of [
      "Sources",
      "Meetings",
      "Research",
      "Learning",
      "Deliverables",
      "Tasks",
      "Maintenance",
    ]) {
      assert.match(text, new RegExp(`\\b${route}\\b`, "u"));
    }
    assert.match(text, /Read every document that route names/u);
  });

  it("contains neither project-specific identity nor copied research conduct", async () => {
    const text = await readSkillText();

    assert.doesNotMatch(
      text,
      /^(?:project|profile):|^ {2}(?:key|folder|title):/mu,
    );
    assert.doesNotMatch(text, /latexmk|-auxdir|-outdir/u);
    assert.doesNotMatch(
      text,
      /candidate agent-written mathematics|Claim becomes `checked`/u,
    );
  });
});
