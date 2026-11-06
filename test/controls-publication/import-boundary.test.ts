import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { it } from "node:test";
import { pathToFileURL } from "node:url";

it("rejects external runtime imports of publication internals and preserves exact adapter boundaries", () => {
  const owner = "../controls-publication/owner.js";
  for (const [importer, source, allowed] of [
    [
      "src/operations/boundary-probe.ts",
      `import {withPublicationOwner} from "${owner}"; void withPublicationOwner;`,
      false,
    ],
    [
      "src/operations/boundary-probe.ts",
      'await import("../controls-publication/native/index.js");',
      false,
    ],
    [
      "src/operations/boundary-probe.ts",
      'export {withPublicationOwner} from "../controls-publication/owner.js";',
      false,
    ],
    [
      "src/operations/boundary-probe.ts",
      'import "../CONTROLS-PUBLICATION/owner.js";',
      false,
    ],
    [
      "src/operations/boundary-probe.ts",
      'require("../controls-publication/store.js");',
      false,
    ],
    [
      "src/operations/boundary-probe.ts",
      'import "../controls-publication/../controls-publication/owner.js";',
      false,
    ],
    [
      "src/operations/boundary-probe.ts",
      `import ${JSON.stringify(pathToFileURL(resolve("src/controls-publication/owner.js")).href)};`,
      false,
    ],
    [
      "src/operations/boundary-probe.ts",
      'import "../controls-publication/index.js";',
      true,
    ],
    [
      "src/operations/boundary-probe.ts",
      `const text='import "${owner}"'; // import "${owner}"\nvoid text;`,
      true,
    ],
    ["src/cli.ts", 'import "./controls-publication/command.js";', true],
    [
      "src/operations/other.ts",
      'import "../controls-publication/command.js";',
      false,
    ],
    [
      "src/operations/run-operations-server.ts",
      'import "../controls-publication/tools.js";',
      true,
    ],
    [
      "src/capabilities/catalog.ts",
      'import "../controls-publication/tools.js";',
      true,
    ],
    ["src/controls-publication/owner.ts", 'import "./native/index.js";', true],
    [
      "test/controls-publication/fixture.ts",
      'import "../../src/controls-publication/native/index.js";',
      true,
    ],
    [
      "test/operations/fixture.ts",
      'import "../../src/controls-publication/native/index.js";',
      false,
    ],
    [
      "scripts/build-control-publication-release.mjs",
      'import "../dist/src/controls-publication/codec.js";',
      true,
    ],
    [
      "scripts/other.mjs",
      'import "../dist/src/controls-publication/codec.js";',
      false,
    ],
  ] as const) {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/check-control-publication-imports.mjs",
        "--stdin-file-path",
        importer,
      ],
      { input: source, encoding: "utf8", timeout: 10_000 },
    );
    assert.equal(
      result.status,
      allowed ? 0 : 1,
      `${importer}: ${result.stdout}${result.stderr}`,
    );
    if (!allowed)
      assert.match(result.stderr, /Use src\/controls-publication\/index\.ts/u);
  }
});
