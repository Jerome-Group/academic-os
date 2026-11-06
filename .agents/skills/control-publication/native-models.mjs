import assert from "node:assert/strict";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const nativeModelCases = [
  {
    name: "mixed-admission",
    module: "MixedAdmission",
    broken: "none",
    invariants:
      "OnePermanentOwner RequestOwnerUnique ValidateCompleteHistoryBeforeEffects CompletedLookupPrecedesPending FreshInfeasibleHasNoStarter RuntimeVerifiedBeforeAccount CompletedReadonly FrozenCallerExpectationBeforeStarter",
  },
  {
    name: "mixed-broken-namespace",
    module: "MixedAdmission",
    broken: "namespace",
    invariants: "RequestOwnerUnique",
    failure: "RequestOwnerUnique",
  },
  {
    name: "mixed-broken-history",
    module: "MixedAdmission",
    broken: "history",
    invariants: "ValidateCompleteHistoryBeforeEffects",
    failure: "ValidateCompleteHistoryBeforeEffects",
  },
  {
    name: "mixed-broken-pending",
    module: "MixedAdmission",
    broken: "pending",
    invariants: "CompletedLookupPrecedesPending",
    failure: "CompletedLookupPrecedesPending",
  },
  {
    name: "mixed-broken-suffix",
    module: "MixedAdmission",
    broken: "suffix",
    invariants: "FreshInfeasibleHasNoStarter",
    failure: "FreshInfeasibleHasNoStarter",
  },
  ...["registration", "policy"].map((kind) => ({
    name: `native-selector-${kind}`,
    module: "NativeSelectorMove",
    kind,
    broken: "none",
    invariants:
      "FrozenExpectedOld IntentBeforeSwap RecordedLocationReachable ArchiveBeforeMoveObserved SuccessRequiresSettledReceiptGraph RetainedAttemptsStay ReadonlyRequiresOwnedPendingPath",
    properties: "ReadonlyDoesNotMutate",
  })),
  {
    name: "mixed-broken-expected",
    module: "MixedAdmission",
    broken: "expected",
    invariants: "FrozenCallerExpectationBeforeStarter",
    failure: "FrozenCallerExpectationBeforeStarter",
  },
  {
    name: "native-broken-intent",
    module: "NativeSelectorMove",
    kind: "policy",
    broken: "intent",
    invariants: "IntentBeforeSwap",
    failure: "IntentBeforeSwap",
  },
  {
    name: "native-broken-location",
    module: "NativeSelectorMove",
    kind: "policy",
    broken: "location",
    invariants: "RecordedLocationReachable",
    failure: "RecordedLocationReachable",
  },
  {
    name: "native-broken-receipt",
    module: "NativeSelectorMove",
    kind: "policy",
    broken: "receipt",
    invariants: "SuccessRequiresSettledReceiptGraph",
    failure: "SuccessRequiresSettledReceiptGraph",
  },
];
export async function nativeModels({
  directory,
  evidence,
  java,
  tool,
  environment,
  command,
}) {
  const results = [];
  for (const spec of nativeModelCases) {
    const model = join(evidence, spec.name);
    await mkdir(model, { mode: 0o700 });
    await copyFile(
      join(directory, `${spec.module}.tla`),
      join(model, `${spec.module}.tla`),
    );
    await writeFile(
      join(model, "model.cfg"),
      `SPECIFICATION Spec\nCONSTANTS Broken = "${spec.broken}"\n${spec.kind ? `SelectorKind = "${spec.kind}"\n` : ""}INVARIANTS ${spec.invariants}\n${spec.properties ? `PROPERTY ${spec.properties}\n` : ""}CHECK_DEADLOCK FALSE\n`,
    );
    const run = command(
      java,
      [
        "-XX:+UseParallelGC",
        `-Djava.io.tmpdir=${process.env.TMPDIR}`,
        "-cp",
        tool.jar,
        "tlc2.TLC",
        "-workers",
        "1",
        "-config",
        "model.cfg",
        "-metadir",
        join(model, "states"),
        `${spec.module}.tla`,
      ],
      model,
      spec.name,
      environment,
    );
    await run.persist();
    if (spec.failure) {
      assert.notEqual(run.status, 0);
      assert.match(
        run.output,
        new RegExp(`Invariant ${spec.failure} is violated`),
        run.output,
      );
    } else {
      assert.equal(run.status, 0, run.output);
      assert.match(
        run.output,
        /Model checking completed\. No error has been found/,
        run.output,
      );
    }
    results.push({
      ...spec,
      outcome: spec.failure ? "required-counterexample" : "passed",
      evidence: model,
      stdout: run.stdout,
      shortestTrace: run.output.match(/State \d+: <[^>]+>/g) ?? [],
      counts: run.output.match(
        /\d+ states generated, \d+ distinct states found[^\n]*/,
      )?.[0],
    });
    await writeFile(
      join(evidence, "native-models-progress.json"),
      JSON.stringify(results, null, 2),
    );
  }
  return results;
}
