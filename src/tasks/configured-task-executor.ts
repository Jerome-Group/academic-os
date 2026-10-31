import { fileURLToPath } from "node:url";
import { loadCohortTasksConfig } from "../commands/load-cohort-tasks-config.js";
import { resolveStateRoot } from "../config/index.js";
import {
  configuredResearchProjectTaskTarget,
  configuredTaskTarget,
} from "./configured-task-targets.js";
import {
  createFileTaskLifecycleStore,
  type TaskLifecycleMutationSession,
} from "./file-task-lifecycle-store.js";
import {
  createGoogleTaskOperationWriter,
  createGoogleTaskRefreshReader,
} from "./google-tasks-client.js";
import {
  taskLifecycleDecision,
  sameTaskProviderIdentity,
  type TaskLifecycleEntry,
} from "./task-lifecycle.js";
import {
  createFileTaskOperationJournal,
  findTaskCreationSource,
} from "./task-operation-journal-file.js";
import { parseTaskExecutionPlan } from "./task-execution-plan.js";
import { configuredTaskTools } from "../operations/configured-task-tools.js";
import { guardedTaskTools } from "../operations/task-plan-tools.js";
import {
  createConfiguredCompletionPlanning,
  refused,
  safeCompletionCode,
} from "../operations/configured-completion-planning.js";
import { executeTaskPlan } from "./task-execution.js";
import type {
  TaskExecutionChecks,
  TaskExecutionPlan,
  TaskExecutionReport,
} from "./task-execution-types.js";

export async function applyConfiguredTaskPlan(input: {
  configPath: string;
  plan: unknown;
}): Promise<TaskExecutionReport> {
  let plan: TaskExecutionPlan;
  try {
    plan = parseTaskExecutionPlan(input.plan);
  } catch {
    return {
      schemaVersion: 1,
      operationId: "invalid",
      outcome: "conflict",
      taskId: null,
      registerFresh: false,
      code: "invalid-plan",
    };
  }
  const { config, tasks } = await loadCohortTasksConfig(input.configPath);
  const stateRoot = await resolveStateRoot(config);
  const target =
    plan.target.kind === "research-project"
      ? configuredResearchProjectTaskTarget(config, plan.target.key, {
          requireActive: true,
        })
      : moduleTarget();
  const lifecycle = createFileTaskLifecycleStore({
    stateRoot,
    excludedRoots: [
      config.driveMount,
      fileURLToPath(new URL("../../../", import.meta.url)),
    ],
  });
  let executed: TaskExecutionReport | undefined;
  try {
    return await lifecycle.withMutation(async (session) => {
      const knownCreation =
        plan.operation.name === "create"
          ? undefined
          : await findTaskCreationSource(stateRoot, {
              target: plan.target,
              listId: plan.listId,
              taskId: plan.operation.taskId,
            });
      const lifecycleChecks = await createTaskLifecycleExecutionChecks(
        session,
        plan,
        undefined,
        knownCreation?.sourceOccurrenceId,
      );
      let completionChecks: TaskExecutionChecks | undefined;
      const checks: TaskExecutionChecks =
        plan.target.kind === "module" && plan.operation.name === "complete"
          ? {
              ...lifecycleChecks,
              withFirstSendOwner: async (run) => {
                let completed: TaskExecutionReport | undefined;
                try {
                  const guarded = guardedTaskTools(
                    await configuredTaskTools(input.configPath),
                    {
                      apply: async () => {
                        throw new Error("Read-only register seam.");
                      },
                    },
                  );
                  const readRegister = guarded.find(
                    (tool) => tool.name === "tasks_read_register",
                  );
                  if (readRegister === undefined)
                    return refused(plan, "completion-register-unavailable");
                  const completion = createConfiguredCompletionPlanning(
                    config,
                    readRegister,
                  );
                  if (completion === undefined)
                    return refused(plan, "completion-producer-unconfigured");
                  completionChecks = completion.executionChecks(
                    plan,
                    stateRoot,
                  );
                  return completionChecks.withFirstSendOwner === undefined
                    ? refused(plan, "completion-owner-required")
                    : await completionChecks.withFirstSendOwner(async () => {
                        completed = await run();
                        return completed;
                      });
                } catch (error) {
                  return completed === undefined
                    ? refused(plan, safeCompletionCode(error))
                    : {
                        ...completed,
                        outcome: "uncertain",
                        registerFresh: false,
                        code: "completion-owner-failed",
                      };
                }
              },
              beforeSend: async (value) =>
                completionChecks?.beforeSend === undefined
                  ? "completion-owner-required"
                  : completionChecks.beforeSend(value),
            }
          : lifecycleChecks;
      executed = await executeTaskPlan({
        plan,
        target,
        journal: createFileTaskOperationJournal(stateRoot),
        reader: createGoogleTaskRefreshReader(tasks.credentials.scheduledRead),
        writer: createGoogleTaskOperationWriter(
          tasks.credentials.interactiveWrite,
        ),
        checks,
      });
      return executed;
    });
  } catch {
    return executed === undefined
      ? {
          schemaVersion: 1,
          operationId: plan.operationId,
          outcome: "failed",
          taskId: null,
          registerFresh: false,
          code: "lifecycle-unavailable",
        }
      : {
          ...executed,
          outcome: "uncertain",
          registerFresh: false,
          code: "lifecycle-owner-failed",
        };
  }

  function moduleTarget() {
    const parts = plan.target.key.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1])
      throw new Error("The plan must name one configured module.");
    return {
      ...configuredTaskTarget(config, { semester: parts[0], module: parts[1] }),
      identity: {
        kind: "module" as const,
        key: plan.target.key,
        title: parts[1],
      },
    };
  }
}

