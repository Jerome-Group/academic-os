import { createHash } from "node:crypto";
import {
  sameTaskProviderIdentity,
  type TaskProviderBinding,
  type TaskProviderIdentity,
} from "./task-lifecycle.js";

export interface NativeTaskInterval {
  start: string;
  end: string;
}
export interface NativeTaskTimingEvidence {
  identity: TaskProviderBinding;
  timing: NativeTaskInterval | null;
  ownership: { kind: "manual" } | { kind: "managed"; owner: string };
  evidence: {
    surface: "native-task-editor";
    verifiedAt: string;
    reference: string;
  };
}
export type NativeTaskTimingObservation =
  | { schemaVersion: 1; status: "unsupported"; reason: string }
  | {
      schemaVersion: 1;
      status: "observed";
      observedAt: string;
      timeZone: string;
      horizon: NativeTaskInterval;
      complete: { tasks: true; busy: true; meals: true; protected: true };
      tasks: NativeTaskTimingEvidence[];
      protectedIntervals: (NativeTaskInterval & {
        id: string;
        kind: "busy" | "meal" | "protected";
      })[];
    };
export interface NativeTaskTimingPlan {
  schemaVersion: 1;
  planId: string;
  policyVersion: string;
  owner: string;
  observationDigest: string;
  timeZone: string;
  placements: (NativeTaskInterval & {
    identity: TaskProviderIdentity;
    estimatedMinutes: number;
  })[];
  availability: {
    dated: { date: string; windows: NativeTaskTimeWindow[] }[];
    weekly: { weekday: number; windows: NativeTaskTimeWindow[] }[];
  };
}
export interface NativeTaskTimeWindow {
  startMinute: number;
  endMinute: number;
}
export type NativeTaskTimingValidation =
  | {
      outcome: "accepted";
      plan: NativeTaskTimingPlan;
      observationDigest: string;
    }
  | {
      outcome: "refused";
      code:
        | "unsupported"
        | "invalid-evidence"
        | "stale-evidence"
        | "changed-observation"
        | "invalid-plan"
        | "manual-placement"
        | "conflict";
      reason: string;
    };

export function unsupportedNativeTaskTimingObservation(
  reason: string,
): NativeTaskTimingObservation {
  nonempty(reason);
  return { schemaVersion: 1, status: "unsupported", reason };
}

export function nativeTaskTimingObservationDigest(
  observation: NativeTaskTimingObservation,
): string {
  requireObservation(observation);
  return createHash("sha256").update(canonicalJson(observation)).digest("hex");
}

export function roundedNativeTaskMinutes(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0)
    refuse("invalid-plan", "Task duration must be a positive estimate.");
  return Math.ceil(minutes / 30) * 30;
}

export function parseNativeTaskTimingPlan(
  value: unknown,
): NativeTaskTimingPlan {
  const plan = value as NativeTaskTimingPlan;
  requirePlan(plan);
  return structuredClone(plan);
}

export function validateNativeTaskTimingPlan(input: {
  plan: NativeTaskTimingPlan;
  observation: NativeTaskTimingObservation;
  now: string;
  maxObservationAgeMs: number;
}): NativeTaskTimingValidation {
  try {
    const observation = input.observation;
    requireObservation(observation);
    if (observation.status === "unsupported")
      refuse("unsupported", observation.reason);
    const now = instant(input.now);
    if (
      !Number.isFinite(input.maxObservationAgeMs) ||
      input.maxObservationAgeMs < 0
    )
      refuse(
        "invalid-evidence",
        "Timing freshness policy is missing or invalid.",
      );
    requireFresh(observation.observedAt, now, input.maxObservationAgeMs);
    for (const task of observation.tasks) {
      requireFresh(task.evidence.verifiedAt, now, input.maxObservationAgeMs);
      if (instant(task.evidence.verifiedAt) > instant(observation.observedAt))
        refuse(
          "invalid-evidence",
          "Task evidence is newer than its observation snapshot.",
        );
      for (const alias of task.identity.aliases) {
        if (instant(alias.verifiedAt) > instant(observation.observedAt))
          refuse(
            "invalid-evidence",
            "Task identity alias is newer than its observation snapshot.",
          );
      }
    }
    const plan = input.plan;
    requirePlan(plan);
    const digest = nativeTaskTimingObservationDigest(observation);
    if (plan.observationDigest !== digest)
      refuse(
        "changed-observation",
        "Native timing observation changed after the plan was made.",
      );
    if (plan.timeZone !== observation.timeZone)
      refuse(
        "invalid-plan",
        "Plan and native evidence must use the same explicit timezone.",
      );
    validatePlacements(plan, observation);
    return {
      outcome: "accepted",
      plan: structuredClone(plan),
      observationDigest: digest,
    };
  } catch (error) {
    if (error instanceof TimingRefusal)
      return { outcome: "refused", code: error.code, reason: error.message };
    return {
      outcome: "refused",
      code: "invalid-evidence",
      reason:
        error instanceof Error
          ? error.message
          : "Invalid native timing evidence.",
    };
  }
}

