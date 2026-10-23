import { readFile, writeFile } from "node:fs/promises";

import { GoogleAuth } from "google-auth-library";

interface FakeCalendar {
  id: string;
  primary?: boolean;
  summary: string;
}

interface FakeCalendarState {
  ambiguousCreateFailures?: string[];
  strictOccurrences?: boolean;
  occurrenceEvents?: Record<string, unknown[]>;
  instanceEvents?: Record<string, unknown[]>;
  responsePages?: Record<
    string,
    Array<{ items: unknown[]; nextPageToken?: string }>
  >;
  calendars: FakeCalendar[];
  createdEventOverrides?: Record<string, Record<string, unknown>>;
  eventReadFailures?: string[];
  eventCreateFailures?: string[];
  eventPageSizes?: Record<string, number>;
  eventPageFailures?: Record<string, string[]>;
  events?: Record<string, unknown[]>;
  expiredSyncTokens?: string[];
  incrementalEvents?: Record<string, Record<string, unknown[]>>;
  ignoredPatches?: string[];
  nextSyncTokens?: Record<string, string>;
  nextId?: number;
  omitCreatedFromIncremental?: boolean;
  patchFailures?: string[];
  deleteFailures?: string[];
  reverseRecurrenceOnPatch?: string[];
  requests?: Array<{
    body?: unknown;
    credential?: string;
    method?: string;
    scopes?: string[];
    params?: unknown;
    url?: string;
  }>;
}

interface RequestOptions {
  url?: string;
  method?: string;
  data?: unknown;
  params?: unknown;
}

interface GoogleAuthState {
  keyFilename?: string;
  scopes?: string | string[];
}

const statePath = process.env.ACADEMIC_OS_FAKE_CALENDAR_STATE;
if (statePath === undefined) {
  throw new Error("ACADEMIC_OS_FAKE_CALENDAR_STATE is required.");
}

const prototype = GoogleAuth.prototype as unknown as {
  request(
    this: GoogleAuthState,
    options: RequestOptions,
  ): Promise<{ data: unknown }>;
};

