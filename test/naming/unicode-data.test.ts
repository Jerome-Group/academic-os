import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import {
  assignedRanges,
  categoryRanges,
  fullCaseFold,
} from "../../src/naming/generated/unicode-16.js";

it("retains the complete generated Unicode16 collision and category data", () => {
  const bytes = JSON.stringify({
    assignedRanges,
    categoryRanges,
    fullCaseFold,
  });
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "1e862fa38d45bc046838097ae453b0e96bc5c58d0d09affd990d8305423ee90a",
  );
});
