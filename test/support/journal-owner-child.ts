import { once } from "node:events";
import { withJournalMutationOwner } from "../../src/journal-mutation-owner.js";
import {
  createFileRepairJournalStore,
  createRepairPlan,
} from "../../src/repair/index.js";
import { repairPlanDraft } from "../repair/fixtures.js";

const [stateRoot = "", journalPath = "", mode = "hold"] = process.argv.slice(2);
const result =
  mode === "drain"
    ? await createFileRepairJournalStore(stateRoot).mutate(
        "11111111-1111-4111-8111-111111111111",
        async (journal) => {
          const plan = createRepairPlan(repairPlanDraft());
          void journal.append({
            schemaVersion: 1,
            sequence: 0,
            recordedAt: "2026-10-24T00:00:00Z",
            changeSetId: plan.changeSetId,
            planDigest: plan.planDigest,
            type: "started",
            plan,
          });
          setImmediate(() => {
            void journal.read().then(
              () => process.send?.({ kind: "unexpected-live-session" }),
              () => process.send?.({ kind: "expired-session" }),
            );
          });
          process.send?.({ kind: "callback-settled" });
        },
      )
    : await withJournalMutationOwner({ stateRoot, journalPath }, async () => {
        process.send?.({ kind: "held" });
        if (mode === "hold") await once(process, "message");
        return "finished";
      });
process.stdout.write(`${JSON.stringify(result)}\n`);
process.disconnect?.();
