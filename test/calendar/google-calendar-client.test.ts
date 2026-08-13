import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CALENDAR_LIST_READONLY_SCOPE,
  CALENDAR_PROPERTIES_WRITE_SCOPE,
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
