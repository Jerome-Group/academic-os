import type { ModulePassReport } from "../routine/index.js";

// The one-line form of a pass, for the operator watching a run rather than reading the report the
// run wrote. Every bucket the report carries is counted here, so a morning that withdrew something
// says so at the terminal too.
export function renderModulePassSummary(module: ModulePassReport): string {
  const counts: Array<[string, number]> = [
    ["curated", module.curated.length],
    ["rederived", module.rederived.length],
    ["superseded", module.superseded.length],
    ["withdrawn", module.withdrawn.length],
    ["parked", module.parked.length],
    ["doc writes", module.docWrites.length],
    ["failures", module.failures.length],
  ];
  return `${module.module} (${module.semester}): ${counts
    .map(([name, count]) => `${count} ${name}`)
    .join(", ")}`;
}
