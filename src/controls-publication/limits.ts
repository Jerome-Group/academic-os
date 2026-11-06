import { refuse } from "./failure.js";

export const maximumInputBytes = 8 * 1024 * 1024;
export const maximumFileBytes = 8 * 1024 * 1024;
export const maximumEventBytes = 8 * 1024 * 1024;
export const maximumInputBase64Characters =
  4 * Math.ceil(maximumInputBytes / 3);

export function requireInputBytes(bytes: Uint8Array): void {
  if (bytes.byteLength > maximumInputBytes)
    refuse("invalid-controls", "Raw publication input exceeds 8 MiB.");
}

export function requireFileBytes(byteLength: number): void {
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0 ||
    byteLength > maximumFileBytes
  )
    refuse("invalid-controls", "An individual publication file exceeds 8 MiB.");
}
