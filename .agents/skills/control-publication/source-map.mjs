import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function verifySourceMap({ root, mapping }) {
  let references = 0;
  async function visit(value) {
    if (value === null || typeof value !== "object") return;
    if (
      typeof value.path === "string" &&
      typeof value.symbol === "string" &&
      "sha256" in value
    ) {
      const bytes = await readFile(join(root, value.path));
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        value.sha256,
        `${value.path}: refresh the source hash in code-model-map.json`,
      );
      const actual = bytes
        .toString("utf8")
        .split(/\r?\n/u)
        .flatMap((line, index) =>
          line.includes(value.symbol) ? [index + 1] : [],
        );
      assert.ok(
        actual.length,
        `${value.path}: mapped symbol is absent: ${value.symbol}`,
      );
      assert.deepEqual(
        actual,
        value.symbolOccurrences,
        `${value.path}: refresh symbolOccurrences for ${JSON.stringify(value.symbol)} in code-model-map.json; source hashes do not validate navigation`,
      );
      references++;
    }
    for (const child of Object.values(value)) await visit(child);
  }
  await visit(mapping);
  return {
    references,
    evidence: "source hashes and navigation only; not semantic correspondence",
  };
}
