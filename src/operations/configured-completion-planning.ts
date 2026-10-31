import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import type { AcademicConfig } from "../config/types.js";
import { resolveTaskPlanningConfig } from "../config/resolve-tasks-config.js";
import { sha256Bytes } from "../checksum.js";
import { createFilePreparedCompletionStore } from "../tasks/file-prepared-completion-store.js";
import {
  createPrivateCompletionCatalogStore,
  type CompletionCatalogOwner,
} from "../tasks/private-completion-catalog-store.js";
import { hasOtherSentTaskCompletion } from "../tasks/task-operation-journal-file.js";
import { taskExecutionPlanDigest } from "../tasks/task-execution-plan.js";
import type {
  TaskExecutionChecks,
  TaskExecutionPlan,
  TaskExecutionResult,
} from "../tasks/task-execution-types.js";
import {
  createEmmyPlanningProcess,
  type EmmyPlanningRequest,
} from "./emmy-planning-process.js";
import { isJsonObject } from "./json-object.js";
import {
  attestedCompletionCatalog,
  completionSourceContext,
  standingCompletionSource,
} from "./completion-attestation.js";
import type {
  ModuleCompletionPort,
  ModuleCompletionSelector,
} from "./module-completion-tools.js";
import type { OperationTool, OperationToolResult } from "./types.js";

