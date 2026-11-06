import { digest } from "./codec.js";
import { recover } from "./failure.js";
import type {
  OwnedBlob,
  SelectorMoveIntent,
} from "./generated/native-source-contract-1.js";
import type {
  FileClaim,
  Location,
  PromotionIntent,
} from "./generated/publication-contract-1.js";
import type { MixedRecord } from "./schema.js";
import { type PublicationStore, sameLocation, sameObject } from "./store.js";

export function requireNativeBlobLocation(
  store: PublicationStore,
  blob: OwnedBlob,
  options: { target?: Location; current?: boolean } = {},
  records: Iterable<MixedRecord> = store.mixedRecords(),
): FileClaim {
  let original: FileClaim | undefined;
  let current: Location | undefined;
  let recordedParent: Location["parent"] | undefined;
  let recorded = false;
  let reached = false;
  const promotions: PromotionIntent[] = [];
  const moves = new Map<string, SelectorMoveIntent>();
  const observe = () => {
    if (!current || !recordedParent) return;
    recorded ||= sameLocation(current, {
      parent: recordedParent,
      rawNameBase64: blob.claim.location.rawNameBase64,
    });
    reached ||=
      recorded &&
      (options.target === undefined || sameLocation(current, options.target));
  };
  for (const row of records) {
    if (
      (row.kind === "namespace-claimed" || row.kind === "directory-claimed") &&
      store.recordDigest(row) === blob.claim.location.parentClaimId
    ) {
      recordedParent =
        row.kind === "namespace-claimed"
          ? row.namespace.object
          : row.directory.object;
      observe();
    }
    if (
      row.kind === "file-claimed" &&
      store.recordDigest(row) === blob.claim.generatedClaimRecordDigest
    ) {
      original = row;
      current = row.file.location;
      observe();
    }
    if (!original || !current) continue;
    if (
      row.kind === "promotion-intent" &&
      sameObject(row.source.object, original.file.object)
    )
      promotions.push(row);
    if (
      row.kind === "native-selector-move-intent" &&
      row.generatedClaimRecordDigest === blob.claim.generatedClaimRecordDigest
    )
      moves.set(store.recordDigest(row), row);
    if (
      row.kind === "promotion-observed" &&
      sameObject(row.object, original.file.object)
    ) {
      const position = current;
      const file = original.file;
      const intent = promotions.find(
        (value) =>
          value.requestId === row.requestId &&
          value.attemptId === row.attemptId &&
          sameLocation(value.source.location, position) &&
          digest(value.source) === digest({ ...file, location: position }) &&
          sameLocation(value.source.location, row.from) &&
          sameLocation(value.destination, row.to),
      );
      if (!intent)
        recover(
          "journal-recovery-required",
          "Native blob relocation lacks its exact preceding generated intent.",
        );
      current = row.to;
      observe();
    }
    if (
      row.kind === "native-selector-move-observed" &&
      sameObject(row.object, original.file.object)
    ) {
      const intent = moves.get(row.moveIntentDigest);
      if (
        !intent ||
        digest(intent.scope) !== digest(row.scope) ||
        digest(intent.binding) !== digest(row.binding) ||
        intent.binding.claimId !== blob.claim.claimId ||
        !sameLocation(current, original.file.location)
      )
        recover(
          "journal-recovery-required",
          "Native selector move lacks its exact preceding source and intent.",
        );
      current = {
        parent: current.parent,
        rawNameBase64: intent.binding.location.rawNameBase64,
      };
      observe();
    }
  }
  if (
    !original ||
    !sameObject(original.file.object, blob.claim.object) ||
    String(original.planned.byteLength) !== blob.byteLength ||
    original.planned.byteSha256 !== blob.sha256 ||
    !recorded ||
    !reached ||
    (options.current &&
      (!current ||
        !recordedParent ||
        !sameLocation(current, {
          parent: recordedParent,
          rawNameBase64: blob.claim.location.rawNameBase64,
        })))
  )
    recover(
      "journal-recovery-required",
      "Native blob complete recorded location has no exact preceding observed ownership path.",
    );
  return original;
}
