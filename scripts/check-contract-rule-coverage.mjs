import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runPassingTests } from "./check-contract-tests.mjs";
import { researchContractRuleEnforcement } from "../dist/src/conformance/research-rule-enforcement.js";
import { contractRuleEnforcement } from "../dist/src/conformance/rule-enforcement.js";
import {
  assertCompleteRuleEvidence,
  readResearchRuleEvidence,
  readRuleEvidence,
} from "../dist/test/support/rule-evidence.js";

const normativeRules = uniqueMatches(
  await readFile("docs/module-folder-contract.md", "utf8"),
  /MF-[A-Z]+-[0-9]{3}/gu,
);
const normativeResearchRules = uniqueMatches(
  await readFile("docs/research-project-folder-contract.md", "utf8"),
  /RP-[A-Z]+(?:-[A-Z]+)*-[0-9]{3}/gu,
);

assertSameRules(
  "enforcement registry",
  Object.keys(contractRuleEnforcement).sort(),
  normativeRules,
);
const testOutput = await runPassingTests(await testFiles("dist/test"));
assertCompleteRuleEvidence(readRuleEvidence(testOutput), normativeRules);
assertSameRules(
  "research enforcement registry",
  Object.keys(researchContractRuleEnforcement).sort(),
  normativeResearchRules,
);
const deterministicResearchRules = Object.entries(
  researchContractRuleEnforcement,
)
  .filter(([, enforcement]) => enforcement === "deterministic")
  .map(([ruleId]) => ruleId)
  .sort();
assertCompleteRuleEvidence(
  readResearchRuleEvidence(testOutput),
  deterministicResearchRules,
);

console.log(
  `${normativeRules.length} normative rules have machine-recorded output from passing behavioural assertions.`,
);
console.log(
  `${deterministicResearchRules.length} deterministic research rules have machine-recorded output from passing behavioural assertions; judgment rules remain human-reviewed.`,
);

async function testFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await testFiles(path)));
    else if (path.endsWith(".test.js")) files.push(path);
  }
  return files.sort();
}

function uniqueMatches(source, pattern) {
  return [...new Set(source.match(pattern) ?? [])].sort();
}

function assertSameRules(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return;
  const missing = expected.filter((rule) => !actual.includes(rule));
  const orphaned = actual.filter((rule) => !expected.includes(rule));
  throw new Error(
    `${label} differs from the contract; missing: ${missing.join(", ") || "none"}; orphaned: ${orphaned.join(", ") || "none"}.`,
  );
}