/** Private installed configuration selects authority. No tool argument supplies these values. */
export function createConfiguredCompletionPlanning(
  config: AcademicConfig,
  readRegister: OperationTool,
) {
  const planning = resolveTaskPlanningConfig(config);
  if (planning === undefined) return undefined;
  const storage = {
    stateRoot: planning.privateRoot,
    excludedRoots: [
      config.driveMount,
      fileURLToPath(new URL("../../../", import.meta.url)),
    ],
  };
  const catalogs = createPrivateCompletionCatalogStore(storage);
  const preparedStore = createFilePreparedCompletionStore(storage);
  const producer = createEmmyPlanningProcess(planning);
  const run = async (request: EmmyPlanningRequest, status: string) => {
    const result = await producer.run(request);
    if (result.kind !== "reported") throw new Error(result.code);
    if (result.data.status !== status)
      throw new Error("completion-policy-refused");
    return result.data;
  };
  const available = async (owner: CompletionCatalogOwner) => {
    const snapshot = await owner.read();
    if (snapshot === undefined)
      throw new Error("completion-source-projection-required");
    const catalog: unknown = JSON.parse(snapshot.rawJson.toString("utf8"));
    if (
      snapshot.sourceIdentity !== planning.sourceIdentity ||
      !isJsonObject(catalog) ||
      catalog.sourceRef !== planning.sourceIdentity ||
      !isJsonObject(catalog.scope) ||
      catalog.scope.environment !== planning.environment ||
      catalog.scope.accountId !== planning.accountId
    )
      throw new Error("completion-source-mismatch");
    if (!standingCompletionSource(catalog))
      await run(
        { schemaVersion: 1, stage: "validate", catalog },
        "planning-catalog-valid",
      );
    return {
      catalog,
      snapshot,
      evidence: {
        sourceIdentity: snapshot.sourceIdentity,
        catalogSha256: sha256Bytes(snapshot.rawJson),
        rawCatalogBase64: snapshot.rawJson.toString("base64"),
        acquisitionBase64: snapshot.acquisitionJson.toString("base64"),
      },
    };
  };
  const current = async (owner: CompletionCatalogOwner) => {
    const value = await available(owner);
    if (standingCompletionSource(value.catalog))
      throw new Error("completion-explicit-owner-attestation-required");
    return value;
  };
  const withCatalog = async <T>(
    action: (value: Awaited<ReturnType<typeof current>>) => Promise<T>,
  ) => {
    const owned = await catalogs.withOwner(async (owner) =>
      action(await current(owner)),
    );
    if (owned.kind === "refused")
      throw new Error("completion-catalog-unavailable");
    return owned.value;
  };
  const observation = (result: OperationToolResult) => ({
    environment: planning.environment,
    accountId: planning.accountId,
    capturedAt: new Date().toISOString(),
    evidenceRef: "academic-os:tasks_read_register",
    result,
  });
  const port: ModuleCompletionPort = {
    readRegister,
    producer: {
      catalog: async () => {
        const owned = await catalogs.withOwner(
          async (owner) => (await available(owner)).catalog,
        );
        if (owned.kind !== "owned")
          throw new Error("completion-catalog-unavailable");
        return owned.value;
      },
      context: async (catalog, selector) => {
        if (standingCompletionSource(catalog))
          return completionSourceContext(catalog, selector);
        if (
          isJsonObject(catalog) &&
          Array.isArray(catalog.authorizations) &&
          catalog.authorizations.some(
            (row) => isJsonObject(row) && row.taskId === selector.taskId,
          )
        )
          return undefined;
        const owned = await catalogs.withOwner(async (owner) => {
          const value = await available(owner);
          const acquisition: unknown = JSON.parse(
            value.snapshot.acquisitionJson.toString("utf8"),
          );
          return isJsonObject(acquisition) &&
            acquisition.kind === "module-agent-attested-completion"
            ? completionSourceContext(acquisition.standingSource, selector)
            : undefined;
        });
        if (owned.kind !== "owned")
          throw new Error("completion-catalog-unavailable");
        return owned.value;
      },
      resolve: async (selector, official, attestation) => {
        const owned = await catalogs.withOwner(async (owner) => {
          const previous = await available(owner);
          const acquisition: unknown = JSON.parse(
            previous.snapshot.acquisitionJson.toString("utf8"),
          );
          const source = standingCompletionSource(previous.catalog)
            ? previous.catalog
            : isJsonObject(acquisition) &&
                acquisition.kind === "module-agent-attested-completion"
              ? acquisition.standingSource
              : undefined;
          const resolved = attestedCompletionCatalog(
            source,
            selector,
            official,
            attestation,
          );
          if (
            isJsonObject(acquisition) &&
            acquisition.kind === "module-agent-attested-completion" &&
            acquisition.operationId === resolved.operationId
          ) {
            if (
              !isDeepStrictEqual(acquisition.attestation, attestation) ||
              !isDeepStrictEqual(acquisition.standingSource, source)
            )
              throw new Error("completion-original-attestation-mismatch");
            return previous.catalog;
          }
          const result = await run(
            {
              schemaVersion: 1,
              stage: "publish",
              catalog: resolved.catalogInput,
            },
            "planning-catalog-ready",
          );
          await run(
            { schemaVersion: 1, stage: "validate", catalog: result.catalog },
            "planning-catalog-valid",
          );
          await owner.publish(
            {
              rawJson: Buffer.from(JSON.stringify(result.catalog)),
              sourceIdentity: planning.sourceIdentity,
              acquisitionJson: Buffer.from(
                JSON.stringify({
                  schemaVersion: 1,
                  kind: "module-agent-attested-completion",
                  standingSource: source,
                  originalSourceAcquisition:
                    isJsonObject(acquisition) &&
                    acquisition.kind === "module-agent-attested-completion"
                      ? acquisition.originalSourceAcquisition
                      : acquisition,
                  attestation: resolved.attestation,
                  operationId: resolved.operationId,
                  assurance: "module-agent attestation; chat not authenticated",
                }),
              ),
            },
            async (_candidate, latest) => {
              if (!latest?.rawJson.equals(previous.snapshot.rawJson))
                throw new Error("completion-source-changed");
            },
          );
          return result.catalog;
        });
        if (owned.kind !== "owned")
          throw new Error("completion-catalog-unavailable");
        return owned.value;
      },
      discover: async (catalog, selector) => {
        const discovered = await run(
          { schemaVersion: 1, stage: "discover", catalog, selector },
          "planning-authorizations-discovered",
        );
        if (!Array.isArray(discovered.authorizations))
          throw new Error("invalid-producer-discovery");
        const ids: string[] = [];
        for (const authorization of discovered.authorizations) {
          if (!isJsonObject(authorization))
            throw new Error("invalid-producer-discovery");
          if (
            !isJsonObject(authorization.operation) ||
            authorization.operation.name !== "complete"
          )
            continue;
          if (
            !isDeepStrictEqual(authorization.target, selector.target) ||
            authorization.listId !== selector.listId ||
            authorization.taskId !== selector.taskId ||
            typeof authorization.operationId !== "string"
          )
            throw new Error("invalid-producer-discovery");
          ids.push(authorization.operationId);
        }
        return ids;
      },
      acquire: async (catalog, request, official) =>
        withCatalog(async (value) => {
          if (!isDeepStrictEqual(catalog, value.catalog))
            throw new Error("completion-catalog-changed");
          const inputObservation = observation(official);
          const retained = await preparedStore.read(request.operationId);
          if (retained !== undefined) {
            const packet: unknown = JSON.parse(retained.packetJson);
            if (
              !isJsonObject(packet) ||
              !isDeepStrictEqual(packet.apiPlan, retained.plan)
            )
              throw new Error("completion-original-plan-mismatch");
            const checked = await run(
              {
                schemaVersion: 1,
                stage: "revalidate",
                catalog,
                prepared: packet,
                observation: inputObservation,
              },
              "api-plan-current-reported",
            );
            if (!isDeepStrictEqual(checked.prepared, packet))
              throw new Error("completion-original-packet-mismatch");
            return {
              ready: true,
              prepared: packet,
              call: {
                tool: "tasks_apply_plan",
                arguments: { plan_json: JSON.stringify(retained.plan) },
              },
              acquisitionEvidence:
                retained.acquisitionEvidenceJson === undefined
                  ? undefined
                  : JSON.parse(retained.acquisitionEvidenceJson),
            };
          }
          const acquired = await run(
            {
              schemaVersion: 1,
              stage: "acquire",
              catalog,
              request,
              observation: inputObservation,
            },
            "api-plan-ready-reported",
          );
          return {
            ready: true,
            prepared: acquired.prepared,
            call: acquired.call,
            acquisitionEvidence: {
              source: value.evidence,
              observation: inputObservation,
              producerReport: acquired,
            },
          };
        }),
    },
    retain: async (input) => {
      if (
        !isJsonObject(input.prepared) ||
        !isDeepStrictEqual(input.prepared.apiPlan, input.plan)
      )
        throw new Error("completion-original-plan-mismatch");
      await preparedStore.prepare({
        packetJson: JSON.stringify(input.prepared),
        acquisitionEvidenceJson: JSON.stringify(input.acquisitionEvidence),
        plan: input.plan,
      });
    },
  };
  const executionChecks = (
    plan: TaskExecutionPlan,
    operationStateRoot: string,
    preservedSourceOccurrenceId?: string,
  ): TaskExecutionChecks => {
    let activeOwner: CompletionCatalogOwner | undefined;
    return {
      withFirstSendOwner: async (runOperation) => {
        const owned = await catalogs.withOwner(async (owner) => {
          activeOwner = owner;
          try {
            return await runOperation();
          } finally {
            activeOwner = undefined;
          }
        });
        return owned.kind === "owned"
          ? owned.value
          : refused(plan, "completion-catalog-unavailable");
      },
      beforeSend: async () => {
        const owner = activeOwner;
        if (owner === undefined) return "completion-owner-required";
        try {
          const prepared = await preparedStore.read(plan.operationId);
          if (prepared === undefined)
            return "completion-prepared-packet-required";
          if (
            prepared.planDigest !== taskExecutionPlanDigest(plan) ||
            !isDeepStrictEqual(prepared.plan, plan)
          )
            return "completion-original-plan-mismatch";
          const packet: unknown = JSON.parse(prepared.packetJson);
          if (!isJsonObject(packet) || !isDeepStrictEqual(packet.apiPlan, plan))
            return "completion-original-plan-mismatch";
          if (
            !isJsonObject(packet.intent) ||
            typeof packet.intent.effectKey !== "string" ||
            !/^[a-f0-9]{64}$/u.test(packet.intent.effectKey)
          )
            return "completion-original-packet-invalid";
          if (
            preservedSourceOccurrenceId !== undefined &&
            (!isJsonObject(packet.intent.source) ||
              packet.intent.source.occurrenceId !== preservedSourceOccurrenceId)
          )
            return "completion-retained-source-binding-mismatch";
          const source = await current(owner);
          const selector = moduleSelector(plan);
          const official = await readRegister.call(
            new Map([
              ["semester", selector.target.key.split("/")[0] ?? ""],
              ["module", selector.target.title],
            ]),
          );
          const revalidated = await run(
            {
              schemaVersion: 1,
              stage: "revalidate",
              catalog: source.catalog,
              prepared: packet,
              observation: observation(official),
            },
            "api-plan-current-reported",
          );
          if (!isDeepStrictEqual(revalidated.prepared, packet))
            return "completion-original-packet-mismatch";
          await owner.assertCurrent();
          const effect = await preparedStore.readEffect(
            packet.intent.effectKey,
          );
          if (
            effect !== undefined &&
            (effect.operationId !== prepared.operationId ||
              effect.planDigest !== prepared.planDigest ||
              effect.packetJson !== prepared.packetJson)
          )
            return "completion-effect-reserved";
          if (await hasOtherSentTaskCompletion(operationStateRoot, plan))
            return "completion-original-operation-reconciliation-required";
          await preparedStore.reserveEffect(packet.intent.effectKey, prepared);
          await owner.assertCurrent();
        } catch (error) {
          return safeCompletionCode(error);
        }
      },
    };
  };
  return { port, executionChecks };
}

export function safeCompletionCode(error: unknown): string {
  return error instanceof Error &&
    /^(?:completion|producer|invalid-producer)-[a-z-]+$/u.test(error.message)
    ? error.message
    : "completion-source-unavailable";
}

export function refused(
  plan: TaskExecutionPlan,
  code: string,
): TaskExecutionResult {
  return {
    schemaVersion: 1,
    operationId: plan.operationId,
    outcome: "conflict",
    taskId: null,
    registerFresh: false,
    code,
  };
}

function moduleSelector(plan: TaskExecutionPlan): ModuleCompletionSelector {
  if (plan.target.kind !== "module" || plan.operation.name !== "complete")
    throw new Error("completion-module-required");
  return {
    target: plan.target,
    listId: plan.listId,
    taskId: plan.operation.taskId,
  };
}
