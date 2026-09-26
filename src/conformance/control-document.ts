import { isAlias, isScalar, parseDocument, visit } from "yaml";

export function readControlDocument(
  source: string,
): { problems: string[] } | { value: unknown } {
  try {
    const document = parseDocument(source, {
      prettyErrors: false,
      uniqueKeys: true,
    });
    const problems = document.errors.map(({ message }) => yamlProblem(message));
    visit(document, {
      Pair(_key, pair) {
        const key = isAlias(pair.key) ? pair.key.resolve(document) : pair.key;
        if (!isScalar(key)) {
          problems.push("YAML mapping keys must be scalar values.");
        }
      },
    });
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
    for (const child of Object.values(object)) {
      pending.push({ value: child, exiting: false });
    }
  }
  return false;
}