function validatePlacements(
  plan: NativeTaskTimingPlan,
  observation: Extract<NativeTaskTimingObservation, { status: "observed" }>,
): void {
  const selected = new Set<NativeTaskTimingEvidence>();
  const placements = plan.placements.map((placement) => {
    const task = observation.tasks.find((candidate) =>
      identities(candidate.identity).some((identity) =>
        sameTaskProviderIdentity(identity, placement.identity),
      ),
    );
    if (!task)
      refuse(
        "invalid-evidence",
        "A planned Task has no exact verified native identity.",
      );
    if (selected.has(task))
      refuse(
        "conflict",
        "A Task has duplicate placements, including through an alias.",
      );
    selected.add(task);
    const unchanged =
      task.timing !== null &&
      instant(task.timing.start) === instant(placement.start) &&
      instant(task.timing.end) === instant(placement.end);
    if (
      task.timing !== null &&
      !unchanged &&
      (task.ownership.kind === "manual" || task.ownership.owner !== plan.owner)
    )
      refuse(
        "manual-placement",
        "An existing manual or differently owned Task placement is protected.",
      );
    if (
      instant(placement.start) < instant(observation.horizon.start) ||
      instant(placement.end) > instant(observation.horizon.end)
    )
      refuse(
        "invalid-evidence",
        "A placement lies outside the completely observed horizon.",
      );
    if (
      (instant(placement.end) - instant(placement.start)) / 60_000 !==
      roundedNativeTaskMinutes(placement.estimatedMinutes)
    )
      refuse(
        "invalid-plan",
        "Task duration must round its estimate up to a 30-minute increment.",
      );
    const start = localParts(placement.start, plan.timeZone);
    const end = localParts(placement.end, plan.timeZone);
    if (
      start.second !== 0 ||
      end.second !== 0 ||
      start.minute % 30 !== 0 ||
      end.minute % 30 !== 0
    )
      refuse(
        "invalid-plan",
        "Native Task start and end must align to 30-minute boundaries.",
      );
    if (start.date !== end.date || end.minute <= start.minute)
      refuse(
        "invalid-plan",
        "This timing contract supports same-day nonambiguous local placements only.",
      );
    const dated = plan.availability.dated.find(
      (rule) => rule.date === start.date,
    );
    const windows = dated
      ? dated.windows
      : plan.availability.weekly.find((rule) => rule.weekday === start.weekday)
          ?.windows;
    if (
      !windows?.some(
        (window) =>
          start.minute >= window.startMinute && end.minute <= window.endMinute,
      )
    )
      refuse(
        "conflict",
        "Placement violates dated availability or its weekly fallback.",
      );
    return { ...placement, task };
  });
  for (const [index, placement] of placements.entries()) {
    if (
      observation.protectedIntervals.some((interval) =>
        overlaps(placement, interval),
      )
    )
      refuse(
        "conflict",
        "Placement overlaps Busy, a meal or a protected interval.",
      );
    if (
      observation.tasks.some(
        (task) =>
          !selected.has(task) &&
          task.timing !== null &&
          overlaps(placement, task.timing),
      )
    )
      refuse("conflict", "Placement overlaps another observed Task.");
    if (placements.slice(index + 1).some((other) => overlaps(placement, other)))
      refuse("conflict", "Planned Tasks overlap each other.");
  }
}

