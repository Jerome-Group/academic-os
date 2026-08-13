import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CalendarSyncTokenExpiredError,
  CALENDAR_LIST_READONLY_SCOPE,
  CALENDAR_PROPERTIES_WRITE_SCOPE,
  createGoogleCalendarRefreshReader,
  createGoogleCalendarSetupReader,
  createGoogleCalendarSetupWriter,
  type CalendarHttpRequest,
  type CalendarRequester,
} from "../../src/calendar/index.js";

describe("Google Calendar setup adapter", () => {
  it("maps paginated CalendarList reads and secondary-calendar creation", async () => {
    const requests: CalendarHttpRequest[] = [];
    const requester: CalendarRequester = {
      request: async <T>(request: CalendarHttpRequest) => {
        requests.push(request);
        if (request.method === "POST") {
          return { data: { id: "created-id" } as T };
        }
        return {
          data: (request.params?.pageToken === undefined
            ? {
                items: [
                  { id: "primary-id", summary: "Personal", primary: true },
                ],
                nextPageToken: "next",
              }
            : { items: [{ id: "routine-id", summary: "Routine" }] }) as T,
        };
      },
    };
    const reader = createGoogleCalendarSetupReader("/private/read", requester);
    const writer = createGoogleCalendarSetupWriter("/private/write", requester);

    assert.deepEqual(await reader.listCalendars(), [
      { id: "primary-id", summary: "Personal", primary: true },
      { id: "routine-id", summary: "Routine" },
    ]);
    assert.deepEqual(await writer.createCalendar("Commitments"), {
      id: "created-id",
    });
    assert.deepEqual(requests, [
      {
        url: "https://www.googleapis.com/calendar/v3/users/me/calendarList",
        method: "GET",
        params: {
          maxResults: 250,
          showDeleted: false,
          showHidden: true,
        },
      },
      {
        url: "https://www.googleapis.com/calendar/v3/users/me/calendarList",
        method: "GET",
        params: {
          maxResults: 250,
          showDeleted: false,
          showHidden: true,
          pageToken: "next",
        },
      },
      {
        url: "https://www.googleapis.com/calendar/v3/calendars",
        method: "POST",
        data: { summary: "Commitments" },
      },
    ]);
    assert.equal(
      CALENDAR_LIST_READONLY_SCOPE,
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    );
    assert.equal(
      CALENDAR_PROPERTIES_WRITE_SCOPE,
      "https://www.googleapis.com/auth/calendar.calendars",
    );
  });
});

describe("Google Calendar Refresh adapter", () => {
  it("maps full and incremental pagination and publishes only the final sync token", async () => {
    const requests: CalendarHttpRequest[] = [];
    const requester: CalendarRequester = {
      request: async <T>(request: CalendarHttpRequest) => {
        requests.push(request);
        return {
          data: (request.params?.pageToken === undefined
            ? {
                items: [{ id: "first" }],
                nextPageToken: "next-page",
              }
            : {
                items: [{ id: "second" }],
                nextSyncToken: "next-sync",
              }) as T,
        };
      },
    };
    const reader = createGoogleCalendarRefreshReader(
      "/private/read",
      requester,
    );

    assert.deepEqual(
      await reader.listEventChanges({
        calendarId: "calendar/id",
        managementHorizon: "2026-08-01T00:00:00.000Z",
        syncToken: "current-sync",
      }),
      {
        events: [{ id: "first" }, { id: "second" }],
        nextSyncToken: "next-sync",
      },
    );
    assert.deepEqual(requests, [
      {
        url: "https://www.googleapis.com/calendar/v3/calendars/calendar%2Fid/events",
        method: "GET",
        params: {
          singleEvents: false,
          showDeleted: true,
          syncToken: "current-sync",
        },
      },
      {
        url: "https://www.googleapis.com/calendar/v3/calendars/calendar%2Fid/events",
        method: "GET",
        params: {
          singleEvents: false,
          showDeleted: true,
          syncToken: "current-sync",
          pageToken: "next-page",
        },
      },
    ]);
  });

  it("classifies provider status 410 as an expired sync token", async () => {
    const requester: CalendarRequester = {
      request: async () => {
        throw { response: { status: 410 } };
      },
    };
    const reader = createGoogleCalendarRefreshReader(
      "/private/read",
      requester,
    );

    await assert.rejects(
      reader.listEventChanges({
        calendarId: "calendar-id",
        managementHorizon: "2026-08-01T00:00:00.000Z",
        syncToken: "expired-sync",
      }),
      CalendarSyncTokenExpiredError,
    );
  });
});
