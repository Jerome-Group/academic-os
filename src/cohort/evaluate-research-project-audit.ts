import {
  planResearchProjectConformance,
  type ResearchProjectContract,
  type ResearchProjectControls,
  type ResearchProjectInventory,
} from "../conformance/index.js";
import {
  recordResearchProjectAuditObservation,
  type ResolvedConfiguredResearchProjectRoots,
} from "../mounted/index.js";
import { OperationalError } from "../operational-error.js";
import {
  createResearchProjectAuditReport,
  type ResearchProjectAuditReport,
} from "../report/index.js";

export async function evaluateResearchProjectAudit(input: {
  contract: ResearchProjectContract;
  target: ResolvedConfiguredResearchProjectRoots;
  inventory: ResearchProjectInventory;
  controls: ResearchProjectControls;
  observedAt?: string;
}): Promise<ResearchProjectAuditReport> {
  const inventoryProvenance = input.inventory.provenance;
  if (inventoryProvenance === undefined) {
    throw new OperationalError(
      "unsafe-inventory",
      "Research-project inventory has no provenance.",
    );
  }
  const result = planResearchProjectConformance({
    contract: input.contract,
    target: input.target.project,
    inventory: input.inventory,
    controls: input.controls,
  });
  const recorded = await recordResearchProjectAuditObservation({
    target: input.target,
    inventory: input.inventory,
    result,
    observedAt: input.observedAt ?? new Date().toISOString(),
    contractVersion: result.contractVersion,
  });
  return createResearchProjectAuditReport({
    project: input.target.project,
    result,
    recorded,
    inventoryProvenance,
  });
}
