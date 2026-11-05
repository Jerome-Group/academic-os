import type {
  Preparation,
  PreparationDescriptor,
  SubmissionDescriptor,
  SubmitInput,
} from "../module-activity/generated/workflow.js";
import { deriveActivityCloseout } from "./activity-closeout.js";
import {
  type ActivityClosure,
  preparationClosure,
  readActivityClosure,
  sameValue,
} from "./activity-closure.js";
import { activityProblem, activityRefusal } from "./activity-failure.js";
import {
  activityBytes,
  parseActivity,
  readActivityJson,
} from "./activity-packets.js";
import { recognizeActivityProtocol } from "./activity-preparation.js";
import { digest } from "./canonical-json.js";
import type { ControlReadInput } from "./types.js";

export { deriveActivityCloseout } from "./activity-closeout.js";
export { activityProblem } from "./activity-failure.js";
export {
  activitySupersessionSubject,
  extensionActivityMember,
  resolveActivityPreparation,
  standingActivityCoverage,
} from "./activity-preparation.js";
export {
  activityProcedureRegistry,
  activityRegistryDigest,
} from "./activity-registry.js";

export function validateControlTransition(input: {
  before: ControlReadInput | undefined;
  proposed: ControlReadInput;
  request: { candidateId: string; requestId: string; releaseDigest: string };
}): readonly { code: string; evidence: string }[] {
  try {
    validateTransition(input);
    return [];
  } catch (error) {
    const problem = activityProblem(error);
    return [{ code: problem.code, evidence: problem.evidence.join(" ") }];
  }
}

function validateTransition(
  input: Parameters<typeof validateControlTransition>[0],
): void {
  const after = readActivityClosure(input.proposed);
  const protocol = after.control("learning-workspace").activityProtocol;
  const afterRecords = after.control("learning-records");
  if (!input.before) {
    if (!protocol) {
      if (afterRecords.activityCloseouts?.length)
        activityRefusal(
          "illegal-transition",
          "Protocol-free baseline cannot contain executable closeouts.",
        );
      return;
    }
    recognizeActivityProtocol(after);
    if (
      afterRecords.records.length ||
      afterRecords.assessments.length ||
      !afterRecords.activityCloseouts ||
      afterRecords.activityCloseouts.length
    )
      activityRefusal(
        "illegal-transition",
        "Direct initial protocol enablement requires empty records, assessments and explicit empty closeouts. Import history as a protocol-free baseline, then adopt.",
      );
    return;
  }
  const before = readActivityClosure(input.before);
  const oldProtocol = before.control("learning-workspace").activityProtocol;
  if (!oldProtocol) {
    if (!protocol) {
      if (afterRecords.activityCloseouts?.length)
        activityRefusal(
          "illegal-transition",
          "Protocol-free controls cannot introduce executable closeouts.",
        );
      return;
    }
    recognizeActivityProtocol(after);
    validateAdoption(before, after);
    return;
  }
  if (!protocol || !sameValue(oldProtocol, protocol))
    activityRefusal(
      "illegal-transition",
      "Enabled protocol cannot be removed or rebound.",
    );
  recognizeActivityProtocol(before);
  const old = before.control("learning-records");
  const priorCloseouts = old.activityCloseouts;
  const closeouts = afterRecords.activityCloseouts;
  if (!priorCloseouts || !closeouts)
    activityRefusal(
      "illegal-transition",
      "Enabled closeout history cannot be removed.",
    );
  for (const [prior, proposed, name] of [
    [old.records, afterRecords.records, "records"],
    [old.assessments, afterRecords.assessments, "assessments"],
    [priorCloseouts, closeouts, "closeouts"],
    [
      before.control("evidence").entries,
      after.control("evidence").entries,
      "evidence",
    ],
  ] as const)
    if (
      proposed.length < prior.length ||
      !sameValue(prior, proposed.slice(0, prior.length))
    )
      activityRefusal(
        "illegal-transition",
        `Immutable ${name} identity, value or order changed.`,
      );
  const additions = closeouts.slice(priorCloseouts.length);
  if (!additions.length) {
    if (!sameValue(before.bundle, after.bundle))
      activityRefusal(
        "unsupported-effect",
        "Enabled protocol permits only rederived activity appends.",
      );
    return;
  }
  if (
    additions.length !== 1 ||
    afterRecords.records.length !== old.records.length + 1 ||
    afterRecords.assessments.length !== old.assessments.length
  )
    activityRefusal(
      "illegal-transition",
      "Each request appends exactly one current record and one closeout, with no assessment changes.",
    );
  const closeout = additions[0];
  if (
    !closeout ||
    closeout.requestId !== input.request.requestId ||
    closeout.plannerReleaseDigest !== input.request.releaseDigest
  )
    activityRefusal(
      "evidence-mismatch",
      "Closeout request or planner release differs from actual publication context.",
    );
  const descriptor = parseActivity<PreparationDescriptor>(
    readActivityJson(
      activityBytes(after.evidenceBytes(closeout.preparationEvidenceId)),
    ),
    "PreparationDescriptor",
  );
  if (descriptor.filesDigest !== digest(before.files))
    activityRefusal(
      "evidence-mismatch",
      "Retained preparation closure differs from actual owned predecessor.",
    );
  const preparation = parseActivity<Preparation>(
    { ...descriptor.preparation, files: before.files },
    "Preparation",
  );
  if (
    preparation.candidateId !== input.request.candidateId ||
    preparation.baseHeadByteSha256 !== before.head.bytes.byteSha256 ||
    preparation.releaseDigest !== input.request.releaseDigest ||
    digest(preparation) !== closeout.preparationDigest
  )
    activityRefusal(
      "evidence-mismatch",
      "Retained preparation binding differs from actual candidate, head or release.",
    );
  const submission = parseActivity<SubmissionDescriptor>(
    readActivityJson(
      activityBytes(after.evidenceBytes(closeout.submissionEvidenceId)),
    ),
    "SubmissionDescriptor",
  );
  if (
    submission.preparationDigest !== digest(preparation) ||
    submission.requestId !== input.request.requestId ||
    digest(submission) !== closeout.submissionDigest
  )
    activityRefusal(
      "evidence-mismatch",
      "Retained submission digest or request was rebound.",
    );
  const {
    encoding: _encoding,
    preparationDigest: _preparationDigest,
    ...submitted
  } = submission;
  const rederived = deriveActivityCloseout(
    parseActivity<SubmitInput>({ preparation, ...submitted }, "SubmitInput"),
  );
  if (
    !sameValue(rederived.bundle, after.bundle) ||
    !sameValue(rederived.stored, closeout)
  )
    activityRefusal(
      "evidence-mismatch",
      "Raw successor differs from fully rederived record, closeout, deterministic observations, exact evidence or dependency append regions.",
    );
}

