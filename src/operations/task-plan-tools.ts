import { OperationalError } from "../operational-error.js";
import { parseTaskExecutionPlan } from "../tasks/task-execution-plan.js";
import type { TaskExecutionReport } from "../tasks/task-execution-types.js";
import type { OperationTool } from "./types.js";

export interface TaskPlanExecutor {
  apply(plan: unknown): Promise<TaskExecutionReport>;
}

const legacyMutations = new Set([
  "tasks_create",
  "tasks_change",
  "tasks_complete",
  "research_tasks_create",
  "research_tasks_change",
  "research_tasks_complete",
]);

export function guardedTaskTools(
  tools: OperationTool[],
  executor: TaskPlanExecutor,
): OperationTool[] {
  return [
    ...tools.map((tool): OperationTool => {
      if (legacyMutations.has(tool.name))
        return {
          ...tool,
          description:
            tool.description +
            " Exact-plan protocol v1: read the register to obtain execution.expectedSnapshot and target, then supply plan_json. Missing plans return migration guidance without a provider write.",
          fields: [
            ...tool.fields,
            {
              name: "plan_json",
              description:
                "Immutable TaskExecutionPlan v1 JSON from a fresh register observation.",
            },
          ],
          call: async (values) => {
            if (!values.has("plan_json"))
              return {
                failed: true,
                report: {
                  schemaVersion: 1,
                  outcome: "conflict",
                  code: "exact-plan-required",
                  migration: {
                    protocol: "task-plan/1",
                    readTool: tool.name.startsWith("research_")
                      ? "research_tasks_read_register"
                      : "tasks_read_register",
                    writeTool: tool.name,
                    argument: "plan_json",
                  },
                },
              };
            const plan = parseTaskExecutionPlan(
              parseJson(values.get("plan_json")),
            );
            const operation = tool.name.split("_").at(-1);
            const key = tool.name.startsWith("research_")
              ? values.get("research_project")
              : `${values.get("semester")}/${values.get("module")}`;
            if (
              plan.operation.name !== operation ||
              plan.target.key !== key ||
              plan.target.kind !==
                (tool.name.startsWith("research_")
                  ? "research-project"
                  : "module") ||
              values.has("notes") ||
              [
                "assessment",
                "source",
                "milestone",
                "claim",
                "meeting",
                "deliverable",
              ].some(
                (field) =>
                  values.has(field) &&
                  (plan.operation.name !== "create" ||
                    Reflect.get(plan.operation.provenance ?? {}, field) !==
                      values.get(field)),
              ) ||
              (values.has("task_id") &&
                (plan.operation.name === "create" ||
                  plan.operation.taskId !== values.get("task_id"))) ||
              (values.has("title") &&
                (!(
                  plan.operation.name === "create" ||
                  plan.operation.name === "change"
                ) ||
                  plan.operation.title !== values.get("title"))) ||
              (values.has("do_date") &&
                (!(
                  plan.operation.name === "create" ||
                  plan.operation.name === "change"
                ) ||
                  plan.operation.doDate !== values.get("do_date")))
            )
              throw new OperationalError(
                "invalid-arguments",
                "The compatibility call must match its exact plan; descriptions are unsupported.",
              );
            const report = await executor.apply(plan);
            return { report, failed: report.outcome !== "applied" };
          },
        };
      if (tool.name.endsWith("read_register"))
        return {
          ...tool,
          call: async (values) => {
            const result = await tool.call(values);
            const report = result.report as {
              module?: { semester: string; module: string };
              target?: unknown;
              register?: {
                freshness: string;
                listId: string | null;
                providerSnapshot?: string;
              };
            };
            if (
              result.failed ||
              report.register?.freshness !== "fresh" ||
              !report.register.providerSnapshot
            )
              return result;
            const target = report.target ?? {
              kind: "module",
              key: `${report.module?.semester}/${report.module?.module}`,
              title: report.module?.module,
            };
            return {
              ...result,
              report: {
                ...report,
                execution: {
                  protocol: "task-plan/1",
                  target,
                  listId: report.register.listId,
                  expectedSnapshot: report.register.providerSnapshot,
                  requiredPlanFields: [
                    "schemaVersion",
                    "operationId",
                    "target",
                    "listId",
                    "expectedSnapshot",
                    "operation",
                    "policyVersion",
                  ],
                  createRequires: ["sourceOccurrenceId"],
                  writeArgument: "plan_json",
                  applyTool: "tasks_apply_plan",
                },
              },
            };
          },
        };
      return tool;
    }),
    {
      name: "tasks_sync_capabilities",
      title: "Discover task synchronization protocol",
      description:
        "Read the supported exact-plan protocol and migration route without contacting providers or changing state.",
      fields: [],
      call: async () => ({
        failed: false,
        report: {
          schemaVersion: 1,
          protocol: "task-plan/1",
          readTools: ["tasks_read_register", "research_tasks_read_register"],
          applyTool: "tasks_apply_plan",
          compatibilityTools: [...legacyMutations],
          compatibilityArgument: "plan_json",
          snapshots: "read-register execution.expectedSnapshot",
          descriptions: "refused",
          nativeTiming: "separate-contract-unavailable",
          retries:
            "same operationId and identical immutable plan; unknown-ID creates remain blocked",
        },
      }),
    },
    {
      name: "tasks_apply_plan",
      title: "Apply an exact task plan",
      description:
        "Apply one versioned immutable Module or Research-project plan after fresh preflight. Owner changes return conflicts; unresolved writes reconcile without duplicate effects.",
      fields: [
        {
          name: "plan_json",
          description:
            "Immutable TaskExecutionPlan v1 JSON. Read-register supplies target/list identity and expectedSnapshot; the caller supplies a stable operationId, operation, source occurrence and policyVersion.",
          required: true,
        },
      ],
      call: async (values) => {
        const report = await executor.apply(parseJson(values.get("plan_json")));
        return { report, failed: report.outcome !== "applied" };
      },
    },
  ];
}

function parseJson(value: string | undefined): unknown {
  if (value === undefined)
    throw new OperationalError("invalid-arguments", "plan_json is required.");
  try {
    return JSON.parse(value);
  } catch {
    throw new OperationalError(
      "invalid-arguments",
      "plan_json must be valid JSON.",
    );
  }
}
