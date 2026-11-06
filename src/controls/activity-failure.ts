import type {
  Problem,
  RecoveryRequired,
  Refused,
} from "../module-activity/generated/workflow.js";

export class ActivityFailure extends Error {
  constructor(readonly problem: Problem) {
    super(problem.evidence.join(" "));
  }
}

export function activityRefusal(
  code:
    | Exclude<Problem, Refused | RecoveryRequired>["code"]
    | "evidence-mismatch"
    | "unsupported-effect",
  evidence: string,
  kind: "refused" | "unsupported" | "needs-judgment" = "refused",
): never {
  if (code === "evidence-mismatch" || code === "unsupported-effect")
    throw new ActivityFailure({ kind: "refused", code, evidence: [evidence] });
  throw new ActivityFailure({ kind, code, evidence: [evidence] });
}

export function activityProblem(error: unknown): Problem {
  const problem =
    error instanceof ActivityFailure
      ? error.problem
      : {
          kind: "refused" as const,
          code: "invalid-packet" as const,
          evidence: [
            error instanceof Error ? error.message : "Invalid activity packet.",
          ],
        };
  const bound = (message: string) =>
    message.length > 4096
      ? `${message.slice(0, 4000)} [diagnostic truncated; measured ${message.length} characters]`
      : message;
  return {
    ...problem,
    evidence: [
      bound(problem.evidence[0] ?? "Activity refused."),
      ...problem.evidence.slice(1).map(bound),
    ],
  };
}
