import { spawnSync } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import {
  contractRuleEnforcement,
  contractRuleImplementation,
} from "../dist/src/conformance/rule-enforcement.js";

const rulePattern = /MF-[A-Z]+-[0-9]{3}/gu;
const normativeRules = uniqueMatches(
  await readFile("docs/module-folder-contract.md", "utf8"),
);
const registeredRules = uniqueMatches(runTests(await testFiles("dist/test")));

assertSameRules(
  "enforcement registry",
  Object.keys(contractRuleEnforcement).sort(),
  normativeRules,
);
assertSameRules(
  "implementation registry",
  Object.keys(contractRuleImplementation).sort(),
  normativeRules,
);
assertSameRules("passing registered tests", registeredRules, normativeRules);
await Promise.all(
  Object.values(contractRuleImplementation)
    .flat()
    .map((path) => access(path)),
);

console.log(
  `${normativeRules.length} normative rules have implementation mappings and passing registered tests.`,
);

function runTests(files) {
  const result = spawnSync(
    process.execPath,
    ["--test", "--test-reporter=tap", ...files],
    {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

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

function uniqueMatches(source) {
  return [...new Set(source.match(rulePattern) ?? [])].sort();
}

function assertSameRules(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return;
  const missing = expected.filter((rule) => !actual.includes(rule));
  const orphaned = actual.filter((rule) => !expected.includes(rule));
  throw new Error(
    `${label} differs from the contract; missing: ${missing.join(", ") || "none"}; orphaned: ${orphaned.join(", ") || "none"}.`,
  );
}
