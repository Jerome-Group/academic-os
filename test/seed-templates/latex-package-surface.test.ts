import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";

// #78 pinned this surface when the Owner chose the style, and #93 made it documentation an agent
// never verifies package by package. Nothing checks it in a module folder, by that decision — but
// the seeded originals are this repository's own artefact, and a template reaching outside the set
// compiles here while failing on a machine whose TeX Live is only what the surface promised.
const pinnedPackages = new Set([
  "amsmath",
  "amssymb",
  "amsthm",
  "enumitem",
  "etoolbox",
  "fontenc",
  "geometry",
  "lmodern",
  "mathtools",
  "microtype",
  "tcolorbox",
  "titlesec",
  "xcolor",
]);

const templatesDirectory = "seed-templates/70 Learning/templates";

async function readTemplates(): Promise<{ name: string; body: string }[]> {
  const names = (await readdir(templatesDirectory))
    .filter((name) => name.endsWith(".template.tex"))
    .sort();
  return Promise.all(
    names.map(async (name) => ({
      name,
      body: await readFile(join(templatesDirectory, name), "utf8"),
    })),
  );
}

function packagesLoadedBy(body: string): string[] {
  return [
    ...body.matchAll(/^\\usepackage(?:\[[^\]]*\])?\{([^}]*)\}/gmu),
  ].flatMap((match) => (match[1] ?? "").split(",").map((name) => name.trim()));
}

describe("seeded LaTeX package surface", () => {
  it("loads nothing the chosen style did not pin", async () => {
    for (const { name, body } of await readTemplates()) {
      for (const packageName of packagesLoadedBy(body)) {
        assert.ok(
          pinnedPackages.has(packageName),
          `${name} loads '${packageName}', which is outside the pinned surface`,
        );
      }
    }
  });

  it("loads every package in the preamble and none in a type", async () => {
    const templates = await readTemplates();
    assert.ok(templates.length > 1, "expected a preamble and its types");

    for (const { name, body } of templates) {
      const loaded = packagesLoadedBy(body);
      if (name === "preamble.template.tex") {
        assert.deepEqual(new Set(loaded), pinnedPackages);
      } else {
        assert.deepEqual(
          loaded,
          [],
          `${name} loads a package; styling belongs in the preamble alone`,
        );
      }
    }
  });
});
