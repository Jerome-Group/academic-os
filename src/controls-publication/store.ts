import { randomUUID } from "node:crypto";
import { digest, encodePublication, equalBytes, sha256 } from "./codec.js";
import { recover, refuse } from "./failure.js";
import type {
  DirectoryClaim,
  FileClaim,
  FrozenBytes,
  Location,
  NamespaceClaim,
  ObjectIdentity,
  PhysicalClaim,
  PublicationRecord,
  RecoveryRequired,
  StageClaim,
  StageReservation,
  TemporaryReservation,
} from "./generated/publication-contract-1.js";
import {
  maximumEventBytes,
  maximumFileBytes,
  requireFileBytes,
} from "./limits.js";
import type {
  DirectoryHandle,
  ExclusionObservation,
  MutationInterval,
  NativeObservation,
  NativeResult,
  PublicationNative,
  RegularHandle,
  ValidatedAccountAnchor,
} from "./native-contract.js";
import {
  type MixedEvent,
  type MixedRecord,
  parseBytes,
  validateMixedEvent,
} from "./schema.js";
import { ReplayAllocation, unsharedAllocation } from "./replay-allocation.js";

export const ledgerName = "academic-os-control-publication.jsonl";
export const namespaceName = "academic-os-control-publication";

export function nativeValue<T>(result: NativeResult<T>): T {
  if (result.kind === "ok") return result.value;
  if (result.code === "unsupported-host")
    refuse("unsupported-host", result.operation);
  if (result.code === "exists") refuse("unowned-output", result.operation);
  if (result.code === "expired")
    recover("uncertain-publication", result.operation);
  refuse("unsafe-namespace", `${result.operation}: ${result.code}`);
}

export function sameObject(
  a: Omit<ObjectIdentity, "kind"> & { kind: string },
  b: Omit<ObjectIdentity, "kind"> & { kind: string },
): boolean {
  return (
    a.kind === b.kind &&
    a.volumeUuid === b.volumeUuid &&
    a.device === b.device &&
    a.inode === b.inode &&
    a.birthtimeNs === b.birthtimeNs
  );
}

export function sameLocation(a: Location, b: Location): boolean {
  return sameObject(a.parent, b.parent) && a.rawNameBase64 === b.rawNameBase64;
}

export function nativeEffect<T>(
  result: NativeResult<T>,
  code: RecoveryRequired["code"] = "uncertain-publication",
): T {
  if (result.kind === "ok") return result.value;
  if (result.code === "exists") refuse("unowned-output", result.operation);
  recover(code, `${result.operation}: ${result.code}`);
}

type StageInput = {
  requestId: string;
  purpose: StageReservation["purpose"];
  staging: DirectoryHandle;
  finalParent: DirectoryHandle;
  finalName: string;
};

export class PublicationStore {
  readonly handles: (DirectoryHandle | RegularHandle)[] = [];
  private retainedRecords: MixedRecord[] = [];
  private readonly retainedDigests = new WeakMap<MixedRecord, string>();
  private recordPositions: Map<string, number> | undefined;
  private replayAllocation = new ReplayAllocation();
  private completion:
    | { bytes: number; rows: number; allocation: number }
    | undefined;
  private completionKey: string | undefined;
  private preparedAllocation = 0;
  private mutationPreflight: (() => void) | undefined;
  private nextSequence: number | null = 0;
  private ledgerLength = 0;
  private previousHash: string | null = null;
  ledger!: RegularHandle;
  ledgerClaim!: PhysicalClaim;
  namespace!: DirectoryHandle;
  namespaceClaim!: NamespaceClaim;

  constructor(
    readonly native: PublicationNative,
    readonly anchor: ValidatedAccountAnchor,
    readonly exclusions: ExclusionObservation,
    readonly interval: MutationInterval | null,
  ) {}