function validateAdoption(
  before: ActivityClosure,
  after: ActivityClosure,
): void {
  if (
    !sameValue(
      before.bundle.controls.map((c) => ({ role: c.role, file: c.file })),
      after.bundle.controls.map((c) => ({ role: c.role, file: c.file })),
    )
  )
    activityRefusal(
      "illegal-transition",
      "Adoption cannot rebind control paths or order.",
    );
  const old = before.control("learning-records");
  const records = after.control("learning-records");
  if (
    old.activityCloseouts?.length ||
    !records.activityCloseouts ||
    records.activityCloseouts.length
  )
    activityRefusal(
      "illegal-transition",
      "Initial adoption introduces an empty closeout list.",
    );
  const { activityProtocol: _protocol, ...workspace } =
    after.control("learning-workspace");
  if (!sameValue(workspace, before.control("learning-workspace")))
    activityRefusal(
      "illegal-transition",
      "Adoption changes only the protocol field in its workspace.",
    );
  const { activityCloseouts: _closeouts, ...withoutCloseouts } = records;
  const { activityCloseouts: _oldCloseouts, ...oldWithoutCloseouts } = old;
  if (!sameValue(withoutCloseouts, oldWithoutCloseouts))
    activityRefusal(
      "illegal-transition",
      "Adoption cannot rewrite historical records or assessments.",
    );
  for (const control of before.bundle.controls) {
    if (
      control.role === "learning-workspace" ||
      control.role === "learning-records"
    )
      continue;
    if (
      !sameValue(
        control,
        after.bundle.controls.find((c) => c.role === control.role),
      )
    )
      activityRefusal(
        "unsupported-effect",
        `Adoption changed unaffected role bytes ${control.role}.`,
      );
  }
  if (!sameValue(before.bundle.dependencies, after.bundle.dependencies))
    activityRefusal(
      "illegal-transition",
      "Adoption cannot change retained dependency bindings or bytes.",
    );
}

export function activityBundleFromPreparation(preparation: Preparation) {
  const closure = preparationClosure(preparation);
  return {
    moduleCode: closure.read.shape.head.moduleCode,
    bundle: closure.bundle,
  };
}
