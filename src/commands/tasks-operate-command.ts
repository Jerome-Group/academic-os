import type { TaskOperationName } from "../tasks/types.js";

const retiredOperations = new Set(["create", "change", "complete", "cancel"]);

export function isTaskOperation(
  value: string | undefined,
): value is TaskOperationName {
  return value !== undefined && retiredOperations.has(value);
}

export async function runTasksOperateCommand(
  name: TaskOperationName,
  _arguments: string[],
  json: boolean,
): Promise<void> {
  const report = {
    schemaVersion: 1,
    command: `tasks ${name}`,
    outcome: "conflict",
    code: "exact-plan-required",
    message:
      "Read tasks refresh, then submit a versioned immutable plan with tasks apply-plan --config <path> --plan <path>.",
  };
  process.stdout.write(
    json ? `${JSON.stringify(report, null, 2)}\n` : `${report.message}\n`,
  );
  process.exitCode = 2;
}
