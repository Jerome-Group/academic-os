import { GoogleAuth } from "google-auth-library";

import { CalendarSyncTokenExpiredError } from "./calendar-refresh-error.js";
import type {
  CalendarEvent,
  CalendarListEntry,
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
    singleEvents?: false;
    timeMin?: string;
    syncToken?: string;
  };
  data?: { summary: string };
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
    listCalendars: async () => {
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
      const events: CalendarEvent[] = [];
      let pageToken: string | undefined;
      let nextSyncToken: string | undefined;
      do {
        let response: { data: CalendarEventsPage };
        try {
          response = await requester.request({
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
        } catch (error) {
          if (syncToken !== undefined && isExpiredSyncTokenError(error)) {
            throw new CalendarSyncTokenExpiredError();
          }
          throw error;
        }
        events.push(...(response.data.items ?? []));
        pageToken = response.data.nextPageToken;
        nextSyncToken = response.data.nextSyncToken ?? nextSyncToken;
      } while (pageToken !== undefined);
      if (nextSyncToken === undefined || nextSyncToken === "") {
        throw new Error("Google Calendar returned no next sync token.");
      }
      return { events, nextSyncToken };
    },
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
  scope: string,
): CalendarRequester {
  return new GoogleAuth({ keyFile: credentialPath, scopes: [scope] });
}
