import type {
  HostIdentity,
  MetadataObservation,
  ObjectIdentity,
  PhysicalClaim,
} from "./generated/publication-contract-1.js";

declare const directoryHandle: unique symbol;
declare const regularHandle: unique symbol;
declare const rawName: unique symbol;
declare const validatedAnchor: unique symbol;
declare const mutationInterval: unique symbol;
declare const exclusionObservation: unique symbol;

export interface DirectoryHandle {
  readonly [directoryHandle]: true;
}
export interface RegularHandle {
  readonly [regularHandle]: true;
}
export interface RawName {
  readonly [rawName]: true;
}
export interface MutationInterval {
  readonly [mutationInterval]: true;
}
export interface ExclusionObservation {
  readonly [exclusionObservation]: true;
}
export interface ValidatedAccountAnchor {
  readonly [validatedAnchor]: true;
  readonly host: HostIdentity;
  readonly canonicalAnchorPath: string;
  readonly directory: DirectoryHandle;
  readonly ancestry: readonly PhysicalClaim[];
}

export type NativeObservation = {
  readonly object: ObjectIdentity;
  readonly metadata: MetadataObservation;
};
export type EntryObservation =
  | { readonly kind: "absent" }
  | { readonly kind: "present"; readonly observation: NativeObservation };
export type NativeFailure = {
  readonly kind: "native-failure";
  readonly code:
    | "unsupported-host"
    | "unsafe-ancestry"
    | "identity-changed"
    | "exists"
    | "missing"
    | "io"
    | "expired";
  readonly operation: string;
};
export type NativeResult<T> =
  | { readonly kind: "ok"; readonly value: T }
  | NativeFailure;

// Private same-process N-API contract. No method opens the SQLite sidecar.
export interface PublicationNative {
  resolveAccountAnchor(): NativeResult<ValidatedAccountAnchor>;
  component(bytes: Uint8Array): NativeResult<RawName>;
  componentBytes(name: RawName): Uint8Array;
  observeAt(
    parent: DirectoryHandle,
    name: RawName,
  ): NativeResult<EntryObservation>;
  observe(
    handle: DirectoryHandle | RegularHandle,
  ): NativeResult<NativeObservation>;
  openDirectoryNoFollow(
    parent: DirectoryHandle,
    name: RawName,
  ): NativeResult<DirectoryHandle>;
  openRegularNoFollow(
    parent: DirectoryHandle,
    name: RawName,
    access: "read" | "read-write",
  ): NativeResult<RegularHandle>;
  requireLocation(input: {
    parent: DirectoryHandle;
    name: RawName;
    object: ObjectIdentity;
  }): NativeResult<NativeObservation>;
  observeExclusionRoots(input: {
    anchor: ValidatedAccountAnchor;
    requiredRepositoryAndSourcePaths: readonly Uint8Array[];
  }): NativeResult<ExclusionObservation>;
  requirePrivateLocalNonoverlap(input: {
    anchor: ValidatedAccountAnchor;
    namespace: DirectoryHandle;
    exclusions: ExclusionObservation;
  }): NativeResult<undefined>;
  beginIntervalUnderHeldGate(
    anchor: ValidatedAccountAnchor,
  ): NativeResult<MutationInterval>;
  createDirectoryExclusive(input: {
    interval: MutationInterval;
    parent: DirectoryHandle;
    name: RawName;
  }): NativeResult<DirectoryHandle>;
  createRegularExclusive(input: {
    interval: MutationInterval;
    parent: DirectoryHandle;
    name: RawName;
  }): NativeResult<RegularHandle>;
  readBounded(input: {
    file: RegularHandle;
    maximumBytes: number;
    exactLength?: number;
  }): NativeResult<Uint8Array>;
  writeExact(input: {
    interval: MutationInterval;
    file: RegularHandle;
    bytes: Uint8Array;
    expectedObject: ObjectIdentity;
  }): NativeResult<undefined>;
  appendExact(input: {
    interval: MutationInterval;
    file: RegularHandle;
    bytes: Uint8Array;
    expectedObject: ObjectIdentity;
    expectedLength: number;
  }): NativeResult<undefined>;
  syncFile(input: {
    interval: MutationInterval;
    file: RegularHandle;
  }): NativeResult<undefined>;
  syncDirectory(input: {
    interval: MutationInterval;
    directory: DirectoryHandle;
  }): NativeResult<undefined>;
  promoteExclusive(input: {
    interval: MutationInterval;
    sourceParent: DirectoryHandle;
    sourceName: RawName;
    destinationParent: DirectoryHandle;
    destinationName: RawName;
    expectedObject: ObjectIdentity;
  }): NativeResult<undefined>;
  replaceHeadGuarded(input: {
    interval: MutationInterval;
    parent: DirectoryHandle;
    temporaryName: RawName;
    temporaryObject: ObjectIdentity;
    headName: RawName;
    expectedHead:
      | { kind: "absent" }
      | { kind: "present"; object: ObjectIdentity; bytes: Uint8Array };
  }): NativeResult<undefined>;
  expireAndDrain(interval: MutationInterval): NativeResult<undefined>;
  close(handle: DirectoryHandle | RegularHandle): NativeResult<undefined>;
}
