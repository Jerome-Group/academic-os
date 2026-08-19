import type { TaskRegisterCounts } from "../tasks/index.js";
import { quantity } from "./quantity.js";

export function renderTaskCounts(counts: TaskRegisterCounts): string {
  return [
    quantity(counts.tasks, "task"),
    `${counts.open} open, ${counts.completed} completed, ${counts.cancelled} cancelled, ${counts.unpushed} unpushed`,
  ].join("; ");
}
