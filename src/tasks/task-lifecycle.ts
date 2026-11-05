import type { TaskTargetIdentity } from "./types.js";

export type TaskLifecycleTarget = Pick<TaskTargetIdentity, "kind" | "key">;
export interface TaskProviderIdentity {
  listId: string;
  taskId: string;
}
export interface VerifiedTaskProviderAlias {
  identity: TaskProviderIdentity;
  verifiedAt: string;
  evidenceRef: string;
}
export interface TaskProviderBinding {
  canonical: TaskProviderIdentity;
  aliases: VerifiedTaskProviderAlias[];
}
export interface TaskSourceOccurrence {
  target: TaskLifecycleTarget;
  occurrenceId: string;
  source: { kind: string; id: string };
}
export interface TaskLifecycleEntry extends TaskSourceOccurrence {
  disposition: "active" | "owner-dismissed" | "completed";
  recordedAt: string;
  evidenceRef: string;
  providers: TaskProviderBinding[];
}
export interface TaskLifecycleState {
  schemaVersion: 1;
  revision: number;
  entries: TaskLifecycleEntry[];
}
export type TaskLifecycleDecision =
  | { allowed: true }
  | { allowed: false; reason: "owner-dismissed" | "completed" };

export function emptyTaskLifecycleState(): TaskLifecycleState {
  return { schemaVersion: 1, revision: 0, entries: [] };
}

export function taskOccurrenceKey(
  occurrence: Pick<TaskSourceOccurrence, "target" | "occurrenceId">,
): string {
  target(occurrence.target);
  text(occurrence.occurrenceId);
  return JSON.stringify([
    occurrence.target.kind,
    occurrence.target.key,
    occurrence.occurrenceId,
  ]);
}

export function sameTaskProviderIdentity(
  left: TaskProviderIdentity,
  right: TaskProviderIdentity,
): boolean {
  return left.listId === right.listId && left.taskId === right.taskId;
}

export function taskLifecycleDecision(
  state: TaskLifecycleState,
  occurrence: Pick<TaskSourceOccurrence, "target" | "occurrenceId"> & {
    provider?: TaskProviderIdentity;
  },
): TaskLifecycleDecision {
  const checked = parseTaskLifecycleState(state);
  const key = taskOccurrenceKey(occurrence);
  const suppliedProvider = occurrence.provider;
  if (suppliedProvider) provider(suppliedProvider);
  const matching = checked.entries.filter(
    (entry) =>
      taskOccurrenceKey(entry) === key ||
      (entry.target.kind === occurrence.target.kind &&
        entry.target.key === occurrence.target.key &&
        suppliedProvider !== undefined &&
        entry.providers.some((binding) =>
          [
            binding.canonical,
            ...binding.aliases.map((alias) => alias.identity),
          ].some((identity) =>
            sameTaskProviderIdentity(identity, suppliedProvider),
          ),
        )),
  );
  const terminal =
    matching.find((entry) => entry.disposition === "owner-dismissed") ??
    matching.find((entry) => entry.disposition === "completed");
  if (!terminal || terminal.disposition === "active") return { allowed: true };
  return { allowed: false, reason: terminal.disposition };
}

export function recordTaskLifecycle(
  state: TaskLifecycleState,
  entry: TaskLifecycleEntry,
): TaskLifecycleState {
  const checked = parseTaskLifecycleState(state);
  const incoming = parseEntry(entry);
  const key = taskOccurrenceKey(incoming);
  const previous = checked.entries.find(
    (item) => taskOccurrenceKey(item) === key,
  );
  if (previous) {
    if (
      previous.source.kind !== incoming.source.kind ||
      previous.source.id !== incoming.source.id
    )
      throw new Error(
        "A stable Task occurrence cannot change its source identity.",
      );
    if (
      previous.disposition !== "active" &&
      previous.disposition !== incoming.disposition
    )
      throw new Error(
        "A terminal Task occurrence cannot be reopened or replaced.",
      );
    if (
      previous.disposition !== "active" &&
      (previous.recordedAt !== incoming.recordedAt ||
        previous.evidenceRef !== incoming.evidenceRef)
    )
      throw new Error(
        "A terminal Task occurrence must retain its original disposition evidence.",
      );
    if (Date.parse(incoming.recordedAt) < Date.parse(previous.recordedAt))
      throw new Error("Task lifecycle evidence cannot move backwards.");
    for (const binding of previous.providers) {
      const retained = incoming.providers.find((candidate) =>
        sameTaskProviderIdentity(candidate.canonical, binding.canonical),
      );
      if (
        !retained ||
        binding.aliases.some(
          (alias) =>
            !retained.aliases.some(
              (candidate) =>
                sameTaskProviderIdentity(candidate.identity, alias.identity) &&
                candidate.verifiedAt === alias.verifiedAt &&
                candidate.evidenceRef === alias.evidenceRef,
            ),
        )
      )
        throw new Error(
          "Task lifecycle updates must retain exact provider identity evidence.",
        );
    }
    if (JSON.stringify(previous) === JSON.stringify(incoming)) return checked;
  }
  return parseTaskLifecycleState({
    schemaVersion: 1,
    revision: checked.revision + 1,
    entries: [
      ...checked.entries.filter((item) => taskOccurrenceKey(item) !== key),
      incoming,
    ],
  });
}

