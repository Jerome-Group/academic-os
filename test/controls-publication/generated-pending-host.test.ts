import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import { isRecord } from "../../src/conformance/value-shape.js";
import { digest } from "../../src/controls-publication/codec.js";
import { publicationFixture } from "./fixtures.js";
import { fixture } from "./native-policy-fixture.js";

for (const kind of ["candidate-reserved", "publication-plan"] as const) {
  for (const requestId of ["generated-predecessor", "a".repeat(64)]) {
    it(`reports truthful host recovery for ${kind} with ${requestId.length === 64 ? "digest-shaped" : "ordinary"} request identity`, {
      skip: process.platform !== "darwin",
      timeout: 180000,
    }, async (context) => {
      const f = await fixture("generated-pending-host");
      context.diagnostic(`Retained generated pending fixture ${f.root}`);
      const input = await f.request("blocked-policy");
      let pendingArgs = [
        join(f.host, "publication.mjs"),
        "create-generated-candidate",
        "--request",
        requestId,
        "--identity",
        f.identityPath,
      ];
      if (kind === "publication-plan") {
        const created = f.command([
          ...pendingArgs.slice(0, 3),
          "completed-candidate",
          ...pendingArgs.slice(4),
        ]);
        assert.equal(created.status, 0, created.stdout + created.stderr);
        const value: unknown = JSON.parse(created.stdout);
        assert.ok(
          isRecord(value) &&
            isRecord(value.candidate) &&
            typeof value.candidate.candidateId === "string",
        );
        const bundle = join(f.root, "inputs/bundle.json");
        await writeFile(bundle, publicationFixture().bundleBytes);
        pendingArgs = [
          join(f.host, "publication.mjs"),
          "publish-generation",
          "--candidate",
          value.candidate.candidateId,
          "--request",
          requestId,
          "--bundle",
          bundle,
          "--expect-absent",
        ];
      }
      await writeFile(
        f.checkpoint,
        JSON.stringify({ edge: "before-file-sync", kind, action: "kill" }),
      );
      const interrupted = f.command(pendingArgs);
      assert.equal(
        interrupted.signal,
        "SIGKILL",
        interrupted.stdout + interrupted.stderr,
      );
      const marker: unknown = JSON.parse(
        await readFile(join(f.root, "fault-hit.json"), "utf8"),
      );
      assert.ok(isRecord(marker));
      assert.equal(marker.kind, kind);
      await unlink(f.checkpoint);
      const before = await readFile(f.ledger);
      const pending = (await f.records()).find(
        (record) =>
          record.kind === kind && record.binding.requestId === requestId,
      );
      assert.ok(pending);
      const retainedPlanDigest =
        kind === "publication-plan" ? digest(pending) : null;
      const registration = {
        ...f.registrationInput,
        requestId: "blocked-registration",
        expectedPriorRegistration: input.deploymentRegistrationDigest,
      };
      const historical = await f.run("register", f.registrationInput);
      assert.equal(historical.status, 0, JSON.stringify(historical.value));
      assert.deepEqual(await readFile(f.ledger), before);
      for (const [action, request] of [
        ["register", registration],
        ["install-native-source-policy", input],
      ] as const) {
        const blocked = await f.run(action, request);
        assert.equal(blocked.status, 2);
        assert.equal(blocked.value.kind, "recovery-required");
        assert.equal(blocked.value.code, "uncertain-publication");
        assert.equal(blocked.value.requestId, requestId);
        assert.equal(blocked.value.retainedPlanDigest, retainedPlanDigest);
        assert.deepEqual(await readFile(f.ledger), before);
      }
      const recovered = f.command(pendingArgs);
      assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
      const installed = await f.run("install-native-source-policy", input);
      assert.equal(installed.status, 0, JSON.stringify(installed.value));
      const registered = await f.run("register", registration);
      assert.equal(registered.status, 0, JSON.stringify(registered.value));
    });
  }
}
