import { GoogleAuth } from "google-auth-library";

import { checkedNextPageToken } from "../provider-page-token.js";

import { OperationalError } from "../operational-error.js";

import { CalendarSyncTokenExpiredError } from "./calendar-refresh-error.js";
import {
  isCalendarEvent,
  idempotentExtendedProperties,
} from "./calendar-event-helpers.js";
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
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
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
          extendedProperties: idempotentExtendedProperties(
            event,
            idempotencyKey,
          ),
        },
        ...("attachments" in event || "conferenceData" in event
          ? { params: richEventRequestParameters({ ...event }) }
          : {}),
      });
    },
    readEvent: async ({ calendarId, eventId }) => {
      const response: { data: CalendarEvent } = await requester.request({
        url: `${eventCollectionUrl(calendarId)}/${encodeURIComponent(eventId)}`,
        method: "GET",
      });
      return requireCalendarEvent(response.data);
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
    deleteEvent: async ({ calendarId, eventId }) => {
      try {
        await requester.request({
          url: `${eventCollectionUrl(calendarId)}/${encodeURIComponent(eventId)}`,
          method: "DELETE",
        });
        return "deleted";
      } catch (error) {
        if (isMissingEventError(error)) return "missing";
        throw error;
      }
    },
  };
}

function eventCollectionUrl(calendarId: string): string {
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
}

function patchRequestParameters(patch: CalendarEventPatch | CalendarEvent): {
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
    readEvent: async ({ calendarId, eventId }) =>
      requireCalendarEvent(
        (
          await requester.request<CalendarEvent>({
            url: `${eventCollectionUrl(calendarId)}/${encodeURIComponent(eventId)}`,
            method: "GET",
          })
        ).data,
      ),
    listStoredEvents: async ({ calendarId }) =>
      (
        await listEventPages(
          async (pageToken) =>
            (
              await requester.request<CalendarEventsPage>({
                url: eventCollectionUrl(calendarId),
                method: "GET",
                params: {
                  singleEvents: false,
                  showDeleted: true,
                  ...(pageToken === undefined ? {} : { pageToken }),
                },
              })
            ).data,
        )
      ).events,
    listSeriesInstances: async ({ calendarId, eventId, originalStart }) =>
      (
        await listEventPages(async (pageToken) => {
          try {
            return (
              await requester.request<CalendarEventsPage>({
                url: `${eventCollectionUrl(calendarId)}/${encodeURIComponent(eventId)}/instances`,
                method: "GET",
                params: {
                  originalStart,
                  showDeleted: true,
                  ...(pageToken === undefined ? {} : { pageToken }),
                },
              })
            ).data;
          } catch (error) {
            if (isMissingEventError(error)) return { items: [] };
            throw error;
          }
        })
      ).events,
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
  const seenEventIds = new Set<string>();
  let pageToken: string | undefined;
  const seenPageTokens = new Set<string>();
  let pageCount = 0;
  let nextSyncToken: string | undefined;
  do {
    if (pageCount >= 1000)
      throw new OperationalError(
        "operational-failure",
        "Calendar provider page budget 1000 exceeded; coverage is incomplete.",
      );
    pageCount += 1;
    const page = await readPage(pageToken);
    if (
      typeof page !== "object" ||
      page === null ||
      (page.items !== undefined && !Array.isArray(page.items))
    )
      throw new OperationalError(
        "operational-failure",
        "Calendar provider returned an invalid event page.",
      );
    for (const value of page.items ?? []) {
      const event = requireCalendarEvent(value);
      if (seenEventIds.has(event.id))
        throw new OperationalError(
          "operational-failure",
          "Calendar provider repeated an event identity; coverage is incomplete.",
        );
      seenEventIds.add(event.id);
      events.push(event);
    }
    if (events.length > 100000)
      throw new OperationalError(
        "operational-failure",
        "Calendar provider event budget 100000 exceeded; coverage is incomplete.",
      );
    pageToken = checkedNextPageToken(page.nextPageToken, seenPageTokens);
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

function isMissingEventError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const value = error as { code?: unknown; response?: { status?: unknown } };
  return value.code === 404 || value.response?.status === 404;
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
  const seenPageTokens = new Set<string>();
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
    if (
      typeof response.data !== "object" ||
      response.data === null ||
      (response.data.items !== undefined && !Array.isArray(response.data.items))
    )
      throw new OperationalError(
        "operational-failure",
        "Calendar provider returned an invalid Calendar list page.",
      );
    for (const calendar of response.data.items ?? []) {
      if (
        typeof calendar !== "object" ||
        calendar === null ||
        typeof calendar.id !== "string" ||
        calendar.id === "" ||
        typeof calendar.summary !== "string" ||
        (calendar.timeZone !== undefined &&
          typeof calendar.timeZone !== "string")
      )
        throw new OperationalError(
          "operational-failure",
          "Calendar provider returned invalid Calendar metadata.",
        );
      if (calendar.timeZone !== undefined) {
        try {
          new Intl.DateTimeFormat("en", {
            timeZone: calendar.timeZone,
          }).format();
        } catch {
          throw new OperationalError(
            "operational-failure",
            "Calendar provider returned an invalid timezone.",
          );
        }
      }
      calendars.push(calendar);
    }
    if (seenPageTokens.size >= 1000 || calendars.length > 100000)
      throw new OperationalError(
        "operational-failure",
        "Calendar list resource budget exceeded; coverage is incomplete.",
      );
    pageToken = checkedNextPageToken(
      response.data.nextPageToken,
      seenPageTokens,
    );
  } while (pageToken !== undefined);
  return calendars;
}

function requireCalendarEvent(value: unknown): CalendarEvent {
  if (!isCalendarEvent(value))
    throw new OperationalError(
      "operational-failure",
      "Calendar provider returned an invalid event resource.",
    );
  return value;
}
