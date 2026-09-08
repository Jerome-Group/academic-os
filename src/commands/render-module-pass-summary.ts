import type { ModulePassReport } from "../routine/index.js";
import { MAINTENANCE_STATUSES } from "../routine/index.js";

// The one-line form of a pass, for the operator watching a run rather than reading the report the
// run wrote. Every bucket the report carries is counted here, so a morning that withdrew something
// says so at the terminal too.
export function renderModulePassSummary(module: ModulePassReport): string {
  const statusCounts = MAINTENANCE_STATUSES.map(
    (status) =>
      [
        status,
        module.maintenance.filter((entry) => entry.status === status).length,
      ] as const,
  ).filter(([, count]) => count > 0);
  const counts: Array<[string, number]> = [
    ["curated", module.curated.length],
    ["rederived", module.rederived.length],
    ["superseded", module.superseded.length],
    ["withdrawn", module.withdrawn.length],
    ["parked", module.parked.length],
    ["doc writes", module.docWrites.length],
    ["failures", module.failures.length],
    ["noted", module.noted.length],
  ];
  const maintenance = `${module.maintenance.length} maintenance${
    statusCounts.length === 0
      ? ""
      : ` (${statusCounts.map(([status, count]) => `${count} ${status}`).join(", ")})`
  }`;
  return `${module.module} (${module.semester}): ${maintenance}, ${counts
    .map(([name, count]) => `${count} ${name}`)
    .join(", ")}`;
}
