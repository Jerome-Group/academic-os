import {
  activityBytes,
  freezeBytes,
  measureActivityWire,
  parseActivity,
  readActivityJson,
  requireActivitySize,
} from "../controls/index.js";
import type {
  CloseoutPlan,
  FrozenBytes,
  Preparation,
} from "./generated/workflow.js";

export type NativeActivity<T> = T extends FrozenBytes
  ? {
      readonly byteLength: number;
      readonly byteSha256: string;
      readonly bytes: Uint8Array;
    }
  : T extends object
    ? { [K in keyof T]: NativeActivity<T[K]> }
    : T;

export function toActivityWire(value: unknown): unknown {
  measureActivityWire(value);
  return convert(value, true);
}

export function fromActivityWire<T>(value: T): NativeActivity<T> {
  return convert(value, false) as NativeActivity<T>;
}

function convert(value: unknown, encode: boolean): unknown {
  if (!value || typeof value !== "object") return value;
  if (
    encode &&
    "bytes" in value &&
    value.bytes instanceof Uint8Array &&
    "byteLength" in value &&
    "byteSha256" in value
  ) {
    const frozen = freezeBytes(value.bytes);
    if (
      frozen.byteLength !== value.byteLength ||
      frozen.byteSha256 !== value.byteSha256
    )
      throw new Error("Native activity byte binding differs.");
    return frozen;
  }
  if (!encode && "bytesBase64" in value) {
    const frozen = parseActivity<FrozenBytes>(value, "FrozenBytes");
    return {
      byteLength: frozen.byteLength,
      byteSha256: frozen.byteSha256,
      bytes: activityBytes(frozen),
    };
  }
  return Array.isArray(value)
    ? value.map((v) => convert(v, encode))
    : Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, convert(v, encode)]),
      );
}

export function parseActivityInput<T>(input: unknown, name: string): T {
  const wire = toActivityWire(input);
  return parseActivity<T>(wire, name);
}

export function decodeActivityPacket(
  bytes: Uint8Array,
): NativeActivity<Preparation | CloseoutPlan> {
  const value = readActivityJson(bytes);
  if (!value || typeof value !== "object" || !("kind" in value))
    throw new Error("Unknown activity packet kind.");
  if (value.kind === "module-activity-preparation")
    return fromActivityWire(parseActivity<Preparation>(value, "Preparation"));
  if (value.kind === "module-activity-closeout-plan")
    return fromActivityWire(parseActivity<CloseoutPlan>(value, "CloseoutPlan"));
  throw new Error("Unknown activity packet kind.");
}
export function encodeActivityPacket(value: unknown): Uint8Array {
  const wire = toActivityWire(value);
  if (!wire || typeof wire !== "object" || !("kind" in wire))
    throw new Error("Unknown activity packet kind.");
  parseActivity(
    wire,
    wire.kind === "module-activity-preparation"
      ? "Preparation"
      : wire.kind === "module-activity-closeout-plan"
        ? "CloseoutPlan"
        : "UnknownPacket",
  );
  return requireActivitySize(wire);
}