function requireObservation(value: NativeTaskTimingObservation): void {
  shape(
    value,
    value.status === "unsupported"
      ? ["schemaVersion", "status", "reason"]
      : [
          "schemaVersion",
          "status",
          "observedAt",
          "timeZone",
          "horizon",
          "complete",
          "tasks",
          "protectedIntervals",
        ],
  );
  if (value.schemaVersion !== 1)
    throw new Error("Unsupported native timing observation version.");
  if (value.status === "unsupported") {
    nonempty(value.reason);
    return;
  }
  if (value.status !== "observed")
    throw new Error("Native timing must be independently observed.");
  instant(value.observedAt);
  timezone(value.timeZone);
  interval(value.horizon);
  shape(value.complete, ["tasks", "busy", "meals", "protected"]);
  if (
    [
      value.complete.tasks,
      value.complete.busy,
      value.complete.meals,
      value.complete.protected,
    ].some((complete) => complete !== true)
  )
    throw new Error(
      "Native timing requires complete Tasks, Busy, meals and protected interval evidence.",
    );
  if (!Array.isArray(value.tasks) || !Array.isArray(value.protectedIntervals))
    throw new Error("Missing native timing inventory.");
  const seen = new Set<string>();
  for (const task of value.tasks) {
    shape(task, ["identity", "timing", "ownership", "evidence"]);
    shape(task.identity, ["canonical", "aliases"]);
    identity(task.identity.canonical);
    if (!Array.isArray(task.identity.aliases))
      throw new Error("Missing verified Task aliases.");
    for (const alias of task.identity.aliases) {
      shape(alias, ["identity", "verifiedAt", "evidenceRef"]);
      identity(alias.identity);
      instant(alias.verifiedAt);
      nonempty(alias.evidenceRef);
    }
    for (const candidate of identities(task.identity)) {
      const key = JSON.stringify([candidate.listId, candidate.taskId]);
      if (seen.has(key))
        throw new Error(
          "Ambiguous native Task identity or duplicate observation.",
        );
      seen.add(key);
    }
    if (task.timing !== null) interval(task.timing);
    shape(
      task.ownership,
      task.ownership.kind === "manual" ? ["kind"] : ["kind", "owner"],
    );
    if (task.ownership.kind === "managed") nonempty(task.ownership.owner);
    else if (task.ownership.kind !== "manual")
      throw new Error("Unknown native Task placement ownership.");
    shape(task.evidence, ["surface", "verifiedAt", "reference"]);
    if (task.evidence.surface !== "native-task-editor")
      throw new Error(
        "Task descriptions, due dates and Calendar event text are not native timing evidence.",
      );
    instant(task.evidence.verifiedAt);
    nonempty(task.evidence.reference);
  }
  const intervals = new Set<string>();
  for (const item of value.protectedIntervals) {
    shape(item, ["id", "kind", "start", "end"]);
    nonempty(item.id);
    interval(item, true);
    if (
      !["busy", "meal", "protected"].includes(item.kind) ||
      intervals.has(item.id)
    )
      throw new Error("Invalid protected interval identity.");
    intervals.add(item.id);
  }
}