prototype.request = async function (options) {
  const state = JSON.parse(
    await readFile(statePath, "utf8"),
  ) as FakeCalendarState;
  const request = {
    ...(options.data === undefined ? {} : { body: options.data }),
    ...(this.keyFilename === undefined ? {} : { credential: this.keyFilename }),
    method: options.method ?? "GET",
    ...(options.params === undefined ? {} : { params: options.params }),
    scopes:
      typeof this.scopes === "string" ? [this.scopes] : (this.scopes ?? []),
    ...(options.url === undefined ? {} : { url: options.url }),
  };
  state.requests = [...(state.requests ?? []), request];

  if (
    options.method === "GET" &&
    options.url ===
      "https://www.googleapis.com/calendar/v3/users/me/calendarList"
  ) {
    await writeFile(statePath, `${JSON.stringify(state)}\n`);
    return { data: { items: state.calendars } };
  }

  if (
    options.method === "POST" &&
    options.url === "https://www.googleapis.com/calendar/v3/calendars"
  ) {
    const body = options.data as { summary?: string };
    const id = `created-${state.nextId ?? 1}`;
    state.nextId = (state.nextId ?? 1) + 1;
    const calendar = { id, summary: body.summary ?? "", accessRole: "owner" };
    state.calendars.push(calendar);
    await writeFile(statePath, `${JSON.stringify(state)}\n`);
    return { data: calendar };
  }

  const eventsMatch = options.url?.match(
    /^https:\/\/www\.googleapis\.com\/calendar\/v3\/calendars\/([^/]+)\/events$/u,
  );
  const eventMatch = options.url?.match(
    /^https:\/\/www\.googleapis\.com\/calendar\/v3\/calendars\/([^/]+)\/events\/([^/]+)$/u,
  );
  const moveMatch = options.url?.match(
    /^https:\/\/www\.googleapis\.com\/calendar\/v3\/calendars\/([^/]+)\/events\/([^/]+)\/move$/u,
  );
  const instancesMatch = options.url?.match(
    /^https:\/\/www\.googleapis\.com\/calendar\/v3\/calendars\/([^/]+)\/events\/([^/]+)\/instances$/u,
  );
  if (
    options.method === "DELETE" &&
    eventMatch !== null &&
    eventMatch !== undefined
  ) {
    const calendarId = decodeURIComponent(eventMatch[1] ?? "");
    const eventId = decodeURIComponent(eventMatch[2] ?? "");
    if (state.deleteFailures?.includes(eventId) === true) {
      state.deleteFailures = state.deleteFailures.filter(
        (id) => id !== eventId,
      );
      await writeFile(statePath, `${JSON.stringify(state)}\n`);
      throw new Error("Synthetic Calendar delete failed before acceptance.");
    }
    const events = state.events?.[calendarId] ?? [];
    const index = events.findIndex(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        "id" in candidate &&
        candidate.id === eventId,
    );
    if (index < 0) throw { response: { status: 404 } };
    const master = events[index];
    const deleted = events.filter(
      (event) =>
        isRecord(event) &&
        (event.id === eventId ||
          (isRecord(master) &&
            master.recurrence !== undefined &&
            event.recurringEventId === eventId)),
    );
    for (const event of deleted) events.splice(events.indexOf(event), 1);
    publishIncremental(
      state,
      calendarId,
      deleted.map((event) => ({
        id: isRecord(event) ? event.id : eventId,
        status: "cancelled",
      })),
    );
    await writeFile(statePath, `${JSON.stringify(state)}\n`);
    return { data: {} };
  }
  if (
    options.method === "GET" &&
    instancesMatch !== null &&
    instancesMatch !== undefined
  ) {
    const calendarId = decodeURIComponent(instancesMatch[1] ?? "");
    const seriesId = decodeURIComponent(instancesMatch[2] ?? "");
    const originalStart = (
      options.params as { originalStart?: string } | undefined
    )?.originalStart;
    const events = state.events?.[calendarId] ?? [];
    const master = events.find(
      (event) => isRecord(event) && event.id === seriesId,
    );
    const key = `${calendarId}/${seriesId}/${originalStart ?? "all"}`;
    const page = staticPage(state, key, options.params);
    if (page !== undefined) {
      await writeFile(statePath, `${JSON.stringify(state)}\n`);
      return { data: page };
    }
    const configured = state.instanceEvents?.[key];
    if (configured !== undefined) {
      const actual = events.filter(
        (event) =>
          isRecord(event) &&
          event.recurringEventId === seriesId &&
          (originalStart === undefined ||
            pointInstant(event.originalStartTime) ===
              Date.parse(originalStart)),
      );
      await writeFile(statePath, `${JSON.stringify(state)}\n`);
      return {
        data: {
          items: configured.map((event) =>
            isRecord(event)
              ? (actual.find(
                  (candidate) =>
                    isRecord(candidate) && candidate.id === event.id,
                ) ?? event)
              : event,
          ),
        },
      };
    }
    if (state.strictOccurrences === true) {
      await writeFile(statePath, `${JSON.stringify(state)}\n`);
      return { data: { items: [] } };
    }
    const items =
      originalStart === undefined
        ? events.filter(
            (event) => isRecord(event) && event.recurringEventId === seriesId,
          )
        : events.filter(
            (event) =>
              isRecord(event) &&
              event.recurringEventId === seriesId &&
              pointInstant(event.originalStartTime) ===
                Date.parse(originalStart),
          );
    if (originalStart !== undefined && items.length === 0 && isRecord(master))
      items.push(legacyInstance(master, originalStart));
    await writeFile(statePath, `${JSON.stringify(state)}\n`);
    return { data: { items } };
  }

  if (
    options.method === "PATCH" &&
    eventMatch !== null &&
    eventMatch !== undefined
  ) {
    const calendarId = decodeURIComponent(eventMatch[1] ?? "");
    const eventId = decodeURIComponent(eventMatch[2] ?? "");
    if (
      state.patchFailures?.includes(eventId) === true ||
      state.patchFailures?.includes("*") === true
    ) {
      state.patchFailures = state.patchFailures.filter((id) => id !== eventId);
      state.patchFailures = state.patchFailures.filter((id) => id !== "*");
      await writeFile(statePath, `${JSON.stringify(state)}\n`);
      throw new Error("Synthetic Calendar patch failed before acceptance.");
    }
    const events = state.events?.[calendarId] ?? [];
    let index = events.findIndex(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        "id" in candidate &&
        candidate.id === eventId,
    );
    if (index < 0) {
      const configured = Object.values(state.instanceEvents ?? {})
        .flat()
        .find((event) => isRecord(event) && event.id === eventId);
      let virtual = configured;
      if (virtual === undefined && state.strictOccurrences !== true) {
        const master = events.find(
          (event) =>
            isRecord(event) &&
            typeof event.id === "string" &&
            eventId.startsWith(`${event.id}-exception-`),
        );
        if (isRecord(master) && typeof master.id === "string")
          virtual = legacyInstance(
            master,
            new Date(
              Number(eventId.slice(`${master.id}-exception-`.length)),
            ).toISOString(),
          );
      }
      if (virtual !== undefined) {
        events.push(virtual);
        index = events.length - 1;
      }
    }
    if (index < 0) throw new Error(`Synthetic event ${eventId} not found.`);
    if (state.ignoredPatches?.includes(eventId) === true) {
      await writeFile(statePath, `${JSON.stringify(state)}\n`);
      return { data: events[index] };
    }
    const event = {
      ...(events[index] as Record<string, unknown>),
      ...(options.data as Record<string, unknown>),
    };
    if (
      state.reverseRecurrenceOnPatch?.includes(eventId) === true &&
      Array.isArray(event.recurrence)
    ) {
      event.recurrence = [...event.recurrence].reverse();
    }
    events[index] = event;
    publishIncremental(state, calendarId, [event]);
    await writeFile(statePath, `${JSON.stringify(state)}\n`);
    return { data: event };
  }
  if (
    options.method === "PUT" &&
    eventMatch !== null &&
    eventMatch !== undefined
  ) {
    const calendarId = decodeURIComponent(eventMatch[1] ?? "");
    const eventId = decodeURIComponent(eventMatch[2] ?? "");
    const events = state.events?.[calendarId] ?? [];
    const index = events.findIndex(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        "id" in candidate &&
        candidate.id === eventId,
    );
    if (index < 0) throw new Error(`Synthetic event ${eventId} not found.`);
    const event = { id: eventId, ...(options.data as Record<string, unknown>) };
    events[index] = event;
    publishIncremental(state, calendarId, [event]);
    await writeFile(statePath, `${JSON.stringify(state)}\n`);
    return { data: event };
  }
  if (
    options.method === "POST" &&
    moveMatch !== null &&
    moveMatch !== undefined
  ) {
    const sourceCalendarId = decodeURIComponent(moveMatch[1] ?? "");
    const eventId = decodeURIComponent(moveMatch[2] ?? "");
    const targetCalendarId =
      (options.params as { destination?: string } | undefined)?.destination ??
      "";
    const source = state.events?.[sourceCalendarId] ?? [];
    const index = source.findIndex(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        "id" in candidate &&
        candidate.id === eventId,
    );
    if (index < 0) {
      const existing = state.events?.[targetCalendarId]?.find(
        (candidate) =>
          typeof candidate === "object" &&
          candidate !== null &&
          "id" in candidate &&
          candidate.id === eventId,
      );
      if (existing !== undefined) return { data: existing };
      throw new Error(`Synthetic event ${eventId} not found.`);
    }
    const sourceEvent = source[index] as Record<string, unknown>;
    const movedEvents = source.filter((candidate) => {
      if (typeof candidate !== "object" || candidate === null) return false;
      const record = candidate as Record<string, unknown>;
      return (
        record.id === eventId ||
        (sourceEvent.recurrence !== undefined &&
          record.recurringEventId === eventId)
      );
    });
    for (const movedEvent of movedEvents) {
      const movedIndex = source.indexOf(movedEvent);
      source.splice(movedIndex, 1);
    }
    state.events ??= {};
    state.events[targetCalendarId] ??= [];
    state.events[targetCalendarId].push(...movedEvents);
    publishIncremental(
      state,
      sourceCalendarId,
      movedEvents.map((movedEvent) => ({
        id: (movedEvent as { id: string }).id,
        status: "cancelled",
      })),
    );
    publishIncremental(state, targetCalendarId, movedEvents);
    await writeFile(statePath, `${JSON.stringify(state)}\n`);
    return { data: sourceEvent };
  }
  if (
    options.method === "GET" &&
    eventMatch !== null &&
    eventMatch !== undefined
  ) {
    const calendarId = decodeURIComponent(eventMatch[1] ?? "");
    const eventId = decodeURIComponent(eventMatch[2] ?? "");
    const event = state.events?.[calendarId]?.find(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        "id" in candidate &&
        candidate.id === eventId,
    );
    await writeFile(statePath, `${JSON.stringify(state)}\n`);
    if (event === undefined) throw { response: { status: 404 } };
    return { data: event };
  }
  if (
    options.method === "POST" &&
    eventsMatch !== null &&
    eventsMatch !== undefined
  ) {
    const calendarId = decodeURIComponent(eventsMatch[1] ?? "");
    const requested = options.data as { id?: string };
    const event = {
      ...requested,
      ...state.createdEventOverrides?.[requested.id ?? ""],
    };
    const existing = state.events?.[calendarId]?.some(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        "id" in candidate &&
        candidate.id === event.id,
    );
    if (existing === true) throw { response: { status: 409 } };
    if (state.eventCreateFailures?.includes(event.id ?? "") === true) {
      state.eventCreateFailures = state.eventCreateFailures.filter(
        (id) => id !== event.id,
      );
      await writeFile(statePath, `${JSON.stringify(state)}\n`);
      throw new Error("Synthetic Calendar create failed before acceptance.");
    }
    state.events ??= {};
    state.events[calendarId] ??= [];
    state.events[calendarId].push(event);
    state.incrementalEvents ??= {};
    state.incrementalEvents[calendarId] ??= {};
    const nextSyncToken =
      state.nextSyncTokens?.[calendarId] ??
      `${calendarId.replace(/-id$/u, "")}-sync-1`;
    state.incrementalEvents[calendarId][nextSyncToken] =
      state.omitCreatedFromIncremental === true
        ? []
        : [
            ...(state.incrementalEvents[calendarId][nextSyncToken] ?? []),
            event,
          ];
    await writeFile(statePath, `${JSON.stringify(state)}\n`);
    if (state.ambiguousCreateFailures?.includes(event.id ?? "") === true) {
      state.ambiguousCreateFailures = state.ambiguousCreateFailures.filter(
        (id) => id !== event.id,
      );
      await writeFile(statePath, `${JSON.stringify(state)}\n`);
      throw new Error("Synthetic response lost after Calendar create.");
    }
    return { data: event };
  }
  if (
    options.method === "GET" &&
    eventsMatch !== null &&
    eventsMatch !== undefined
  ) {
    const calendarId = decodeURIComponent(eventsMatch[1] ?? "");
    await writeFile(statePath, `${JSON.stringify(state)}\n`);
    const params = options.params as
      | { pageToken?: string; syncToken?: string }
      | undefined;
    if (state.expiredSyncTokens?.includes(params?.syncToken ?? "") === true) {
      throw { response: { status: 410 } };
    }
    if (
      state.eventPageFailures?.[calendarId]?.includes(
        params?.pageToken ?? "first",
      ) === true
    ) {
      throw new Error(
        `Synthetic event page read failed for ${calendarId} at ${params?.pageToken ?? "first"}.`,
      );
    }
    if (state.eventReadFailures?.includes(calendarId) === true) {
      throw new Error(`Synthetic event read failed for ${calendarId}.`);
    }
    const optionsParams = options.params as
      | {
          singleEvents?: boolean;
          timeMin?: string;
          timeMax?: string;
          syncToken?: string;
          pageToken?: string;
        }
      | undefined;
    const route = `${calendarId}/${optionsParams?.singleEvents === true ? "occurrences" : optionsParams?.syncToken !== undefined || optionsParams?.timeMin !== undefined ? "changes" : "stored"}`;
    const explicitPage = staticPage(state, route, options.params);
    if (explicitPage !== undefined) return { data: explicitPage };
    let events =
      params?.syncToken === undefined
        ? (state.events?.[calendarId] ?? [])
        : (state.incrementalEvents?.[calendarId]?.[params.syncToken] ?? []);
    if (optionsParams?.singleEvents === true) {
      const actual = events.filter(
        (event) => !isRecord(event) || event.recurrence === undefined,
      );
      events = [
        ...(state.occurrenceEvents?.[calendarId] ?? []).filter(
          (event) =>
            !isRecord(event) ||
            !actual.some(
              (stored) => isRecord(stored) && stored.id === event.id,
            ),
        ),
        ...actual,
      ];
      const minimum = Date.parse(optionsParams.timeMin ?? "");
      const maximum = Date.parse(optionsParams.timeMax ?? "");
      events = events.filter((event) => {
        if (!isRecord(event) || event.status === "cancelled") return false;
        const start = pointInstant(event.start);
        const end = pointInstant(event.end);
        return (
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          (start < maximum && end > minimum)
        );
      });
    }
    const offset = Number(params?.pageToken ?? "0");
    const pageSize = state.eventPageSizes?.[calendarId] ?? events.length;
    const nextOffset = offset + pageSize;
    return {
      data: {
        items: events.slice(offset, nextOffset),
        ...(nextOffset < events.length
          ? { nextPageToken: String(nextOffset) }
          : {
              nextSyncToken:
                state.nextSyncTokens?.[calendarId] ??
                `${calendarId.replace(/-id$/u, "")}-sync-1`,
            }),
      },
    };
  }

  throw new Error(`Unexpected synthetic Calendar request: ${options.url}.`);
};

