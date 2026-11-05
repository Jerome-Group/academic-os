import type { Artifact, NativeEntry } from "./generated/module-data-1.js";

type Problem = (code: string, pointer: string, message: string) => void;

export function validateNativeRepresentations(
  artifacts: readonly Artifact[],
  problem: Problem,
): void {
  const hardlinks = new Map<
    string,
    Map<string, { value: string; pointer: string }>
  >();
  const membership = new Map(
    artifacts.map((artifact, index) => [
      artifact.id,
      { artifact, pointer: `/artifacts/${index}/representation` },
    ]),
  );
  for (const [index, artifact] of artifacts.entries()) {
    const representation = artifact.representation;
    const pointer = `/artifacts/${index}/representation`;
    const entries = representation.entries.map((entry) => ({
      entry,
      raw: Buffer.from(entry.pathBytesBase64, "base64").toString("latin1"),
    }));
    const roots = entries.filter((root) =>
      entries.every(
        (item) => item.raw === root.raw || item.raw.startsWith(`${root.raw}/`),
      ),
    );
    const root = roots[0];
    const directory =
      representation.kind === "directory" ||
      representation.kind === "native-bundle";
    if (
      roots.length !== 1 ||
      root?.entry.kind !== (directory ? "directory" : representation.kind) ||
      (!directory && entries.length !== 1)
    )
      problem(
        "conflicting-native-representation-root",
        pointer,
        "Include one coherent raw-path root. Directory and native-bundle roots must be directories containing all entries; file, symlink and special representations require one matching entry.",
      );
    if (!directory && representation.bundleMembers.length)
      problem(
        "invalid-native-bundle-membership",
        `${pointer}/bundleMembers`,
        "Only directory and native-bundle representations can contain artifact members.",
      );
    const paths = new Map(entries.map((item) => [item.raw, item.entry]));
    for (const [offset, { entry, raw }] of entries.entries()) {
      const entryPointer = `${pointer}/entries/${offset}`;
      if (
        raw !== root?.raw &&
        paths.get(raw.slice(0, raw.lastIndexOf("/")))?.kind !== "directory"
      )
        problem(
          "invalid-native-entry-parent",
          `${entryPointer}/pathBytesBase64`,
          "Every nonroot entry requires an included directory at its immediate raw-path parent. Native representations never descend through files, symlinks or special entries.",
        );
      if (entry.xattrs.kind === "known") {
        const names = new Set<string>();
        for (const [
          attributeIndex,
          attribute,
        ] of entry.xattrs.entries.entries()) {
          if (names.has(attribute.nameBytesBase64))
            problem(
              "duplicate-native-xattr-name",
              `${entryPointer}/xattrs/entries/${attributeIndex}/nameBytesBase64`,
              "Each raw xattr name identifies one value within a native entry.",
            );
          names.add(attribute.nameBytesBase64);
        }
      }
      if (entry.hardlinkGroup.kind !== "known") continue;
      const group = entry.hardlinkGroup.value;
      let facts = hardlinks.get(group);
      if (facts === undefined) {
        facts = new Map();
        hardlinks.set(group, facts);
      }
      for (const [field, value] of inodeFacts(entry)) {
        const previous = facts.get(field);
        if (previous !== undefined && previous.value !== value)
          problem(
            "conflicting-native-hardlink",
            `${entryPointer}/${field}`,
            `Known hardlink group ${group} has conflicting ${field} at ${previous.pointer} and ${entryPointer}/${field}. Unknown and disputed claims do not establish a conflicting value.`,
          );
        else facts.set(field, { value, pointer: `${entryPointer}/${field}` });
      }
    }
  }
  const completed = new Set<string>();
  for (const id of membership.keys()) {
    const active = new Set<string>();
    const stack = [{ id, exit: false }];
    while (stack.length) {
      const next = stack.pop();
      if (next === undefined) break;
      if (next.exit) {
        active.delete(next.id);
        completed.add(next.id);
        continue;
      }
      const current = membership.get(next.id);
      if (active.has(next.id)) {
        problem(
          "native-bundle-cycle",
          `${current?.pointer ?? ""}/bundleMembers`,
          `Native containment cycle reaches ${next.id}.`,
        );
        continue;
      }
      if (completed.has(next.id)) continue;
      active.add(next.id);
      stack.push({ id: next.id, exit: true });
      for (const member of current?.artifact.representation.bundleMembers ?? [])
        stack.push({ id: member.id, exit: false });
    }
  }
}

function inodeFacts(entry: NativeEntry): Map<string, string> {
  const facts = new Map<string, string>([["kind", entry.kind]]);
  for (const field of [
    "data",
    "mode",
    "flags",
    "mtimeNanoseconds",
    "birthtimeNanoseconds",
    "acl",
    "symlinkTargetBytesBase64",
    "specialType",
  ] as const) {
    const claim = entry[field];
    if (claim?.kind === "known") facts.set(field, JSON.stringify(claim.value));
  }
  if (entry.xattrs.kind === "known")
    facts.set(
      "xattrs",
      JSON.stringify(
        [...entry.xattrs.entries]
          .sort((left, right) =>
            left.nameBytesBase64 < right.nameBytesBase64
              ? -1
              : left.nameBytesBase64 > right.nameBytesBase64
                ? 1
                : 0,
          )
          .map((attribute) => [
            attribute.nameBytesBase64,
            attribute.valueSha256,
            attribute.byteLength,
          ]),
      ),
    );
  if (entry.resourceFork.kind === "absent") facts.set("resourceFork", "absent");
  else if (entry.resourceFork.kind === "present")
    facts.set(
      "resourceFork",
      JSON.stringify([
        entry.resourceFork.byteSha256,
        entry.resourceFork.byteLength,
      ]),
    );
  return facts;
}