export async function createTaskLifecycleExecutionChecks(
  session: TaskLifecycleMutationSession,
  plan: TaskExecutionPlan,
  now: () => string = () => new Date().toISOString(),
  knownSourceOccurrenceId?: string,
): Promise<TaskExecutionChecks> {
  const state = await session.read();
  const entries = state.entries.filter(
    (entry) =>
      entry.target.kind === plan.target.kind &&
      entry.target.key === plan.target.key,
  );
  const provider =
    plan.operation.name === "create"
      ? undefined
      : { listId: plan.listId, taskId: plan.operation.taskId };
  const bound =
    provider === undefined
      ? undefined
      : entries.find((entry) =>
          entry.providers.some((binding) =>
            [
              binding.canonical,
              ...binding.aliases.map((alias) => alias.identity),
            ].some((identity) => sameTaskProviderIdentity(identity, provider)),
          ),
        );
  const bindingConflict =
    (bound !== undefined &&
      knownSourceOccurrenceId !== undefined &&
      bound.occurrenceId !== knownSourceOccurrenceId) ||
    (plan.sourceOccurrenceId !== undefined &&
      (bound?.occurrenceId ?? knownSourceOccurrenceId) !== undefined &&
      plan.sourceOccurrenceId !==
        (bound?.occurrenceId ?? knownSourceOccurrenceId));
  const occurrenceId =
    bound?.occurrenceId ??
    knownSourceOccurrenceId ??
    plan.sourceOccurrenceId ??
    (provider
      ? `provider:${JSON.stringify([provider.listId, provider.taskId])}`
      : "");
  const previous =
    bound ?? entries.find((entry) => entry.occurrenceId === occurrenceId);
  return {
    beforeWrite: async () => {
      if (bindingConflict) return "source-occurrence-mismatch";
      if (
        plan.timing !== undefined ||
        ((plan.operation.name === "create" ||
          plan.operation.name === "change") &&
          plan.operation.doDate !== undefined)
      )
        return "native-timing-unavailable";
      const decision = taskLifecycleDecision(state, {
        target: plan.target,
        occurrenceId,
        ...(provider ? { provider } : {}),
      });
      if (!decision.allowed) return decision.reason;
      if (
        plan.operation.name === "create" &&
        previous !== undefined &&
        previous.providers.length > 0
      )
        return "source-already-bound";
    },
    afterApplied: async ({ taskId }) => {
      if (bindingConflict)
        throw new Error(
          "Task provider identity is already bound to a different source occurrence.",
        );
      if (
        previous?.disposition === "completed" ||
        previous?.disposition === "owner-dismissed"
      )
        return;
      const canonical = { listId: plan.listId, taskId };
      const hasIdentity = previous?.providers.some((binding) =>
        [
          binding.canonical,
          ...binding.aliases.map((alias) => alias.identity),
        ].some((identity) => sameTaskProviderIdentity(identity, canonical)),
      );
      const entry: TaskLifecycleEntry = {
        target: { kind: plan.target.kind, key: plan.target.key },
        occurrenceId,
        source: previous?.source ?? {
          kind: "source-occurrence",
          id: occurrenceId,
        },
        disposition:
          plan.operation.name === "complete"
            ? "completed"
            : plan.operation.name === "cancel"
              ? "owner-dismissed"
              : "active",
        recordedAt: now(),
        evidenceRef: `operation:${plan.operationId}`,
        providers: [
          ...(previous?.providers ?? []),
          ...(hasIdentity ? [] : [{ canonical, aliases: [] }]),
        ],
      };
      await session.record(entry);
    },
  };
}
