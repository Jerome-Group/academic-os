import { createRequire } from "node:module";
import type { NativeResult, PublicationNative } from "../native-contract.js";

const methods = [
  "resolveAccountAnchor",
  "component",
  "componentBytes",
  "observeAt",
  "observe",
  "openDirectoryNoFollow",
  "openRegularNoFollow",
  "requireLocation",
  "observeExclusionRoots",
  "requirePrivateLocalNonoverlap",
  "beginIntervalUnderHeldGate",
  "createDirectoryExclusive",
  "createRegularExclusive",
  "readBounded",
  "writeExact",
  "appendExact",
  "syncFile",
  "syncDirectory",
  "promoteExclusive",
  "replaceHeadGuarded",
  "expireAndDrain",
  "close",
] satisfies readonly (keyof PublicationNative)[];

export function isPublicationNative(
  value: unknown,
): value is PublicationNative {
  return (
    typeof value === "object" &&
    value !== null &&
    methods.every(
      (method) =>
        method in value && typeof Reflect.get(value, method) === "function",
    )
  );
}

export function loadPublicationNative(): NativeResult<PublicationNative> {
  if (
    process.platform !== "darwin" ||
    Number(process.versions.node.split(".")[0]) < 24
  ) {
    return {
      kind: "native-failure",
      code: "unsupported-host",
      operation: "native-load",
    };
  }
  try {
    const addon: unknown = createRequire(import.meta.url)(
      "./publication-native.node",
    );
    if (isPublicationNative(addon)) return { kind: "ok", value: addon };
  } catch {
    return {
      kind: "native-failure",
      code: "unsupported-host",
      operation: "native-load",
    };
  }
  return {
    kind: "native-failure",
    code: "unsupported-host",
    operation: "native-load",
  };
}
