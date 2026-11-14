import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { runCli } from "../support/run-cli.js";

it("selects a multi-unit review exercise without creating coverage; refuses invalid or unavailable sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "review-exercise-"));
  try {
    await mkdir(join(root, "00 Module Admin"));
    await mkdir(join(root, "30 Assessments", "40 Finals"), { recursive: true });
    const file = "30 Assessments/40 Finals/Review_Questions.pdf";
    const path = join(root, file);
    const mapPath = join(root, "00 Module Admin", "40 Source Map.yaml");
    const map = `units:
  Handout 1: {topics: [First], lectures: [], textbook: [], tutorials: []}
  Handout 2: {topics: [Second], lectures: [], textbook: [], tutorials: []}
exercise_sets:
  - block: Review Part I
    exercises: Questions 1-10
    units: [Handout 1, Handout 2]
    sources:
      - {file: ${file}, locator: Questions 1-10, role: questions}
`;
    await writeFile(mapPath, map);
    await writeFile(path, "synthetic issued bytes");
    const select = () =>
      runCli(
        "learning",
        "exercise",
        "--root",
        root,
        "--target",
        "Review Part I",
        "--json",
      );
    const result = await select();
    assert.equal(result.exitCode, 0, result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.pattern, "tutorial");
    assert.deepEqual(report.units, ["Handout 1", "Handout 2"]);
    assert.equal(report.unit, undefined);
    assert.deepEqual(report.writes, []);
    assert.equal(
      report.sources[0].sha256,
      createHash("sha256").update("synthetic issued bytes").digest("hex"),
    );
    assert.match(report.sources[0].sha256, /^[a-f0-9]{64}$/u);
    assert.equal(await readFile(mapPath, "utf8"), map);
    await assert.rejects(
      readFile(join(root, "70 Learning", "20 Tutorials", "records", "0001.md")),
    );
    await writeFile(
      mapPath,
      map.replace("[Handout 1, Handout 2]", "[Invented]"),
    );
    assert.equal((await select()).exitCode, 2);
    await writeFile(mapPath, map);
    await rm(path);
    assert.equal((await select()).exitCode, 2);
    await symlink(mapPath, path);
    assert.equal((await select()).exitCode, 2);
    await rm(path);
    await writeFile(path, "");
    assert.equal((await select()).exitCode, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