function publishIncremental(
  state: FakeCalendarState,
  calendarId: string,
  events: unknown[],
): void {
  state.incrementalEvents ??= {};
  state.incrementalEvents[calendarId] ??= {};
  const nextSyncToken =
    state.nextSyncTokens?.[calendarId] ??
    `${calendarId.replace(/-id$/u, "")}-sync-1`;
  state.incrementalEvents[calendarId][nextSyncToken] = [
    ...(state.incrementalEvents[calendarId][nextSyncToken] ?? []).filter(
      (previous) =>
        !isRecord(previous) ||
        !events.some((event) => isRecord(event) && event.id === previous.id),
    ),
    ...events,
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function pointInstant(point: unknown): number {
  return isRecord(point)
    ? Date.parse(
        typeof point.dateTime === "string"
          ? point.dateTime
          : typeof point.date === "string"
            ? `${point.date}T00:00:00+08:00`
            : "",
      )
    : NaN;
}
function legacyInstance(
  master: Record<string, unknown>,
  originalStart: string,
): Record<string, unknown> {
  const value = { ...master };
  delete value.recurrence;
  const duration = pointInstant(master.end) - pointInstant(master.start);
  return {
    ...value,
    id: `${master.id}-exception-${Date.parse(originalStart)}`,
    recurringEventId: master.id,
    originalStartTime: { dateTime: originalStart },
    start: {
      dateTime: originalStart,
      ...(isRecord(master.start) && typeof master.start.timeZone === "string"
        ? { timeZone: master.start.timeZone }
        : {}),
    },
    end: {
      dateTime: new Date(Date.parse(originalStart) + duration).toISOString(),
      ...(isRecord(master.end) && typeof master.end.timeZone === "string"
        ? { timeZone: master.end.timeZone }
        : {}),
    },
  };
}
function staticPage(
  state: FakeCalendarState,
  key: string,
  value: unknown,
): { items: unknown[]; nextPageToken?: string } | undefined {
  const pages = state.responsePages?.[key];
  if (pages === undefined) return undefined;
  const token =
    isRecord(value) && typeof value.pageToken === "string"
      ? value.pageToken
      : "0";
  const index = Number(token);
  const page = pages[index];
  if (page === undefined)
    throw new Error(`Unknown static Calendar page ${key}/${token}`);
  return {
    items: page.items.map((item) =>
      isRecord(item)
        ? ((state.events?.[key.split("/")[0] ?? ""] ?? []).find(
            (current) => isRecord(current) && current.id === item.id,
          ) ?? item)
        : item,
    ),
    ...(page.nextPageToken === undefined
      ? index + 1 < pages.length
        ? { nextPageToken: String(index + 1) }
        : {}
      : { nextPageToken: page.nextPageToken }),
  };
}
