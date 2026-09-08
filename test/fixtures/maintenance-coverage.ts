import {
  MAINTENANCE_DOMAINS,
  type MaintenanceCoverage,
} from "../../src/routine/index.js";

export function syntheticMaintenanceCoverage(): MaintenanceCoverage {
  return MAINTENANCE_DOMAINS.map(({ id, label }) => ({
    domain: id,
    status: "checked",
    evidence: [`Checked ${label.toLowerCase()}.`],
  }));
}
