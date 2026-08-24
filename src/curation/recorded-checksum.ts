export type ChecksumAlgorithm = "sha256" | "md5";

// A register line records its checksum either bare or behind its algorithm — `repair` writes
// `md5:<hex>`, and the seeded Curation Procedure's own example writes the digest alone. Both are
// read, and a line written back uses the notation its own register already carries, because the
// arrival walk joins on the recorded string rather than on a parsed digest.
export interface RecordedChecksum {
  algorithm: ChecksumAlgorithm | "unrecognised";
  value: string;
  notation: "bare" | "prefixed";
}

const digestLengths = new Map<number, ChecksumAlgorithm>([
  [64, "sha256"],
  [32, "md5"],
]);
const prefixedDigest = /^(sha256|md5):([0-9a-f]+)$/u;
const bareDigest = /^[0-9a-f]+$/u;

export function readRecordedChecksum(
  raw: unknown,
): RecordedChecksum | undefined {
  if (typeof raw !== "string" || raw === "") return undefined;
  const value = raw.toLowerCase();
  const prefix = prefixedDigest.exec(value);
  const algorithm = prefix?.[1];
  const digest = prefix?.[2];
  if (algorithm !== undefined && digest !== undefined) {
    return {
      algorithm: algorithm === "md5" ? "md5" : "sha256",
      value: digest,
      notation: "prefixed",
    };
  }
  const named = bareDigest.test(value)
    ? digestLengths.get(value.length)
    : undefined;
  return { algorithm: named ?? "unrecognised", value, notation: "bare" };
}

export function renderChecksum(
  algorithm: ChecksumAlgorithm,
  value: string,
  notation: RecordedChecksum["notation"],
): string {
  return notation === "prefixed" ? `${algorithm}:${value}` : value;
}