  name(value: string) {
    return nativeValue(this.native.component(Buffer.from(value)));
  }
  keep<T extends DirectoryHandle | RegularHandle>(handle: T): T {
    this.handles.push(handle);
    return handle;
  }
  observation(handle: DirectoryHandle | RegularHandle): NativeObservation {
    return nativeValue(this.native.observe(handle));
  }
  location(parent: DirectoryHandle, name: string): Location {
    return {
      parent: this.observation(parent).object,
      rawNameBase64: Buffer.from(name).toString("base64"),
    };
  }
  claim(
    parent: DirectoryHandle,
    name: string,
    handle: DirectoryHandle | RegularHandle,
  ): PhysicalClaim {
    const observation = this.observation(handle);
    return { ...observation, location: this.location(parent, name) };
  }
  requireClaim(
    parent: DirectoryHandle,
    name: string,
    claim: PhysicalClaim,
  ): void {
    if (!sameLocation(claim.location, this.location(parent, name)))
      refuse("root-replaced", "Claimed parent or raw name changed.");
    const result = this.native.requireLocation({
      parent,
      name: this.name(name),
      object: claim.object,
    });
    if (
      result.kind !== "ok" &&
      ["identity-changed", "missing"].includes(result.code)
    )
      refuse("root-replaced", "Claimed object or parent/name linkage changed.");
    nativeValue(result);
  }
  guard(): void {
    this.requireClaim(this.anchor.directory, ledgerName, this.ledgerClaim);
    this.requireClaim(
      this.anchor.directory,
      namespaceName,
      this.namespaceClaim.namespace,
    );
    nativeValue(
      this.native.requirePrivateLocalNonoverlap({
        anchor: this.anchor,
        namespace: this.namespace,
        exclusions: this.exclusions,
      }),
    );
  }
  mutating(): MutationInterval {
    if (this.interval === null) throw new Error("Read-only publication store.");
    this.mutationPreflight?.();
    if (this.completion) this.checkCompletion(this.completion);
    return this.interval;
  }
  records(): readonly PublicationRecord[] {
    return this.retainedRecords.filter(
      (record): record is PublicationRecord => record.schemaVersion === 1,
    );
  }
  mixedRecords(): readonly MixedRecord[] {
    return this.retainedRecords;
  }
  recordDigest(record: MixedRecord): string {
    const prior = this.retainedDigests.get(record);
    if (prior) return prior;
    const value = digest(record);
    if (Object.isFrozen(record)) this.retainedDigests.set(record, value);
    return value;
  }
  recordPosition(record: MixedRecord): number {
    if (!this.recordPositions) {
      const positions = new Map<string, number>();
      this.retainedRecords.forEach((row, index) => {
        const key = this.recordDigest(row);
        if (!positions.has(key)) positions.set(key, index);
      });
      this.recordPositions = positions;
    }
    return this.recordPositions.get(this.recordDigest(record)) ?? -1;
  }
  beforeMutation(preflight: () => void): void {
    this.mutationPreflight = preflight;
  }
  private allocation(): ReplayAllocation {
    if (!this.replayAllocation) this.replayAllocation = new ReplayAllocation();
    return this.replayAllocation;
  }
  replayAllocationBytes(): number {
    return this.allocation().byteLength;
  }
  private checkCompletion(suffix: {
    bytes: number;
    rows: number;
    allocation: number;
  }): void {
    if (
      !Number.isSafeInteger(suffix.allocation) ||
      suffix.allocation < this.preparedAllocation
    )
      recover(
        "durability-unavailable",
        "The frozen replay allocation suffix is exhausted.",
      );
    this.requireAppendCapacity(suffix.bytes, suffix.rows);
    this.allocation().require(
      suffix.allocation - this.preparedAllocation,
      suffix.rows,
    );
  }
  completionReservedFor(key: string): boolean {
    return this.completion !== undefined && this.completionKey === key;
  }
  reserveCompletion(
    suffix: { bytes: number; rows: number; allocation: number },
    key?: string,
  ): void {
    this.checkCompletion(suffix);
    this.completion = { ...suffix };
    this.completionKey = key;
  }
  requireAppendCapacity(additionalBytes: number, additionalRows = 1): void {
    if (
      !Number.isSafeInteger(additionalBytes) ||
      additionalBytes < 0 ||
      additionalBytes > this.native.maximumFileOffset - this.ledgerLength ||
      !Number.isSafeInteger(additionalRows) ||
      additionalRows < 1 ||
      this.nextSequence === null ||
      additionalRows - 1 > Number.MAX_SAFE_INTEGER - this.nextSequence
    )
      recover(
        "durability-unavailable",
        "Publication ledger offset or sequence is exhausted. Retained evidence requires recovery.",
      );
  }
  preflightRecord(record: MixedRecord): Uint8Array {
    this.requireAppendCapacity(0);
    const sequence = this.nextSequence;
    if (sequence === null)
      recover("durability-unavailable", "Publication sequence is exhausted.");
    const event: MixedEvent = {
      schemaVersion: 1,
      sequence,
      previousEventByteSha256: this.previousHash,
      record,
    };
    const bytes = encodePublication(event);
    if (bytes.byteLength >= maximumEventBytes)
      refuse(
        "invalid-controls",
        "Encoded publication event including LF exceeds 8 MiB.",
      );
    parseBytes(bytes, validateMixedEvent);
    this.requireAppendCapacity(bytes.byteLength + 1);
    if (
      this.completion &&
      (bytes.byteLength + 1 > this.completion.bytes ||
        this.completion.rows < 1 ||
        unsharedAllocation(record) > this.completion.allocation)
    )
      recover(
        "durability-unavailable",
        "The complete publication recovery suffix is exhausted.",
      );
    this.allocation().require(
      this.completion ? 0 : unsharedAllocation(record),
      1,
    );
    return bytes;
  }
  append(record: MixedRecord): void {
    const bytes = this.preflightRecord(record);
    this.preparedAllocation = unsharedAllocation(record);
    const retained = this.allocation().retain(record);
    const sequence = this.nextSequence;
    if (sequence === null)
      recover("durability-unavailable", "Publication sequence is exhausted.");
    this.requireClaim(this.anchor.directory, ledgerName, this.ledgerClaim);
    nativeEffect(
      this.native.appendExact({
        interval: this.mutating(),
        file: this.ledger,
        bytes: Buffer.concat([bytes, Buffer.from("\n")]),
        expectedObject: this.ledgerClaim.object,
        expectedLength: this.ledgerLength,
      }),
    );
    nativeEffect(
      this.native.syncFile({ interval: this.mutating(), file: this.ledger }),
      "durability-unavailable",
    );
    this.retainedRecords.push(retained);
    if (this.recordPositions) {
      const key = this.recordDigest(retained);
      if (!this.recordPositions.has(key))
        this.recordPositions.set(key, this.retainedRecords.length - 1);
    }
    this.allocation().addRow();
    if (this.completion) {
      this.completion.bytes -= bytes.byteLength + 1;
      this.completion.rows--;
      this.completion.allocation -= unsharedAllocation(record);
      if (this.completion.rows === 0) this.completion = undefined;
    }
    this.preparedAllocation = 0;
    this.ledgerLength += bytes.byteLength + 1;
    this.previousHash = sha256(bytes);
    this.nextSequence =
      sequence === Number.MAX_SAFE_INTEGER ? null : sequence + 1;
  }
  load(): void {
    const records: MixedRecord[] = [];
    let sequence: number | null = 0;
    let previousHash: string | null = null;
    let offset = 0;
    let fragments: Uint8Array[] = [];
    let pendingLength = 0;
    let result = nativeEffect(
      this.native.readLedger({ kind: "first", file: this.ledger }),
    );
    const totalLength = result.totalLength;
    if (totalLength === 0)
      refuse(
        "bootstrap-unclaimed",
        "Existing ledger has no durable initial claim.",
      );
    while (true) {
      const chunk = result.bytes;
      let start = 0;
      for (let index = 0; index < chunk.byteLength; index++) {
        if (chunk[index] !== 10) continue;
        const length = pendingLength + index - start;
        if (length >= maximumEventBytes)
          recover(
            "journal-recovery-required",
            "Ledger event including LF exceeds 8 MiB.",
          );
        const line =
          fragments.length === 0
            ? chunk.subarray(start, index)
            : Buffer.concat(
                [...fragments, chunk.subarray(start, index)],
                length,
              );
        let event: MixedEvent;
        try {
          event = parseBytes(line, validateMixedEvent);
        } catch {
          recover(
            "journal-recovery-required",
            "Ledger event is not strict supported JSON.",
          );
        }
        if (
          sequence === null ||
          event.sequence !== sequence ||
          event.previousEventByteSha256 !== previousHash ||
          !equalBytes(line, encodePublication(event))
        )
          recover(
            "journal-recovery-required",
            "Ledger sequence, chain or deterministic encoding differs.",
          );
        records.push(this.allocation().retain(event.record));
        this.allocation().addRow();
        previousHash = sha256(line);
        sequence = sequence === Number.MAX_SAFE_INTEGER ? null : sequence + 1;
        fragments = [];
        pendingLength = 0;
        start = index + 1;
      }
      const length = pendingLength + chunk.byteLength - start;
      if (length >= maximumEventBytes)
        recover(
          "journal-recovery-required",
          "Ledger unfinished event exceeds 8 MiB minus LF.",
        );
      if (start < chunk.byteLength) fragments.push(chunk.subarray(start));
      pendingLength = length;
      offset += chunk.byteLength;
      if (offset === totalLength) break;
      result = nativeEffect(
        this.native.readLedger({
          kind: "next",
          file: this.ledger,
          snapshot: result.snapshot,
          offset,
        }),
      );
    }
    if (pendingLength !== 0)
      recover("journal-recovery-required", "Ledger has an incomplete tail.");
    this.retainedRecords = records;
    this.nextSequence = sequence;
    this.previousHash = previousHash;
    this.ledgerLength = totalLength;
  }
  read(file: RegularHandle, exactLength?: number): Uint8Array {
    return nativeEffect(
      this.native.readBounded({
        file,
        maximumBytes: maximumFileBytes,
        ...(exactLength === undefined ? {} : { exactLength }),
      }),
    );
  }
  syncDirectory(directory: DirectoryHandle): void {
    nativeEffect(
      this.native.syncDirectory({ interval: this.mutating(), directory }),
      "durability-unavailable",
    );
  }
  openDirectory(
    parent: DirectoryHandle,
    name: string,
    claim?: PhysicalClaim,
  ): DirectoryHandle {
    if (claim) this.requireClaim(parent, name, claim);
    return this.keep(
      nativeValue(this.native.openDirectoryNoFollow(parent, this.name(name))),
    );
  }
  openFile(
    parent: DirectoryHandle,
    name: string,
    claim?: PhysicalClaim,
  ): RegularHandle {
    if (claim) this.requireClaim(parent, name, claim);
    return this.keep(
      nativeValue(
        this.native.openRegularNoFollow(
          parent,
          this.name(name),
          this.interval === null ? "read" : "read-write",
        ),
      ),
    );
  }
  directoryClaim(
    parent: DirectoryHandle,
    name: string,
  ): PhysicalClaim | undefined {
    const location = this.location(parent, name);
    for (const record of this.records()) {
      if (
        record.kind === "directory-claimed" &&
        sameLocation(record.directory.location, location)
      )
        return record.directory;
    }
    return undefined;
  }
  directory(
    parent: DirectoryHandle,
    name: string,
    requestId: string,
    attemptId: string,
  ): DirectoryHandle {
    const prior = this.directoryClaim(parent, name);
    if (prior) {
      const directory = this.openDirectory(parent, name, prior);
      this.syncDirectory(parent);
      return directory;
    }
    if (
      nativeValue(this.native.observeAt(parent, this.name(name))).kind !==
      "absent"
    )
      recover(
        "uncertain-claim",
        `Unclaimed directory ${name} is retained.`,
        requestId,
      );
    const directory = this.keep(
      nativeEffect(
        this.native.createDirectoryExclusive({
          interval: this.mutating(),
          parent,
          name: this.name(name),
        }),
      ),
    );
    const record: DirectoryClaim = {
      schemaVersion: 1,
      kind: "directory-claimed",
      requestId,
      attemptId,
      directory: this.claim(parent, name, directory),
    };
    this.append(record);
    this.syncDirectory(parent);
    return directory;
  }
  stage(input: StageInput): {
    handle: DirectoryHandle;
    claim: StageClaim;
    reservation: StageReservation;
  } {
    return this.stageObject(input, {
      create: (parent, name) =>
        nativeEffect(
          this.native.createDirectoryExclusive({
            interval: this.mutating(),
            parent,
            name: this.name(name),
          }),
        ),
      open: (parent, name, claim) => this.openDirectory(parent, name, claim),
    });
  }
  stagedRegular(input: Omit<StageInput, "purpose">): {
    handle: RegularHandle;
    claim: StageClaim;
    reservation: StageReservation;
  } {
    return this.stageObject(
      { ...input, purpose: "retained-input" },
      {
        create: (parent, name) =>
          nativeEffect(
            this.native.createRegularExclusive({
              interval: this.mutating(),
              parent,
              name: this.name(name),
            }),
          ),
        open: (parent, name, claim) => this.openFile(parent, name, claim),
      },
    );
  }
  private stageObject<T extends DirectoryHandle | RegularHandle>(
    input: StageInput,
    access: {
      create: (parent: DirectoryHandle, name: string) => T;
      open: (parent: DirectoryHandle, name: string, claim?: PhysicalClaim) => T;
    },
  ): { handle: T; claim: StageClaim; reservation: StageReservation } {
    const finalLocation = this.location(input.finalParent, input.finalName);
    const reservations = this.records().filter(
      (record): record is StageReservation =>
        record.kind === "stage-reserved" &&
        record.requestId === input.requestId &&
        record.purpose === input.purpose &&
        sameLocation(record.finalLocation, finalLocation),
    );
    for (const reservation of reservations) {
      if (
        this.records().some(
          (record) =>
            record.kind === "orphan-attempt" &&
            record.attemptId === reservation.attemptId,
        )
      )
        continue;
      const stage = this.records().find(
        (record): record is StageClaim =>
          record.kind === "stage-claimed" &&
          record.attemptId === reservation.attemptId,
      );
      const stageName = Buffer.from(
        reservation.stageLocation.rawNameBase64,
        "base64",
      ).toString("utf8");
      if (stage) {
        const final = nativeValue(
          this.native.observeAt(input.finalParent, this.name(input.finalName)),
        );
        if (final.kind === "present") {
          if (!sameObject(final.observation.object, stage.stage.object))
            refuse(
              "unowned-output",
              "Final stage name belongs to another physical object.",
            );
          return {
            handle: access.open(input.finalParent, input.finalName),
            claim: stage,
            reservation,
          };
        }
        return {
          handle: access.open(input.staging, stageName, stage.stage),
          claim: stage,
          reservation,
        };
      }
      const orphan = nativeValue(
        this.native.observeAt(input.staging, this.name(stageName)),
      );
      if (
        orphan.kind === "present" &&
        !this.records().some(
          (record) =>
            record.kind === "orphan-attempt" &&
            record.attemptId === reservation.attemptId,
        )
      )
        this.append({
          schemaVersion: 1,
          kind: "orphan-attempt",
          requestId: input.requestId,
          attemptId: reservation.attemptId,
          location: reservation.stageLocation,
          observedObject: orphan.observation.object,
          reason: "creation-without-durable-claim",
          disposition: "retained-unadmitted",
        });
    }
    if (
      nativeValue(
        this.native.observeAt(input.finalParent, this.name(input.finalName)),
      ).kind !== "absent"
    )
      refuse("unowned-output", "Final stage name is unclaimed.");
    const attemptId = randomUUID();
    const reservation: StageReservation = {
      schemaVersion: 1,
      kind: "stage-reserved",
      requestId: input.requestId,
      attemptId,
      purpose: input.purpose,
      stageLocation: this.location(input.staging, attemptId),
      finalLocation,
    };
    this.append(reservation);
    const handle = this.keep(access.create(input.staging, attemptId));
    const claim: StageClaim = {
      schemaVersion: 1,
      kind: "stage-claimed",
      requestId: input.requestId,
      attemptId,
      purpose: input.purpose,
      stage: this.claim(input.staging, attemptId, handle),
      finalLocation,
    };
    this.append(claim);
    this.syncDirectory(input.staging);
    return { handle, claim, reservation };
  }
  abandonStage(stage: StageClaim): void {
    if (
      !this.records().some(
        (record) =>
          record.kind === "orphan-attempt" &&
          record.attemptId === stage.attemptId,
      )
    )
      this.append({
        schemaVersion: 1,
        kind: "orphan-attempt",
        requestId: stage.requestId,
        attemptId: stage.attemptId,
        location: stage.stage.location,
        observedObject: stage.stage.object,
        reason: "creation-without-durable-claim",
        disposition: "retained-unadmitted",
      });
  }
  temporary(
    parent: DirectoryHandle,
    purpose: "head" | "receipt",
    requestId: string,
    bytes: FrozenBytes,
  ): PhysicalClaim {
    for (const reservation of this.records().filter(
      (record): record is TemporaryReservation =>
        record.kind === "temporary-reserved" &&
        record.requestId === requestId &&
        record.purpose === purpose,
    )) {
      if (
        this.records().some(
          (record) =>
            record.kind === "orphan-attempt" &&
            record.attemptId === reservation.attemptId,
        )
      )
        continue;
      const name = Buffer.from(
        reservation.location.rawNameBase64,
        "base64",
      ).toString("utf8");
      const claimed = this.records().some(
        (record) =>
          record.kind === "file-claimed" &&
          record.attemptId === reservation.attemptId,
      );
      const observed = nativeValue(
        this.native.observeAt(parent, this.name(name)),
      );
      if (!claimed && observed.kind === "present") {
        this.append({
          schemaVersion: 1,
          kind: "orphan-attempt",
          requestId,
          attemptId: reservation.attemptId,
          location: reservation.location,
          observedObject: observed.observation.object,
          reason: "creation-without-durable-claim",
          disposition: "retained-unadmitted",
        });
        continue;
      }
      return this.write(parent, name, {
        requestId,
        attemptId: reservation.attemptId,
        path: name,
        bytes: Buffer.from(bytes.bytesBase64, "base64"),
      });
    }
    const attemptId = randomUUID();
    const name = `${purpose}-${attemptId}`;
    this.append({
      schemaVersion: 1,
      kind: "temporary-reserved",
      requestId,
      attemptId,
      purpose,
      location: this.location(parent, name),
      planned: { byteLength: bytes.byteLength, byteSha256: bytes.byteSha256 },
    });
    return this.write(parent, name, {
      requestId,
      attemptId,
      path: name,
      bytes: Buffer.from(bytes.bytesBase64, "base64"),
    });
  }
  write(
    parent: DirectoryHandle,
    name: string,
    input: {
      requestId: string;
      attemptId: string;
      path: string;
      bytes: Uint8Array;
    },
  ): PhysicalClaim {
    requireFileBytes(input.bytes.byteLength);
    const location = this.location(parent, name);
    const prior = this.records().find(
      (record): record is FileClaim =>
        record.kind === "file-claimed" &&
        sameLocation(record.file.location, location),
    );
    let file: RegularHandle;
    let claim: PhysicalClaim;
    if (prior) {
      if (
        prior.planned.byteLength !== input.bytes.byteLength ||
        prior.planned.byteSha256 !== sha256(input.bytes)
      )
        refuse(
          "request-conflict",
          "Claimed file has a different frozen binding.",
        );
      claim = prior.file;
      file = this.openFile(parent, name, claim);
    } else {
      const staged = this.records().find(
        (record): record is StageClaim =>
          record.kind === "stage-claimed" &&
          record.purpose === "retained-input" &&
          record.stage.object.kind === "regular" &&
          sameLocation(record.stage.location, location),
      );
      if (staged) {
        claim = staged.stage;
        file = this.openFile(parent, name, claim);
      } else {
        if (
          nativeValue(this.native.observeAt(parent, this.name(name))).kind !==
          "absent"
        )
          recover(
            "uncertain-claim",
            `Unclaimed file ${name} is retained.`,
            input.requestId,
          );
        file = this.keep(
          nativeEffect(
            this.native.createRegularExclusive({
              interval: this.mutating(),
              parent,
              name: this.name(name),
            }),
          ),
        );
        claim = this.claim(parent, name, file);
      }
      this.append({
        schemaVersion: 1,
        kind: "file-claimed",
        requestId: input.requestId,
        attemptId: input.attemptId,
        path: input.path,
        file: claim,
        planned: {
          byteLength: input.bytes.byteLength,
          byteSha256: sha256(input.bytes),
        },
      });
    }
    this.requireClaim(parent, name, claim);
    nativeEffect(
      this.native.writeExact({
        interval: this.mutating(),
        file,
        bytes: input.bytes,
        expectedObject: claim.object,
      }),
    );
    nativeEffect(
      this.native.syncFile({ interval: this.mutating(), file }),
      "durability-unavailable",
    );
    if (!equalBytes(this.read(file, input.bytes.byteLength), input.bytes))
      recover(
        "uncertain-publication",
        "File readback differs.",
        input.requestId,
      );
    this.syncDirectory(parent);
    return claim;
  }
  promote(input: {
    requestId: string;
    attemptId: string;
    sourceParent: DirectoryHandle;
    sourceName: string;
    claim: PhysicalClaim;
    destinationParent: DirectoryHandle;
    destinationName: string;
  }): PhysicalClaim {
    const destination = this.location(
      input.destinationParent,
      input.destinationName,
    );
    const intent = this.records().find(
      (record) =>
        record.kind === "promotion-intent" &&
        record.attemptId === input.attemptId &&
        sameObject(record.source.object, input.claim.object) &&
        sameLocation(record.destination, destination),
    );
    if (!intent)
      this.append({
        schemaVersion: 1,
        kind: "promotion-intent",
        requestId: input.requestId,
        attemptId: input.attemptId,
        source: input.claim,
        destination,
        destinationExpectation: "absent",
      });
    this.guard();
    const current = nativeValue(
      this.native.observeAt(
        input.destinationParent,
        this.name(input.destinationName),
      ),
    );
    if (current.kind === "present") {
      if (
        !intent ||
        !sameObject(current.observation.object, input.claim.object)
      )
        refuse("unowned-output", "Foreign final object cannot be adopted.");
    } else {
      this.requireClaim(input.sourceParent, input.sourceName, input.claim);
      nativeEffect(
        this.native.promoteExclusive({
          interval: this.mutating(),
          sourceParent: input.sourceParent,
          sourceName: this.name(input.sourceName),
          destinationParent: input.destinationParent,
          destinationName: this.name(input.destinationName),
          expectedObject: input.claim.object,
        }),
      );
    }
    this.syncDirectory(input.sourceParent);
    this.syncDirectory(input.destinationParent);
    const observed = nativeValue(
      this.native.requireLocation({
        parent: input.destinationParent,
        name: this.name(input.destinationName),
        object: input.claim.object,
      }),
    );
    if (
      !this.records().some(
        (record) =>
          record.kind === "promotion-observed" &&
          record.attemptId === input.attemptId &&
          sameObject(record.object, input.claim.object),
      )
    )
      this.append({
        schemaVersion: 1,
        kind: "promotion-observed",
        requestId: input.requestId,
        attemptId: input.attemptId,
        object: observed.object,
        from: input.claim.location,
        to: destination,
      });
    return { ...observed, location: destination };
  }
  readClaimed(
    parent: DirectoryHandle,
    name: string,
    claim: PhysicalClaim,
    bytes: { byteLength: number; byteSha256: string },
  ): Uint8Array {
    const file = this.openFile(parent, name, claim);
    const actual = this.read(file, bytes.byteLength);
    if (sha256(actual) !== bytes.byteSha256)
      recover("uncertain-publication", "Claimed file bytes changed.");
    return actual;
  }
  close(): void {
    let failure: unknown;
    if (this.interval) {
      const result = this.native.expireAndDrain(this.interval);
      if (result.kind !== "ok") failure = result;
    }
    for (const handle of this.handles.reverse()) {
      const result = this.native.close(handle);
      if (result.kind !== "ok") failure ??= result;
    }
    const result = this.native.close(this.anchor.directory);
    if (result.kind !== "ok") failure ??= result;
    if (failure)
      recover(
        "uncertain-publication",
        "Native expiry, drain or handle close failed.",
      );
  }
}

