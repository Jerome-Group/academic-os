import type { ModulePassOutcome, RoutineFailure } from "./types.js";

// Every step of a morning turns a throw into a line the Owner reads, and the line says which step
// broke: the caller supplies the code, because "a session failed" is a lie about a shelf catch-up.
export function routineFailure(
  error: unknown,
  fallbackCode: string,
): RoutineFailure {
  if (error instanceof Error && "code" in error) {
    return { code: String(error.code), message: error.message };
  }
  return {
    code: fallbackCode,
    message: error instanceof Error ? error.message : String(error),
  };
}

export function failedModulePass(
  error: unknown,
  fallbackCode: string,
): ModulePassOutcome {
  return {
    curated: [],
    rederived: [],
    superseded: [],
    withdrawn: [],
    parked: [],
    docWrites: [],
    failures: [routineFailure(error, fallbackCode)],
  };
}
