import { randomUUID } from "node:crypto";
import { digest, encodePublication, equalBytes, sha256 } from "./codec.js";
import { recover, refuse } from "./failure.js";
import type {
  DirectoryClaim,
  FileClaim,
  FrozenBytes,
  JournalEvent,
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
import { parseBytes, validateEvent } from "./schema.js";

export const ledgerName = "academic-os-control-publication.jsonl";
export const namespaceName = "academic-os-control-publication";
const maximumLedgerBytes = 8 * 1024 * 1024;

export function nativeValue<T>(result: NativeResult<T>): T {
  if (result.kind === "ok") return result.value;
  if (result.code === "unsupported-host")
    refuse("unsupported-host", result.operation);
  if (result.code === "exists") refuse("unowned-output", result.operation);
  if (result.code === "expired")
    recover("uncertain-publication", result.operation);
  refuse("unsafe-namespace", `${result.operation}: ${result.code}`);
}

export function sameObject(a: ObjectIdentity, b: ObjectIdentity): boolean {
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
  readonly events: JournalEvent[] = [];
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
    return this.interval;
  }
  records(): PublicationRecord[] {
    return this.events.map((event) => event.record);
  }
  requireCapacity(additionalBytes: number): void {
    if (
      !Number.isSafeInteger(additionalBytes) ||
      additionalBytes < 0 ||
      this.ledgerLength + additionalBytes > maximumLedgerBytes
    )
      recover(
        "durability-unavailable",
        "The bounded publication ledger lacks capacity. No new event was appended.",
      );
  }
  append(record: PublicationRecord): void {
    const event: JournalEvent = {
      schemaVersion: 1,
      sequence: this.events.length,
      previousEventByteSha256: this.previousHash,
      record,
    };
    const bytes = encodePublication(event);
    parseBytes(bytes, validateEvent);
    this.requireCapacity(bytes.byteLength + 1);
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
    this.events.push(event);
    this.ledgerLength += bytes.byteLength + 1;
    this.previousHash = sha256(bytes);
  }
  load(bytes: Uint8Array): void {
    if (bytes.byteLength === 0)
      refuse(
        "bootstrap-unclaimed",
        "Existing ledger has no durable initial claim.",
      );
    if (bytes[bytes.byteLength - 1] !== 10)
      recover("journal-recovery-required", "Ledger has an incomplete tail.");
    let offset = 0;
    for (let index = 0; index < bytes.length; index++) {
      if (bytes[index] !== 10) continue;
      const line = bytes.slice(offset, index);
      let event: JournalEvent;
      try {
        event = parseBytes(line, validateEvent);
      } catch {
        recover(
          "journal-recovery-required",
          "Ledger event is not strict supported JSON.",
        );
      }
      if (
        event.sequence !== this.events.length ||
        event.previousEventByteSha256 !== this.previousHash ||
        !equalBytes(line, encodePublication(event))
      )
        recover(
          "journal-recovery-required",
          "Ledger sequence, chain or deterministic encoding differs.",
        );
      this.events.push(event);
      this.previousHash = sha256(line);
      offset = index + 1;
    }
    this.ledgerLength = bytes.byteLength;
  }
  read(file: RegularHandle, exactLength?: number): Uint8Array {
    return nativeEffect(
      this.native.readBounded({
        file,
        maximumBytes: maximumLedgerBytes,
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
    if (prior) return this.openDirectory(parent, name, prior);
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

export function openStore(store: PublicationStore, create: boolean): void {
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
    store.load(store.read(store.ledger));
    const first = store.events[0]?.record;
    if (
      first?.kind !== "namespace-reserved" ||
      digest(first.host) !== digest(store.anchor.host)
    )
      refuse("unsafe-namespace", "Ledger host or first reservation differs.");
    store.ledgerClaim = first.ledger;
    store.requireClaim(anchor, ledgerName, first.ledger);
    if (store.interval)
      nativeEffect(
        native.syncFile({ interval: store.interval, file: store.ledger }),
        "durability-unavailable",
      );
  }
  const reservation = store.events[0]?.record;
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
}
