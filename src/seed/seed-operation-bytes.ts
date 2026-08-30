import { OperationalError } from "../operational-error.js";
import type { SeedOperation } from "./types.js";

export function seedFileBytes(operation: SeedOperation): Buffer {
  if (operation.kind !== "file") {
    throw new OperationalError(
      "invalid-config",
      `Directory seed operation cannot carry bytes: ${operation.path}.`,
    );
  }
  if (operation.contentsBase64 === undefined) {
    return Buffer.from(operation.contents ?? "", "utf8");
  }
  if (
    operation.contents !== undefined ||
    !isCanonicalBase64(operation.contentsBase64)
  ) {
    throw new OperationalError(
      "invalid-config",
      `Binary seed operation is not canonical: ${operation.path}.`,
    );
  }
  return Buffer.from(operation.contentsBase64, "base64");
}

export function seedFileByteLength(operation: SeedOperation): number {
  return seedFileBytes(operation).byteLength;
}

export function isCanonicalBase64(source: string): boolean {
  if (
    source.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      source,
    )
  ) {
    return false;
  }
  return Buffer.from(source, "base64").toString("base64") === source;
}
