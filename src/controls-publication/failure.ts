import type {
  RecoveryRequired,
  Refused,
} from "./generated/publication-contract-1.js";

export class PublicationFailure extends Error {
  constructor(readonly result: Refused | RecoveryRequired) {
    super(result.evidence.join(" "));
  }
}

export function refuse(code: Refused["code"], evidence: string): never {
  throw new PublicationFailure({ kind: "refused", code, evidence: [evidence] });
}

export function recover(
  code: RecoveryRequired["code"],
  evidence: string,
  requestId: string | null = null,
  retainedPlanDigest: string | null = null,
): never {
  throw new PublicationFailure({
    kind: "recovery-required",
    code,
    requestId,
    retainedPlanDigest,
    evidence: [evidence],
  });
}
