import type { CurationRegisterEvent } from "./types.js";

// JSON producers can encode an absent optional value as null. Interpret that absence without
// rewriting history or erasing a required value's error; all non-null claims remain unchanged.
export function normalizeCurationEventOptionals(
  event: CurationRegisterEvent,
): CurationRegisterEvent {
  return Object.fromEntries(
    Object.entries(event).filter(([field, value]) => {
      if (value !== null) return true;
      if (field === "checksum" || field === "supersedes") return false;
      if (field === "destination") return event.decision === "curated";
      if (field === "derived") return event.decision === "rederived";
      return true;
    }),
  );
}
