export type IncompleteCurationOutcome = "blocked" | "unresolved";

export function incompleteCurationOutcome(input: {
  modules: readonly {
    blockers: readonly string[];
    discrepancies: readonly { evidence: string }[];
  }[];
  unresolved?: readonly { reason: string }[];
}): IncompleteCurationOutcome | undefined {
  if (
    (input.unresolved?.length ?? 0) > 0 ||
    input.modules.some(({ blockers }) => blockers.length > 0)
  )
    return "blocked";
  return input.modules.some(({ discrepancies }) => discrepancies.length > 0)
    ? "unresolved"
    : undefined;
}
