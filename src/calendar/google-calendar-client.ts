import { GoogleAuth } from "google-auth-library";
import { createHash } from "node:crypto";

import { CalendarSyncTokenExpiredError } from "./calendar-refresh-error.js";
import {
  futureCalendarRecurrence,
  trimCalendarRecurrence,
} from "./calendar-recurrence.js";
import type {
  CalendarEvent,
  CalendarEventPatch,
  CalendarListEntry,
  CalendarProposalReader,
  CalendarPromotionWriter,
  CalendarRefreshReader,
  CalendarSetupReader,
  CalendarSetupWriter,
} from "./types.js";

export const CALENDAR_LIST_READONLY_SCOPE =
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
export const CALENDAR_PROPERTIES_WRITE_SCOPE =
  "https://www.googleapis.com/auth/calendar.calendars";
export const CALENDAR_EVENTS_READONLY_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.readonly";
export const CALENDAR_EVENTS_WRITE_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";

const calendarListUrl =
  "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const calendarsUrl = "https://www.googleapis.com/calendar/v3/calendars";

interface CalendarListPage {
  items?: CalendarListEntry[];
  nextPageToken?: string;
}

interface CalendarEventsPage {
  items?: CalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export interface CalendarHttpRequest {
  url: string;
  method: "GET" | "POST" | "PATCH" | "PUT";
  params?: {
    maxResults?: 250;
    pageToken?: string;
    showDeleted?: boolean;
    showHidden?: true;
    singleEvents?: boolean;
    timeMax?: string;
    timeMin?: string;
    syncToken?: string;
    destination?: string;
    originalStart?: string;
    supportsAttachments?: true;
    conferenceDataVersion?: 1;
  };
  data?: Record<string, unknown>;
}

export function createGoogleCalendarPromotionWriter(
  credentialPath: string,
  requester: CalendarRequester = defaultRequester(
    credentialPath,
    CALENDAR_EVENTS_WRITE_SCOPE,
  ),
): CalendarPromotionWriter {
  return {
    createEvent: async ({ calendarId, eventId, event, idempotencyKey }) => {
      await requester.request({
        url: eventCollectionUrl(calendarId),
        method: "POST",
        data: {
          id: eventId,
          ...event,
          extendedProperties: {
            private: { academicOsIdempotencyKey: idempotencyKey },
          },
        },
      });
    },
    readEvent: async ({ calendarId, eventId }) => {
      const response: { data: CalendarEvent } = await requester.request({
        url: `${eventCollectionUrl(calendarId)}/${encodeURIComponent(eventId)}`,
        method: "GET",
      });
      return response.data;
    },
    patchEvent: async ({ calendarId, eventId, patch }) => {
      const params = patchRequestParameters(patch);
      await requester.request({
        url: `${eventCollectionUrl(calendarId)}/${encodeURIComponent(eventId)}`,
        method: "PATCH",
        data: { ...patch },
        ...(Object.keys(params).length === 0 ? {} : { params }),
      });
    },
    moveEvent: async ({ sourceCalendarId, targetCalendarId, eventId }) => {
      await requester.request({
        url: `${eventCollectionUrl(sourceCalendarId)}/${encodeURIComponent(eventId)}/move`,
        method: "POST",
        params: { destination: targetCalendarId },
      });
    },
    splitRecurringEvent: async (input) =>
      await splitGoogleRecurringEvent(requester, input),
  };
}

async function splitGoogleRecurringEvent(
  requester: CalendarRequester,
  input: Parameters<CalendarPromotionWriter["splitRecurringEvent"]>[0],
): Promise<{ eventId: string }> {
  const newEventId = `a${createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 31)}`;
  if (await eventExists(requester, input.targetCalendarId, newEventId)) {
    await replayRecurrenceExceptions(requester, input, newEventId);
    return { eventId: newEventId };
  }
  const instance = (
    await requester.request<CalendarEvent>({
      url: `${eventCollectionUrl(input.sourceCalendarId)}/${encodeURIComponent(input.instanceId)}`,
      method: "GET",
    })
  ).data;
  const splitPoint = instance.originalStartTime ?? instance.start;
  const splitBoundary = splitPoint?.dateTime ?? splitPoint?.date;
  const originalRecurrence = input.recurringMaster.recurrence;
  if (splitBoundary === undefined || originalRecurrence === undefined) {
    throw new Error(
      "This-and-future Promotion requires a timed recurring occurrence and master.",
    );
  }
  const priorInstances = await requester.request<CalendarEventsPage>({
    url: `${eventCollectionUrl(input.sourceCalendarId)}/${encodeURIComponent(input.recurringEventId)}/instances`,
    method: "GET",
    params: { timeMax: recurrenceTimeMax(splitBoundary) },
  });
  await trimRecurringMaster(requester, input, splitBoundary);
  await createFutureSeries(
    requester,
    input,
    instance,
    newEventId,
    futureCalendarRecurrence(
      originalRecurrence,
      priorInstances.data.items?.length ?? 0,
    ),
  );
  await replayRecurrenceExceptions(requester, input, newEventId);
  return { eventId: newEventId };
}

async function trimRecurringMaster(
  requester: CalendarRequester,
  input: Parameters<CalendarPromotionWriter["splitRecurringEvent"]>[0],
  splitBoundary: string,
): Promise<void> {
  const trimmed = {
    ...writableEvent(input.recurringMaster),
    recurrence: trimCalendarRecurrence(
      input.recurringMaster.recurrence ?? [],
      splitBoundary,
    ),
  };
  await requester.request({
    url: `${eventCollectionUrl(input.sourceCalendarId)}/${encodeURIComponent(input.recurringEventId)}`,
    method: "PUT",
    data: trimmed,
    params: richEventRequestParameters(trimmed),
  });
}

async function createFutureSeries(
  requester: CalendarRequester,
  input: Parameters<CalendarPromotionWriter["splitRecurringEvent"]>[0],
  instance: CalendarEvent,
  eventId: string,
  recurrence: string[],
): Promise<void> {
  const master = input.recurringMaster;
  const future = {
    ...writableEvent(master),
    ...input.patch,
    id: eventId,
    start: instance.start,
    end: instance.end,
    recurrence,
    extendedProperties: idempotentExtendedProperties(
      master,
      input.idempotencyKey,
    ),
  };
  await requester.request({
    url: eventCollectionUrl(input.targetCalendarId),
    method: "POST",
    data: future,
    params: richEventRequestParameters(future),
  });
}

async function replayRecurrenceExceptions(
  requester: CalendarRequester,
  input: Parameters<CalendarPromotionWriter["splitRecurringEvent"]>[0],
  eventId: string,
): Promise<void> {
  for (const exception of input.exceptions) {
    const originalStart =
      exception.originalStartTime?.dateTime ??
      exception.originalStartTime?.date;
    if (originalStart === undefined) continue;
    const instances = await requester.request<CalendarEventsPage>({
      url: `${eventCollectionUrl(input.targetCalendarId)}/${eventId}/instances`,
      method: "GET",
      params: { originalStart },
    });
    const replacement = instances.data.items?.[0];
    if (replacement === undefined) {
      throw new Error(
        `Calendar returned no replacement instance for ${originalStart}.`,
      );
    }
    const patch = writableException(exception);
    await requester.request({
      url: `${eventCollectionUrl(input.targetCalendarId)}/${encodeURIComponent(replacement.id)}`,
      method: "PATCH",
      data: patch,
      params: richEventRequestParameters(patch),
    });
  }
}

async function eventExists(
  requester: CalendarRequester,
  calendarId: string,
  eventId: string,
): Promise<boolean> {
  try {
    await requester.request({
      url: `${eventCollectionUrl(calendarId)}/${eventId}`,
      method: "GET",
    });
    return true;
  } catch {
    return false;
  }
}

function idempotentExtendedProperties(
  master: CalendarEvent,
  idempotencyKey: string,
): Record<string, unknown> {
  return {
    ...(isRecord(master.extendedProperties) ? master.extendedProperties : {}),
    private: {
      ...(isRecord(master.extendedProperties) &&
      isRecord(master.extendedProperties.private)
        ? master.extendedProperties.private
        : {}),
      academicOsIdempotencyKey: idempotencyKey,
    },
  };
}

function writableEvent(event: CalendarEvent): Record<string, unknown> {
  const value = { ...event };
  for (const key of [
    "id",
    "etag",
    "created",
    "updated",
    "htmlLink",
    "iCalUID",
    "kind",
    "recurringEventId",
    "originalStartTime",
    "sequence",
    "status",
  ])
    delete value[key];
  return value;
}

function writableException(event: CalendarEvent): Record<string, unknown> {
  return {
    ...writableEvent(event),
    ...(typeof event.status === "string" ? { status: event.status } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function eventCollectionUrl(calendarId: string): string {
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
}

function patchRequestParameters(patch: CalendarEventPatch): {
  supportsAttachments?: true;
  conferenceDataVersion?: 1;
} {
  return {
    ...(patch.attachments === undefined ? {} : { supportsAttachments: true }),
    ...(patch.conferenceData === undefined ? {} : { conferenceDataVersion: 1 }),
  };
}

function richEventRequestParameters(_event: Record<string, unknown>): {
  supportsAttachments: true;
  conferenceDataVersion: 1;
} {
  return { supportsAttachments: true, conferenceDataVersion: 1 };
}

function recurrenceTimeMax(boundary: string): string {
  return /^\d{4}-\d{2}-\d{2}$/u.test(boundary)
    ? `${boundary}T00:00:00Z`
    : boundary;
}

export interface CalendarRequester {
  request<T>(request: CalendarHttpRequest): Promise<{ data: T }>;
}

export function createGoogleCalendarSetupReader(
  credentialPath: string,
  requester: CalendarRequester = defaultRequester(
    credentialPath,
    CALENDAR_LIST_READONLY_SCOPE,
  ),
): CalendarSetupReader {
  return {
    listCalendars: async () => await listCalendars(requester),
  };
}

export function createGoogleCalendarProposalReader(
  credentialPath: string,
  requester: CalendarRequester = defaultRequester(credentialPath, [
    CALENDAR_LIST_READONLY_SCOPE,
    CALENDAR_EVENTS_READONLY_SCOPE,
  ]),
): CalendarProposalReader {
  return {
    listCalendars: async () => await listCalendars(requester),
    listEventOccurrences: async ({ calendarId, timeMin, timeMax }) => {
      const result = await listEventPages(async (pageToken) => {
        const response: { data: CalendarEventsPage } = await requester.request({
          url: `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
          method: "GET",
          params: {
            singleEvents: true,
            showDeleted: false,
            timeMin,
            timeMax,
            ...(pageToken === undefined ? {} : { pageToken }),
          },
        });
        return response.data;
      });
      return result.events;
    },
  };
}

export function createGoogleCalendarSetupWriter(
  credentialPath: string,
  requester: CalendarRequester = defaultRequester(
    credentialPath,
    CALENDAR_PROPERTIES_WRITE_SCOPE,
  ),
): CalendarSetupWriter {
  return {
    createCalendar: async (summary) => {
      const response: { data: { id?: string } } = await requester.request({
        url: calendarsUrl,
        method: "POST",
        data: { summary },
      });
      if (typeof response.data.id !== "string" || response.data.id === "") {
        throw new Error(`Calendar creation returned no ID for ${summary}.`);
      }
      return { id: response.data.id };
    },
  };
}

export function createGoogleCalendarRefreshReader(
  credentialPath: string,
  requester: CalendarRequester = defaultRequester(
    credentialPath,
    CALENDAR_EVENTS_READONLY_SCOPE,
  ),
): CalendarRefreshReader {
  return {
    listEventChanges: async ({ calendarId, managementHorizon, syncToken }) => {
      const result = await listEventPages(async (pageToken) => {
        try {
          const response: { data: CalendarEventsPage } =
            await requester.request({
              url: `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
              method: "GET",
              params: {
                singleEvents: false,
                showDeleted: true,
                ...(syncToken === undefined
                  ? { timeMin: managementHorizon }
                  : { syncToken }),
                ...(pageToken === undefined ? {} : { pageToken }),
              },
            });
          return response.data;
        } catch (error) {
          if (syncToken !== undefined && isExpiredSyncTokenError(error)) {
            throw new CalendarSyncTokenExpiredError();
          }
          throw error;
        }
      });
      if (result.nextSyncToken === undefined || result.nextSyncToken === "") {
        throw new Error("Google Calendar returned no next sync token.");
      }
      return { events: result.events, nextSyncToken: result.nextSyncToken };
    },
  };
}

async function listEventPages(
  readPage: (pageToken: string | undefined) => Promise<CalendarEventsPage>,
): Promise<{ events: CalendarEvent[]; nextSyncToken?: string }> {
  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  do {
    const page = await readPage(pageToken);
    events.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
    nextSyncToken = page.nextSyncToken ?? nextSyncToken;
  } while (pageToken !== undefined);
  return {
    events,
    ...(nextSyncToken === undefined ? {} : { nextSyncToken }),
  };
}

function isExpiredSyncTokenError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const value = error as {
    code?: unknown;
    response?: { status?: unknown };
  };
  return value.code === 410 || value.response?.status === 410;
}

function defaultRequester(
  credentialPath: string,
  scope: string | string[],
): CalendarRequester {
  return new GoogleAuth({
    keyFile: credentialPath,
    scopes: typeof scope === "string" ? [scope] : scope,
  });
}

async function listCalendars(
  requester: CalendarRequester,
): Promise<CalendarListEntry[]> {
  const calendars: CalendarListEntry[] = [];
  let pageToken: string | undefined;
  do {
    const response: { data: CalendarListPage } = await requester.request({
      url: calendarListUrl,
      method: "GET",
      params: {
        maxResults: 250,
        showDeleted: false,
        showHidden: true,
        ...(pageToken === undefined ? {} : { pageToken }),
      },
    });
    calendars.push(...(response.data.items ?? []));
    pageToken = response.data.nextPageToken;
  } while (pageToken !== undefined);
  return calendars;
}
