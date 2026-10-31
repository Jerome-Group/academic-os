import { isDeepStrictEqual } from "node:util";

import { parseTaskExecutionPlan } from "../tasks/task-execution-plan.js";
import type { TaskExecutionPlan } from "../tasks/task-execution-types.js";
import type { TaskTargetIdentity } from "../tasks/types.js";
import { isJsonObject } from "./json-object.js";
import type {
  OperationTool,
  OperationToolField,
  OperationToolResult,
} from "./types.js";

export interface ModuleCompletionSelector {
  target: TaskTargetIdentity;
  listId: string;
  taskId: string;
}

// Adapter contract only. The producer's transport and wire schema belong to its adapter.
export interface ModuleCompletionProducer {
  context?(
    catalog: unknown,
    selector: ModuleCompletionSelector,
  ): Promise<unknown | undefined>;
  resolve?(
    selector: ModuleCompletionSelector,
    observation: OperationToolResult,
    attestation: unknown,
  ): Promise<unknown>;
  catalog(): Promise<unknown>;
  discover(
    catalog: unknown,
    selector: ModuleCompletionSelector,
  ): Promise<readonly string[]>;
  acquire(
    catalog: unknown,
    request: ModuleCompletionSelector & { operationId: string },
    observation: OperationToolResult,
  ): Promise<
    | { ready: false; refusal: unknown }
    | {
        ready: true;
        prepared: unknown;
        call: unknown;
        acquisitionEvidence?: unknown;
      }
  >;
}

export interface ModuleCompletionPort {
  producer: ModuleCompletionProducer;
  readRegister: OperationTool;
  retain?(input: {
    prepared: unknown;
    acquisitionEvidence: unknown;
    plan: TaskExecutionPlan;
  }): Promise<void>;
}

const fields: OperationToolField[] = [
  { name: "semester", description: "Configured semester.", required: true },
  { name: "module", description: "Configured module code.", required: true },
  { name: "task_id", description: "Exact Google task ID.", required: true },
];

