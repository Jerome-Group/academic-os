import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";

const root = "seed-templates/70 Learning/templates";

it("ships the separate portable mathematics-cheatsheet interface", async () => {
  const [type, preamble, logo, example] = await Promise.all([
    readFile(`${root}/mathematics-cheatsheet.template.tex`, "utf8"),
    readFile(`${root}/mathematics-cheatsheet-preamble.template.tex`, "utf8"),
    readFile(`${root}/chatgpt-logo.template.tex`, "utf8"),
    readFile("docs/examples/README.md", "utf8"),
  ]);

  assert.equal(
    type.includes("\\IfFileExists{mathematics-cheatsheet-preamble.tex}"),
    true,
  );
  assert.match(preamble, /\\usepackage\[a4paper,[^\]]+\]\{geometry\}/u);
  const bodySize = preamble.match(/\\fontsize\{([0-9.]+)\}\{([0-9.]+)\}/u);
  assert.notEqual(bodySize, null);
  assert.equal(Number(bodySize?.[1]) >= 3.835, true);
  assert.equal(Number(bodySize?.[2]) > 0, true);
  assert.match(
    preamble,
    new RegExp(
      String.raw`\\DeclareMathSizes\{${bodySize?.[1]}\}\{${bodySize?.[1]}\}\{[0-9.]+\}\{[0-9.]+\}`,
      "u",
    ),
  );
  assert.equal(preamble.includes("\\input{\\ChatGPTLogoAsset}"), true);
  assert.doesNotMatch(
    [type, preamble].join("\n"),
    /\\(?:resizebox|scalebox)\b/u,
  );
  assert.equal(logo.includes("OpenAI-black-monoblossom.svg"), true);
  assert.equal(example.includes("mathematics-cheatsheet.pdf"), true);
  assert.equal(example.includes("mathematics-cheatsheet.template.tex"), true);
  assert.doesNotMatch([type, preamble, logo, example].join("\n"), /\/Users\//u);
});