function requirePlan(plan: NativeTaskTimingPlan): void {
  shape(plan, [
    "schemaVersion",
    "planId",
    "policyVersion",
    "owner",
    "observationDigest",
    "timeZone",
    "placements",
    "availability",
  ]);
  if (plan.schemaVersion !== 1)
    refuse("invalid-plan", "Unsupported native timing plan version.");
  for (const value of [plan.planId, plan.policyVersion, plan.owner])
    nonempty(value);
  if (!/^[a-f0-9]{64}$/u.test(plan.observationDigest))
    refuse(
      "invalid-plan",
      "Plan must bind an exact native observation digest.",
    );
  timezone(plan.timeZone);
  if (!Array.isArray(plan.placements))
    refuse("invalid-plan", "Missing fixed Task placements.");
  for (const placement of plan.placements) {
    shape(placement, ["identity", "start", "end", "estimatedMinutes"]);
    identity(placement.identity);
    interval(placement, true);
    roundedNativeTaskMinutes(placement.estimatedMinutes);
  }
  shape(plan.availability, ["dated", "weekly"]);
  if (
    !Array.isArray(plan.availability.dated) ||
    !Array.isArray(plan.availability.weekly)
  )
    refuse("invalid-plan", "Missing dated and weekly availability policy.");
  const dates = new Set<string>();
  const weekdays = new Set<number>();
  for (const rule of plan.availability.dated) {
    shape(rule, ["date", "windows"]);
    if (
      !/^\d{4}-\d{2}-\d{2}$/u.test(rule.date) ||
      !Number.isFinite(Date.parse(`${rule.date}T00:00:00Z`)) ||
      new Date(`${rule.date}T00:00:00Z`).toISOString().slice(0, 10) !==
        rule.date ||
      dates.has(rule.date)
    )
      refuse("invalid-plan", "Invalid or duplicate dated availability.");
    dates.add(rule.date);
    windows(rule.windows);
  }
  for (const rule of plan.availability.weekly) {
    shape(rule, ["weekday", "windows"]);
    if (
      !Number.isInteger(rule.weekday) ||
      rule.weekday < 0 ||
      rule.weekday > 6 ||
      weekdays.has(rule.weekday)
    )
      refuse("invalid-plan", "Invalid or duplicate weekly availability.");
    weekdays.add(rule.weekday);
    windows(rule.windows);
  }
}
function windows(value: NativeTaskTimeWindow[]): void {
  if (!Array.isArray(value))
    refuse("invalid-plan", "Invalid availability windows.");
  for (const window of value) {
    shape(window, ["startMinute", "endMinute"]);
    if (
      !Number.isInteger(window.startMinute) ||
      !Number.isInteger(window.endMinute) ||
      window.startMinute < 0 ||
      window.endMinute > 1440 ||
      window.startMinute >= window.endMinute
    )
      refuse("invalid-plan", "Invalid local availability window.");
  }
}
function identity(value: TaskProviderIdentity): void {
  shape(value, ["listId", "taskId"]);
  nonempty(value.listId);
  nonempty(value.taskId);
}
function identities(binding: TaskProviderBinding): TaskProviderIdentity[] {
  return [binding.canonical, ...binding.aliases.map((alias) => alias.identity)];
}
function interval(value: NativeTaskInterval, allowFields = false): void {
  if (!allowFields) shape(value, ["start", "end"]);
  if (instant(value.end) <= instant(value.start))
    throw new Error(
      "Native timing intervals need verified start and end instants.",
    );
}
function overlaps(
  left: NativeTaskInterval,
  right: NativeTaskInterval,
): boolean {
  return (
    instant(left.start) < instant(right.end) &&
    instant(right.start) < instant(left.end)
  );
}
function requireFresh(value: string, now: number, maximum: number): void {
  const age = now - instant(value);
  if (age < 0 || age > maximum)
    refuse(
      "stale-evidence",
      "Native timing evidence is stale or from the future.",
    );
}
function instant(value: string): number {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error("Native timing requires explicit timestamp offsets.");
  if (
    new Date(`${value.slice(0, 19)}Z`).toISOString().slice(0, 19) !==
    value.slice(0, 19)
  )
    throw new Error("Native timing requires valid calendar instants.");
  return Date.parse(value);
}
function timezone(value: string): void {
  nonempty(value);
  new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
}
function localParts(
  value: string,
  timeZone: string,
): { date: string; minute: number; second: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (name: string): string =>
    parts.find((part) => part.type === name)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  return {
    date,
    minute: Number(get("hour")) * 60 + Number(get("minute")),
    second: Number(get("second")) + new Date(value).getUTCMilliseconds() / 1000,
    weekday: new Date(`${date}T12:00:00Z`).getUTCDay(),
  };
}
function shape(value: unknown, allowed: string[]): void {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new Error(
      "Unsupported native timing evidence fields; descriptions cannot establish timing.",
    );
}
function nonempty(value: string): void {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0"))
    throw new Error("Missing explicit native timing identity or evidence.");
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
class TimingRefusal extends Error {
  constructor(
    readonly code: Extract<
      NativeTaskTimingValidation,
      { outcome: "refused" }
    >["code"],
    message: string,
  ) {
    super(message);
  }
}
function refuse(code: TimingRefusal["code"], message: string): never {
  throw new TimingRefusal(code, message);
}