export function parseTaskLifecycleState(value: unknown): TaskLifecycleState {
  const state = record(value, ["schemaVersion", "revision", "entries"]);
  if (
    state.schemaVersion !== 1 ||
    !Number.isSafeInteger(state.revision) ||
    (state.revision as number) < 0 ||
    !Array.isArray(state.entries)
  )
    throw new Error("Unsupported or invalid Task lifecycle state.");
  const entries = state.entries.map(parseEntry);
  const keys = new Set<string>();
  const identities = new Map<string, string>();
  for (const entry of entries) {
    const key = taskOccurrenceKey(entry);
    if (keys.has(key)) throw new Error("Duplicate Task lifecycle occurrence.");
    keys.add(key);
    for (const binding of entry.providers) {
      for (const identity of [
        binding.canonical,
        ...binding.aliases.map((alias) => alias.identity),
      ]) {
        const providerKey = JSON.stringify([
          entry.target.kind,
          entry.target.key,
          identity.listId,
          identity.taskId,
        ]);
        if (identities.has(providerKey))
          throw new Error("Ambiguous or duplicate Task provider identity.");
        identities.set(providerKey, key);
      }
    }
  }
  return { schemaVersion: 1, revision: state.revision as number, entries };
}

function parseEntry(value: unknown): TaskLifecycleEntry {
  const entry = record(value, [
    "target",
    "occurrenceId",
    "source",
    "disposition",
    "recordedAt",
    "evidenceRef",
    "providers",
  ]);
  const source = record(entry.source, ["kind", "id"]);
  if (
    !["active", "owner-dismissed", "completed"].includes(
      entry.disposition as string,
    ) ||
    !Array.isArray(entry.providers)
  )
    throw new Error("Invalid Task lifecycle entry.");
  return {
    target: target(entry.target),
    occurrenceId: text(entry.occurrenceId),
    source: { kind: text(source.kind), id: text(source.id) },
    disposition: entry.disposition as TaskLifecycleEntry["disposition"],
    recordedAt: instant(entry.recordedAt),
    evidenceRef: text(entry.evidenceRef),
    providers: entry.providers.map((value) => {
      const binding = record(value, ["canonical", "aliases"]);
      if (!Array.isArray(binding.aliases))
        throw new Error("Invalid Task identity aliases.");
      return {
        canonical: provider(binding.canonical),
        aliases: binding.aliases.map((value) => {
          const alias = record(value, [
            "identity",
            "verifiedAt",
            "evidenceRef",
          ]);
          return {
            identity: provider(alias.identity),
            verifiedAt: instant(alias.verifiedAt),
            evidenceRef: text(alias.evidenceRef),
          };
        }),
      };
    }),
  };
}

function target(value: unknown): TaskLifecycleTarget {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid Task target.");
  const item = value as Record<string, unknown>;
  if (item.kind !== "module" && item.kind !== "research-project")
    throw new Error("Invalid Task target kind.");
  return { kind: item.kind, key: text(item.key) };
}
function provider(value: unknown): TaskProviderIdentity {
  const item = record(value, ["listId", "taskId"]);
  return { listId: text(item.listId), taskId: text(item.taskId) };
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error("Invalid Task lifecycle evidence shape.");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0"))
    throw new Error(
      "Task identity and evidence must be explicit nonempty strings.",
    );
  return value;
}
function instant(value: unknown): string {
  const result = text(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      result,
    ) ||
    !Number.isFinite(Date.parse(result))
  )
    throw new Error("Task lifecycle timestamps must be explicit instants.");
  if (
    new Date(`${result.slice(0, 19)}Z`).toISOString().slice(0, 19) !==
    result.slice(0, 19)
  )
    throw new Error("Task lifecycle timestamps must use valid calendar dates.");
  return result;
}