export function createModuleCompletionTools(
  port?: ModuleCompletionPort,
): OperationTool[] {
  const capabilities: OperationTool = {
    name: "tasks_completion_capabilities",
    title: "Discover module completion availability",
    description: "Report whether a completion producer adapter is configured.",
    fields: [],
    call: async () => ({
      failed: false,
      report: {
        schemaVersion: 1,
        status: port === undefined ? "unavailable" : "configured",
        reason: port === undefined ? "completion-producer-unconfigured" : null,
        tools:
          port === undefined
            ? []
            : ["tasks_discover_completion", "tasks_prepare_completion"],
      },
    }),
  };
  if (port === undefined) return [capabilities];
  const configured = port;
  return [
    capabilities,
    ...[false, true].map(
      (prepare): OperationTool => ({
        name: prepare
          ? "tasks_prepare_completion"
          : "tasks_discover_completion",
        title: prepare
          ? "Prepare a module completion"
          : "Discover a module completion",
        description:
          "Read the live module register, then discover producer authorization for the exact task. Preparation retains the original producer packet and exact apply call before exposing them; sends no task mutation.",
        fields: prepare
          ? [
              ...fields,
              {
                name: "completion_attestation_json",
                description:
                  "Labelled module-agent attestation of the Owner's explicit finished instruction, bound to exact task and discovered source context; no authenticated-chat claim.",
              },
            ]
          : fields,
        call: async (values) => {
          try {
            const semester = required(values, "semester");
            const module = required(values, "module");
            const taskId = required(values, "task_id");
            if (configured.readRegister.name !== "tasks_read_register")
              return refusal("official-register-tool-required");
            const observation = await configured.readRegister.call(
              new Map([
                ["semester", semester],
                ["module", module],
              ]),
            );
            const report = observation.report;
            if (
              observation.failed ||
              !isJsonObject(report) ||
              report.schemaVersion !== 1 ||
              report.command !== "tasks read-register" ||
              report.outcome !== "read" ||
              !isJsonObject(report.register) ||
              report.register.freshness !== "fresh" ||
              !isJsonObject(report.execution) ||
              report.execution.protocol !== "task-plan/1"
            )
              return refusal("fresh-register-required");
            const listId = report.execution.listId;
            const snapshot = report.execution.expectedSnapshot;
            if (
              typeof listId !== "string" ||
              listId.trim() === "" ||
              typeof snapshot !== "string" ||
              !/^[a-f0-9]{64}$/u.test(snapshot) ||
              report.register.listId !== listId ||
              report.register.providerSnapshot !== snapshot
            )
              return refusal("fresh-register-required");
            const target: TaskTargetIdentity = {
              kind: "module",
              key: `${semester}/${module}`,
              title: module,
            };
            if (
              !isJsonObject(report.module) ||
              report.module.semester !== semester ||
              report.module.module !== module ||
              report.register.semester !== semester ||
              report.register.module !== module ||
              !isDeepStrictEqual(report.execution.target, target)
            )
              return refusal("module-observation-mismatch");
            if (
              !Array.isArray(report.tasks) ||
              report.tasks.some((row) => !isJsonObject(row))
            )
              return refusal("exact-open-task-required");
            const task = report.tasks.filter(
              (row: unknown) => isJsonObject(row) && row.taskId === taskId,
            );
            if (
              task.length !== 1 ||
              !isJsonObject(task[0]) ||
              task[0].status !== "open"
            )
              return refusal("exact-open-task-required");
            const selector: ModuleCompletionSelector = {
              target,
              listId,
              taskId,
            };
            const attestationJson = values.get("completion_attestation_json");
            const catalog =
              prepare &&
              attestationJson !== undefined &&
              configured.producer.resolve !== undefined
                ? await configured.producer.resolve(
                    selector,
                    observation,
                    JSON.parse(attestationJson),
                  )
                : await configured.producer.catalog();
            const sourceContext = await configured.producer.context?.(
              catalog,
              selector,
            );
            if (sourceContext !== undefined)
              return {
                failed: prepare,
                report: {
                  schemaVersion: 1,
                  status: "attestation-required",
                  code: "completion-explicit-owner-attestation-required",
                  sourceContext,
                  attestationKind: "module-agent-attestation",
                  statement: "owner-explicitly-finished",
                  assurance:
                    "module-agent relay of explicit Owner instruction; chat not authenticated",
                },
              };
            const operations = await configured.producer.discover(
              catalog,
              selector,
            );
            if (
              !Array.isArray(operations) ||
              operations.some(
                (id) =>
                  typeof id !== "string" || id.trim() === "" || id.length > 200,
              )
            )
              return refusal("invalid-producer-discovery");
            const [operationId] = operations;
            if (operations.length !== 1 || operationId === undefined)
              return {
                ...refusal(
                  operations.length === 0
                    ? "completion-authorization-missing"
                    : "completion-authorization-ambiguous",
                ),
                report: {
                  schemaVersion: 1,
                  status: "refused",
                  code:
                    operations.length === 0
                      ? "completion-authorization-missing"
                      : "completion-authorization-ambiguous",
                  choices: operations,
                },
              };
            if (!prepare)
              return {
                failed: false,
                report: {
                  schemaVersion: 1,
                  status: "discovered",
                  selector,
                  operationId,
                },
              };
            const acquired = await configured.producer.acquire(
              catalog,
              { ...selector, operationId },
              observation,
            );
            if (acquired.ready !== true)
              return refusal(producerRefusalCode(acquired.refusal));
            try {
              const call = acquired.call;
              if (
                !isJsonObject(call) ||
                Object.keys(call).some(
                  (key) => !["tool", "arguments"].includes(key),
                ) ||
                call.tool !== "tasks_apply_plan" ||
                !isJsonObject(call.arguments) ||
                Object.keys(call.arguments).length !== 1 ||
                typeof call.arguments.plan_json !== "string"
              )
                return refusal("producer-plan-mismatch");
              const plan = parseTaskExecutionPlan(
                JSON.parse(call.arguments.plan_json),
              );
              if (
                plan.operationId !== operationId ||
                !isDeepStrictEqual(plan.target, selector.target) ||
                plan.listId !== listId ||
                plan.expectedSnapshot !== snapshot ||
                plan.operation.name !== "complete" ||
                plan.operation.taskId !== taskId ||
                plan.timing !== undefined
              )
                return refusal("producer-plan-mismatch");
              if (configured.retain === undefined)
                return refusal("completion-execution-binding-unavailable");
              await configured.retain({
                prepared: acquired.prepared,
                acquisitionEvidence: acquired.acquisitionEvidence,
                plan,
              });
              return {
                failed: false,
                report: {
                  schemaVersion: 1,
                  status: "prepared",
                  operationId,
                  prepared: acquired.prepared,
                  call,
                },
              };
            } catch {
              return refusal("producer-plan-mismatch");
            }
          } catch (error) {
            const code =
              error instanceof Error &&
              /^(?:completion|producer|invalid-producer)-[a-z-]+$/u.test(
                error.message,
              )
                ? error.message
                : "completion-source-unavailable";
            return refusal(code);
          }
        },
      }),
    ),
  ];
}

function refusal(code: string) {
  return {
    failed: true,
    report: {
      schemaVersion: 1,
      status: "refused",
      code,
      ...([
        "completion-source-projection-required",
        "completion-source-binding-clarification-required",
      ].includes(code)
        ? {
            clarification:
              "The native source coordinator must resolve this exact task to its versioned assignment, occurrence and unit range, including prerequisite and Owner-policy evidence. Clarify the source identity/range; do not construct policy from the task title or infer completion.",
          }
        : {}),
    },
  };
}

function required(values: ReadonlyMap<string, string>, name: string): string {
  const value = values.get(name);
  if (value === undefined) throw new Error(`Missing ${name}.`);
  return value;
}

function producerRefusalCode(value: unknown): string {
  if (
    isJsonObject(value) &&
    typeof value.code === "string" &&
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(value.code) &&
    value.code.length <= 100
  )
    return value.code;
  return "producer-not-ready";
}