export function openStore(
  store: PublicationStore,
  create: boolean,
  afterLoad?: (store: PublicationStore) => void,
  beforeSync?: (store: PublicationStore) => void,
): void {
  const native = store.native;
  const anchor = store.anchor.directory;
  const existing = nativeValue(
    native.observeAt(anchor, store.name(ledgerName)),
  );
  if (existing.kind === "absent") {
    if (!create)
      refuse("unknown-candidate", "Publication catalog does not exist.");
    if (
      nativeValue(native.observeAt(anchor, store.name(namespaceName))).kind !==
      "absent"
    )
      refuse("bootstrap-unclaimed", "Namespace exists without a ledger claim.");
    store.ledger = store.keep(
      nativeEffect(
        native.createRegularExclusive({
          interval: store.mutating(),
          parent: anchor,
          name: store.name(ledgerName),
        }),
      ),
    );
    store.ledgerClaim = store.claim(anchor, ledgerName, store.ledger);
    store.append({
      schemaVersion: 1,
      kind: "namespace-reserved",
      host: store.anchor.host,
      ledger: store.ledgerClaim,
      target: store.location(anchor, namespaceName),
      policy: "generated-publication/1",
    });
    store.syncDirectory(anchor);
  } else {
    store.ledger = store.openFile(anchor, ledgerName);
    store.load();
    const first = store.records()[0];
    if (
      first?.kind !== "namespace-reserved" ||
      digest(first.host) !== digest(store.anchor.host)
    )
      refuse("unsafe-namespace", "Ledger host or first reservation differs.");
    store.ledgerClaim = first.ledger;
    store.requireClaim(anchor, ledgerName, first.ledger);
    afterLoad?.(store);
  }
  const reservation = store.records()[0];
  if (reservation?.kind !== "namespace-reserved")
    recover("journal-recovery-required", "Missing namespace reservation.");
  const prior = store
    .records()
    .find(
      (record): record is NamespaceClaim => record.kind === "namespace-claimed",
    );
  if (prior) {
    if (
      prior.reservationDigest !== digest(reservation) ||
      digest(prior.ledger) !== digest(store.ledgerClaim)
    )
      refuse("unsafe-namespace", "Namespace claim binding differs.");
    store.namespaceClaim = prior;
    store.namespace = store.openDirectory(
      anchor,
      namespaceName,
      prior.namespace,
    );
  } else {
    if (!create)
      refuse("bootstrap-unclaimed", "Namespace bootstrap is pending.");
    if (
      nativeValue(native.observeAt(anchor, store.name(namespaceName))).kind !==
      "absent"
    )
      refuse(
        "bootstrap-unclaimed",
        "Namespace was created without its durable claim.",
      );
    store.namespace = store.keep(
      nativeEffect(
        native.createDirectoryExclusive({
          interval: store.mutating(),
          parent: anchor,
          name: store.name(namespaceName),
        }),
      ),
    );
    store.namespaceClaim = {
      schemaVersion: 1,
      kind: "namespace-claimed",
      host: store.anchor.host,
      ledger: store.ledgerClaim,
      namespace: store.claim(anchor, namespaceName, store.namespace),
      reservationDigest: digest(reservation),
    };
    store.append(store.namespaceClaim);
    store.syncDirectory(anchor);
  }
  store.guard();
  beforeSync?.(store);
  if (store.interval) {
    nativeEffect(
      native.syncFile({ interval: store.mutating(), file: store.ledger }),
      "durability-unavailable",
    );
    store.syncDirectory(anchor);
  }
}
