import { GoogleAuth } from "google-auth-library";

import type {
  CalendarListEntry,
  CalendarSetupReader,
  CalendarSetupWriter,
} from "./types.js";

export const CALENDAR_LIST_READONLY_SCOPE =
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
export const CALENDAR_PROPERTIES_WRITE_SCOPE =
  "https://www.googleapis.com/auth/calendar.calendars";

const calendarListUrl =
  "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const calendarsUrl = "https://www.googleapis.com/calendar/v3/calendars";

interface CalendarListPage {
  items?: CalendarListEntry[];
  nextPageToken?: string;
}

export interface CalendarHttpRequest {
  url: string;
  method: "GET" | "POST";
  params?: {
    maxResults: 250;
    pageToken?: string;
    showDeleted: false;
    showHidden: true;
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

function defaultRequester(
  credentialPath: string,
  scope: string,
): CalendarRequester {
  return new GoogleAuth({ keyFile: credentialPath, scopes: [scope] });
}
