import {
  isAlias,
  isPair,
  isScalar,
  parseDocument,
  type Pair,
  type Scalar,
  visit,
  YAMLMap,
} from "yaml";

type ControlDocument = ReturnType<typeof parseDocument>;
type MappingKey =
  | { kind: "merge"; pair: Pair }
  | { kind: "entry"; nativeKey: unknown; propertyKey: string };

export function readControlDocument(
  source: string,
): { problems: string[] } | { value: unknown } {
  try {
    const document = parseDocument(source, {
      prettyErrors: false,
      uniqueKeys: true,
    });
    const problems = document.errors.map(({ message }) => yamlProblem(message));
    const resolvedKeys = new Map<Pair, Scalar>();
    const mappings: YAMLMap[] = [];
    const orderedMaps: Pair[][] = [];
    visit(document, {
      Pair(_key, pair) {
        const key = isAlias(pair.key) ? pair.key.resolve(document) : pair.key;
        if (!isScalar(key)) {
          problems.push("YAML mapping keys must be scalar values.");
        } else resolvedKeys.set(pair, key);
      },
      Map(_key, map) {
        mappings.push(map);
      },
      Seq(_key, sequence) {
        if (sequence.tag === "tag:yaml.org,2002:omap")
          orderedMaps.push(sequence.items.filter(isPair));
      },
    });
    if (problems.length > 0) return { problems };
    const mappingKeys = mappings.map((map) => ({
      map,
      keys: declaredMappingKeys(map.items, resolvedKeys, document.schema),
    }));
    for (const { map, keys } of mappingKeys) {
      problems.push(
        ...declaredKeyProblems(keys, map.tag !== "tag:yaml.org,2002:set"),
      );
    }
    for (const pairs of orderedMaps)
      problems.push(
        ...declaredKeyProblems(
          declaredMappingKeys(pairs, resolvedKeys, undefined),
          false,
        ),
      );
    if (problems.length > 0) return { problems };
    for (const { map, keys } of mappingKeys) {
      if (
        map.tag !== "tag:yaml.org,2002:set" &&
        keys.some(({ kind }) => kind === "merge")
      )
        problems.push(...mergedKeyProblems(keys, document));
    }
    if (problems.length > 0) return { problems };
    const value: unknown = document.toJS();
    if (hasCircularValues(value)) {
      return { problems: ["YAML controls must not contain circular values."] };
    }
    return { value };
  } catch (error) {
    return {
      problems: [
        yamlProblem(error instanceof Error ? error.message : String(error)),
      ],
    };
  }
}

function declaredMappingKeys(
  pairs: readonly Pair[],
  resolvedKeys: ReadonlyMap<Pair, Scalar>,
  mergeSchema: ControlDocument["schema"] | undefined,
): MappingKey[] {
  return pairs.flatMap((pair): MappingKey[] => {
    if (mergeSchema && isMergeInstruction(pair.key, mergeSchema))
      return [{ kind: "merge", pair }];
    const key = resolvedKeys.get(pair);
    if (key === undefined) return [];
    const nativeKey: unknown = key.value;
    const propertyKey =
      nativeKey === null
        ? ""
        : typeof nativeKey === "object"
          ? String(pair.key)
          : String(nativeKey);
    return [{ kind: "entry", nativeKey, propertyKey }];
  });
}

function isMergeInstruction(
  key: Pair["key"],
  schema: ControlDocument["schema"],
): boolean {
  return (
    isScalar(key) &&
    (Boolean(key.addToJSMap) ||
      ((!key.type || key.type === "PLAIN") &&
        (key.value === "<<" ||
          (typeof key.value === "symbol" && key.value.description === "<<")) &&
        schema.tags.some(
          (tag) => tag.tag === "tag:yaml.org,2002:merge" && tag.default,
        )))
  );
}

function declaredKeyProblems(
  keys: readonly MappingKey[],
  objectProperties: boolean,
): string[] {
  const nativeKeys = new Set<unknown>();
  const propertyKeys = new Set<string>();
  for (const key of keys) {
    if (key.kind === "merge") continue;
    if (nativeKeys.has(key.nativeKey))
      return ["YAML mapping keys must retain distinct native identities."];
    nativeKeys.add(key.nativeKey);
    if (objectProperties && propertyKeys.has(key.propertyKey))
      return [
        `YAML mapping keys normalize to the same property ${JSON.stringify(key.propertyKey)}.`,
      ];
    propertyKeys.add(key.propertyKey);
  }
  return [];
}

function mergedKeyProblems(
  keys: readonly MappingKey[],
  document: ControlDocument,
): string[] {
  const nativeKeys = new Set<unknown>();
  const propertyOrigins = new Map<string, unknown>();
  for (const key of keys) {
    if (key.kind === "entry") {
      nativeKeys.add(key.nativeKey);
      propertyOrigins.set(key.propertyKey, key.nativeKey);
      continue;
    }
    const projection = new YAMLMap(document.schema);
    projection.items = [key.pair];
    const merged: unknown = projection.toJS(document, { mapAsMap: true });
    if (!(merged instanceof Map))
      throw new Error("YAML merge did not produce a mapping.");
    for (const nativeKey of merged.keys()) {
      if (typeof nativeKey === "symbol")
        return [
          "YAML mapping keys must not create symbol properties through merging.",
        ];
      nativeKeys.add(nativeKey);
      const propertyKey = String(nativeKey);
      if (!propertyOrigins.has(propertyKey))
        propertyOrigins.set(propertyKey, nativeKey);
    }
  }
  const survivingKeys = new Set(propertyOrigins.values());
  return [...nativeKeys].every((key) => survivingKeys.has(key))
    ? []
    : ["YAML mapping keys normalize to the same property after merging."];
}

function yamlProblem(message: string): string {
  return `YAML parser reported: ${message.replace(/\s+/gu, " ").trim()}`;
}

function hasCircularValues(value: unknown): boolean {
  const ancestors = new WeakSet<object>();
  const completed = new WeakSet<object>();
  const pending: Array<{ value: unknown; exiting: boolean }> = [
    { value, exiting: false },
  ];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (
      entry === undefined ||
      typeof entry.value !== "object" ||
      entry.value === null
    )
      continue;
    const object = entry.value;
    if (entry.exiting) {
      ancestors.delete(object);
      completed.add(object);
      continue;
    }
    if (ancestors.has(object)) return true;
    if (completed.has(object)) continue;
    ancestors.add(object);
    pending.push({ value: object, exiting: true });
    const children =
      object instanceof Map
        ? [...object.keys(), ...object.values()]
        : object instanceof Set
          ? object.values()
          : Object.values(object);
    for (const child of children) {
      pending.push({ value: child, exiting: false });
    }
  }
  return false;
}
