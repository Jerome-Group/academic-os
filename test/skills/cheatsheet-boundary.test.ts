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
import { promisify } from "node:util";
import { describe, it } from "node:test";

const run = promisify(execFile);
const skillPath = "skills/cheatsheet/SKILL.md";
const manifestPath = "skills/cheatsheet/agents/openai.yaml";
const finderPath = "skills/cheatsheet/scripts/find-candidates.zsh";
const toolPath = "skills/cheatsheet/scripts/cheatsheet-tool.mjs";
const examplePath = "skills/cheatsheet/references/manifest-example.yaml";

describe("the cheatsheet router skill", () => {
  it("is user-invoked and delegates conduct to the pinned procedure", async () => {
    const [skill, manifest] = await Promise.all([
      readFile(skillPath, "utf8"),
      readFile(manifestPath, "utf8"),
    ]);
    assert.match(skill, /disable-model-invocation: true/u);
    assert.match(manifest, /allow_implicit_invocation: false/u);
    assert.match(skill, /docs\/40 Cheatsheet Procedure\.md/u);
    assert.match(skill, /create.*revise.*audit.*verify.*package-review/su);
    assert.doesNotMatch(skill, /latexmk|coverage\.csv|body-size floor/u);
  });

  it("ships an executable helper runtime and its manifest shape", async () => {
    const [{ stdout }, example] = await Promise.all([
      run(toolPath, ["schema"]),
      readFile(examplePath, "utf8"),
    ]);
    const schema = JSON.parse(stdout);
    assert.ok(schema.runtime.requiredExecutables.includes("pdftohtml"));
    assert.deepEqual(schema.commands.verify, ["--module-root", "--manifest"]);
    assert.deepEqual(schema.commands["package-review"], [
      "--module-root",
      "--manifest",
      "--destination",
    ]);
    assert.match(example, /schema_version: 1/u);
    assert.match(example, /review: \{status: unreviewed\}/u);
  });

  it("finds a procedure-bearing module once across resolved mount aliases", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "cheatsheet-skill-"));
    try {
      const cloud = join(fixture, "cloud");
      const volumes = join(fixture, "volumes");
      const module = join(
        cloud,
        "GoogleDrive-test/My Drive/Modules/Y2S1/MH2500",
      );
      await mkdir(join(module, "docs"), { recursive: true });
      await writeFile(
        join(module, "docs/40 Cheatsheet Procedure.md"),
        "procedure",
      );
      await mkdir(join(volumes, "Disk/My Drive/Modules/Y2S1"), {
        recursive: true,
      });
      await symlink(module, join(volumes, "Disk/My Drive/Modules/Y2S1/MH2500"));
      const { stdout } = await run(finderPath, ["MH2500", cloud, volumes]);
      assert.deepEqual(stdout.trim().split("\n"), [await realpath(module)]);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
});
