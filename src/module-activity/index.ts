import { readFile } from "node:fs/promises";
import {
  activityBundleFromPreparation,
  activityBytes,
  activityProblem,
  deriveActivityCloseout,
  digest,
  encodeCanonicalJson,
  freezeBytes,
  parseActivity,
  readActivityJson,
  requireActivitySize,
  resolveActivityPreparation,
  validateControlTransition,
} from "../controls/index.js";
import {
  createPublicationService,
  validateGeneratedBundle,
} from "../controls-publication/index.js";
import type * as Wire from "./generated/workflow.js";
import {
  fromActivityWire,
  type NativeActivity,
  parseActivityInput,
} from "./schema.js";

export type PrepareInput = NativeActivity<Wire.PrepareInput>;
export type PrepareResult = NativeActivity<Wire.PrepareResult>;
export type SubmitInput = NativeActivity<Wire.SubmitInput>;
export type SubmitResult = NativeActivity<Wire.SubmitResult>;
export type CloseInput = NativeActivity<Wire.CloseInput>;
export type CloseResult = NativeActivity<Wire.CloseResult>;
export type Preparation = NativeActivity<Wire.Preparation>;
export type CloseoutPlan = NativeActivity<Wire.CloseoutPlan>;
export { decodeActivityPacket, encodeActivityPacket } from "./schema.js";

export function createModuleActivityService(
  context: Parameters<typeof createPublicationService>[0] = {
    exclusionPaths: [],
  },
) {
  const publication = createPublicationService(context);
  return {
    async prepare(input: PrepareInput): Promise<PrepareResult> {
      try {
        const request = parseActivityInput<Wire.PrepareInput>(
          input,
          "PrepareInput",
        );
        const inspected = await publication.inspect({
          candidateId: request.candidateId,
          selection: { kind: "current" },
        });
        if (
          inspected.kind === "refused" ||
          inspected.kind === "recovery-required"
        )
          return finish(inspected, "PrepareResult");
        if (inspected.kind !== "inspected")
          return finish(
            {
              kind: "unsupported",
              code: "missing-prerequisite",
              evidence: [
                "Candidate has no selected complete Module generation.",
              ],
            },
            "PrepareResult",
          );
        const before = {
          moduleCode: inspected.candidate.aggregate.moduleCode,
          files: inspected.files.map((file) => ({
            kind: "file" as const,
            path: file.path,
            bytes: activityBytes(file.bytes),
          })),
        };
        const preparation = resolveActivityPreparation({
          before,
          request,
          releaseDigest: await activityRelease(),
        });
        validatePreparationBundle(preparation, inspected.candidate.aggregate);
        // A portable preparation must also fit its subsequent action envelope.
        requireActivitySize({
          preparation,
          requestId: "r".repeat(80),
          evidence: {},
          supersedes: [],
          date: {},
        });
        return finish({ kind: "prepared", preparation }, "PrepareResult");
      } catch (error) {
        return finish(activityProblem(error), "PrepareResult");
      }
    },
    async submit(input: SubmitInput): Promise<SubmitResult> {
      try {
        const submitted = parseActivityInput<Wire.SubmitInput>(
          input,
          "SubmitInput",
        );
        if (submitted.preparation.releaseDigest !== (await activityRelease()))
          return finish(
            {
              kind: "refused",
              code: "release-conflict",
              evidence: ["Preparation belongs to a different checker release."],
            },
            "SubmitResult",
          );
        const plan = freezeActivityPlan(submitted);
        requireActivitySize({ plan });
        return finish({ kind: "planned", plan }, "SubmitResult");
      } catch (error) {
        return finish(activityProblem(error), "SubmitResult");
      }
    },
    async close(input: CloseInput): Promise<CloseResult> {
      try {
        const { plan } = parseActivityInput<Wire.CloseInput>(
          input,
          "CloseInput",
        );
        if (plan.releaseDigest !== (await activityRelease()))
          return finish(
            {
              kind: "refused",
              code: "release-conflict",
              evidence: ["Frozen plan belongs to a different checker release."],
            },
            "CloseResult",
          );
        const verified = freezeActivityPlan({
          preparation: plan.preparation,
          requestId: plan.requestId,
          evidence: plan.evidence,
          supersedes: plan.supersedes,
          date: plan.date,
          ...(plan.supersessionJudgment
            ? { supersessionJudgment: plan.supersessionJudgment }
            : {}),
        });
        if (digest(verified) !== digest(plan))
          throw new Error(
            "Frozen plan, exact bytes, logical result or append regions differ from rederivation.",
          );
        const result = await publication.publish({
          candidateId: plan.candidateId,
          requestId: plan.requestId,
          expectedHead: plan.expectedHead,
          bundleBytes: activityBytes(plan.bundleBytes),
        });
        if (result.kind !== "published") return finish(result, "CloseResult");
        if (result.currentHead.kind !== "selected")
          throw new Error("Published result lacks current selected head.");
        return finish(
          {
            kind: "published",
            logicalResult: plan.logicalResult,
            publication: {
              requestId: result.receipt.requestId,
              receiptId: result.receipt.receiptId,
              planDigest: result.receipt.planDigest,
              selectedGenerationId: result.receipt.selectedHead.generationId,
              selectedHeadByteSha256:
                result.receipt.selectedHead.head.byteSha256,
            },
            replayed: result.replayed,
            currentHead: {
              generationId: result.currentHead.generationId,
              headByteSha256: result.currentHead.head.byteSha256,
            },
          },
          "CloseResult",
        );
      } catch (error) {
        return finish(activityProblem(error), "CloseResult");
      }
    },
  };
}

