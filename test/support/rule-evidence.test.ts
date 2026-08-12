import assert from "node:assert/strict";
import { it } from "node:test";

import {
  assertCompleteRuleEvidence,
  readRuleEvidence,
} from "./rule-evidence.js";

it("rejects behavioral evidence when one normative rule is omitted", () => {
  const observed = readRuleEvidence("academic-os-rule-evidence:MF-ROOT-001\n");

  assert.throws(
    () => assertCompleteRuleEvidence(observed, ["MF-ROOT-001", "MF-ROOT-002"]),
    /MF-ROOT-002/u,
  );
});
