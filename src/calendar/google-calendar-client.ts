import { GoogleAuth } from "google-auth-library";

import { CalendarSyncTokenExpiredError } from "./calendar-refresh-error.js";
import type {
  CalendarEvent,
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
  method: "GET" | "POST";
  params?: {
    maxResults?: 250;
    pageToken?: string;
    showDeleted?: boolean;
    showHidden?: true;
    singleEvents?: boolean;
    timeMax?: string;
    timeMin?: string;
    syncToken?: string;
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
  };
}

function eventCollectionUrl(calendarId: string): string {
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
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
