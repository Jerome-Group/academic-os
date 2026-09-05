import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";

const packagesByPreamble = new Map([
  [
    "preamble.template.tex",
    new Set([
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
    ]),
  ],
  [
    "mathematics-cheatsheet-preamble.template.tex",
    new Set([
      "amsmath",
      "amssymb",
      "array",
      "booktabs",
      "enumitem",
      "eso-pic",
      "fontenc",
      "geometry",
      "hyperref",
      "keyval",
      "lmodern",
      "mathtools",
      "multicol",
      "needspace",
      "tikz",
      "ulem",
      "xcolor",
    ]),
  ],
]);
const pinnedPackages = new Set(
  [...packagesByPreamble.values()].flatMap((packages) => [...packages]),
);
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
  it("loads nothing outside either chosen style", async () => {
    for (const { name, body } of await readTemplates()) {
      for (const packageName of packagesLoadedBy(body)) {
        assert.ok(
          pinnedPackages.has(packageName),
          `${name} loads '${packageName}', which is outside both pinned surfaces`,
        );
      }
    }
  });

  it("loads each preamble's exact packages and none in a type or asset", async () => {
    const templates = await readTemplates();
    assert.ok(templates.length > 1, "expected preambles, types, and assets");

    for (const { name, body } of templates) {
      const loaded = packagesLoadedBy(body);
      const expected = packagesByPreamble.get(name);
      if (expected === undefined) {
        assert.deepEqual(
          loaded,
          [],
          `${name} loads a package; styling belongs in its preamble`,
        );
      } else {
        assert.deepEqual(new Set(loaded), expected);
      }
    }
  });
});
