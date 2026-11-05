import type {
  NamingArtifact,
  NamingDiagnostic,
  OccupiedPath,
} from "./types.js";
import { collisionKey } from "./unicode.js";

export interface Candidate {
  artifact: NamingArtifact;
  diagnostics: NamingDiagnostic[];
  path: string;
  qualified: boolean;
}

export function hasCollision(
  candidate: Candidate,
  candidates: readonly Candidate[],
  occupied: readonly OccupiedPath[],
): boolean {
  const key = collisionKey(candidate.path);
  return (
    candidates.some(
      (other) =>
        other !== candidate &&
        (pathsOverlap(key, collisionKey(other.path)) ||
          directorySpellingConflict(candidate.path, other.path)),
    ) ||
    occupied.some((other) => {
      const occupiedKey = collisionKey(other.path);
      return (
        directorySpellingConflict(candidate.path, other.path) ||
        key === occupiedKey ||
        occupiedKey.startsWith(`${key}/`) ||
        (other.kind !== "directory" && key.startsWith(`${occupiedKey}/`)) ||
        (other.kind === "directory" &&
          key.startsWith(`${occupiedKey}/`) &&
          !candidate.path.startsWith(`${other.path}/`))
      );
    })
  );
}

function directorySpellingConflict(left: string, right: string): boolean {
  const first = left.split("/");
  const second = right.split("/");
  for (
    let index = 0;
    index < Math.min(first.length, second.length) - 1;
    index++
  ) {
    const firstPrefix = first.slice(0, index + 1).join("/");
    const secondPrefix = second.slice(0, index + 1).join("/");
    if (
      collisionKey(firstPrefix) === collisionKey(secondPrefix) &&
      firstPrefix !== secondPrefix
    )
      return true;
  }
  return false;
}

function pathsOverlap(left: string, right: string): boolean {
  return (
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}