type ActivityResults = {
  PrepareResult: Wire.PrepareResult;
  SubmitResult: Wire.SubmitResult;
  CloseResult: Wire.CloseResult;
};
function finish<N extends keyof ActivityResults>(
  result: unknown,
  name: N,
): NativeActivity<ActivityResults[N]> {
  return fromActivityWire(parseActivity<ActivityResults[N]>(result, name));
}

async function activityRelease(): Promise<string> {
  return digest(
    readActivityJson(
      await readFile(new URL("./release.json", import.meta.url)),
    ),
  );
}

function validatePreparationBundle(
  preparation: Wire.Preparation,
  aggregate: Parameters<typeof validateGeneratedBundle>[0]["aggregate"],
) {
  const derived = derivePredecessorBundle(preparation);
  const result = validateGeneratedBundle({
    bundleBytes: encodeCanonicalJson(derived),
    aggregate,
  });
  if (result.kind !== "validated") throw new Error(result.evidence.join(" "));
  return result;
}

function derivePredecessorBundle(preparation: Wire.Preparation) {
  return activityBundleFromPreparation(preparation).bundle;
}

function freezeActivityPlan(input: Wire.SubmitInput): Wire.CloseoutPlan {
  const closure = activityBundleFromPreparation(input.preparation);
  const aggregate = {
    kind: "module" as const,
    module: input.preparation.moduleId,
    moduleCode: closure.moduleCode,
  };
  validatePreparationBundle(input.preparation, aggregate);
  const derived = deriveActivityCloseout(input);
  const bundleBytes = freezeBytes(requireActivitySize(derived.bundle));
  const validated = validateGeneratedBundle({
    bundleBytes: activityBytes(bundleBytes),
    aggregate,
  });
  if (validated.kind !== "validated")
    throw new Error(validated.evidence.join(" "));
  const issues = validateControlTransition({
    before: {
      moduleCode: aggregate.moduleCode,
      files: input.preparation.files.map((file) => ({
        kind: "file",
        path: file.path,
        bytes: activityBytes(file.bytes),
      })),
    },
    proposed: { moduleCode: aggregate.moduleCode, files: validated.files },
    request: {
      candidateId: input.preparation.candidateId,
      requestId: input.requestId,
      releaseDigest: input.preparation.releaseDigest,
    },
  });
  if (issues.length)
    throw new Error(issues.map((issue) => issue.evidence).join(" "));
  const submissionDigest = derived.stored.submissionDigest;
  return parseActivity<Wire.CloseoutPlan>(
    {
      schemaVersion: 1,
      kind: "module-activity-closeout-plan",
      encoding: "academic-os-activity-plan/1",
      planId: `activity-plan:${digest({ encoding: "academic-os-activity-plan/1", preparationDigest: digest(input.preparation), submissionDigest, releaseDigest: input.preparation.releaseDigest, bundleByteSha256: bundleBytes.byteSha256 })}`,
      candidateId: input.preparation.candidateId,
      requestId: input.requestId,
      releaseDigest: input.preparation.releaseDigest,
      preparation: input.preparation,
      evidence: input.evidence,
      supersedes: input.supersedes,
      logicalResult: derived.logicalResult,
      expectedHead: {
        kind: "digest",
        headByteSha256: input.preparation.baseHeadByteSha256,
      },
      bundleBytes,
      date: input.date,
      exactWrites: derived.exactWrites,
      ...(input.supersessionJudgment
        ? { supersessionJudgment: input.supersessionJudgment }
        : {}),
    },
    "CloseoutPlan",
  );
}

export const prepareActivity = (input: PrepareInput): Promise<PrepareResult> =>
  createModuleActivityService().prepare(input);
export const submitActivityEvidence = (
  input: SubmitInput,
): Promise<SubmitResult> => createModuleActivityService().submit(input);
export const closeActivity = (input: CloseInput): Promise<CloseResult> =>
  createModuleActivityService().close(input);
