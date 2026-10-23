import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CalendarSyncTokenExpiredError,
  CALENDAR_LIST_READONLY_SCOPE,
  CALENDAR_PROPERTIES_WRITE_SCOPE,
  createGoogleCalendarRefreshReader,
  createGoogleCalendarPromotionWriter,
  createGoogleCalendarProposalReader,
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

describe("Google Calendar Promotion adapter", () => {
  it("maps exact patch and move requests", async () => {
    const requests: CalendarHttpRequest[] = [];
    const requester: CalendarRequester = {
      request: async <T>(request: CalendarHttpRequest) => {
        requests.push(request);
        return { data: { id: "event/id" } as T };
      },
    };
    const writer = createGoogleCalendarPromotionWriter(
      "/private/write",
      requester,
    );
    await writer.patchEvent({
      calendarId: "source/id",
      eventId: "event/id",
      patch: { summary: "Changed" },
    });
    await writer.patchEvent({
      calendarId: "source/id",
      eventId: "rich/event",
      patch: {
        attachments: [{ fileUrl: "https://example.invalid/file" }],
        conferenceData: { createRequest: { requestId: "conference" } },
      },
    });
    await writer.moveEvent({
      sourceCalendarId: "source/id",
      targetCalendarId: "target/id",
      eventId: "event/id",
    });
    assert.deepEqual(requests, [
      {
        url: "https://www.googleapis.com/calendar/v3/calendars/source%2Fid/events/event%2Fid",
        method: "PATCH",
        data: { summary: "Changed" },
      },
      {
        url: "https://www.googleapis.com/calendar/v3/calendars/source%2Fid/events/rich%2Fevent",
        method: "PATCH",
        data: {
          attachments: [{ fileUrl: "https://example.invalid/file" }],
          conferenceData: { createRequest: { requestId: "conference" } },
        },
        params: { supportsAttachments: true, conferenceDataVersion: 1 },
      },
      {
        url: "https://www.googleapis.com/calendar/v3/calendars/source%2Fid/events/event%2Fid/move",
        method: "POST",
        params: { destination: "target/id" },
      },
    ]);
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

describe("Google Calendar source observation", () => {
  it("rejects exact reads whose resource identity differs from the request", async () => {
    const requester: CalendarRequester = {
      request: async <T>() => ({ data: { id: "different" } as T }),
    };
    const reader = createGoogleCalendarProposalReader("unused", requester);
    const writer = createGoogleCalendarPromotionWriter("unused", requester);
    assert.ok(reader.readEvent);
    for (const read of [reader.readEvent, writer.readEvent])
      await assert.rejects(
        read({ calendarId: "owned", eventId: "expected" }),
        /identity/u,
      );
  });
  it("refuses malformed calendar visibility metadata rather than silently dropping a participant", async () => {
    for (const field of ["selected", "hidden", "primary"]) {
      const reader = createGoogleCalendarProposalReader("unused", {
        request: async <T>() => ({
          data: {
            items: [{ id: "calendar", summary: "Calendar", [field]: "true" }],
          } as T,
        }),
      });
      await assert.rejects(
        reader.listCalendars(),
        /invalid Calendar metadata/u,
      );
    }
  });
  it("exhausts stored-resource pages including an empty middle page without a time clamp", async () => {
    const requests: CalendarHttpRequest[] = [];
    const requester: CalendarRequester = {
      request: async <T>(request: CalendarHttpRequest) => {
        requests.push(request);
        const data =
          request.params?.pageToken === undefined
            ? {
                items: [
                  { id: "master", recurrence: ["RRULE:FREQ=WEEKLY;COUNT=2"] },
                ],
                nextPageToken: "empty",
              }
            : request.params.pageToken === "empty"
              ? { items: [], nextPageToken: "last" }
              : {
                  items: [
                    {
                      id: "cancelled",
                      status: "cancelled",
                      recurringEventId: "master",
                      originalStartTime: {
                        dateTime: "2026-10-12T10:00:00+08:00",
                      },
                    },
                  ],
                };
        return { data: data as T };
      },
    };
    const reader = createGoogleCalendarProposalReader("unused", requester);
    assert.ok(reader.listStoredEvents);
    const events = await reader.listStoredEvents({ calendarId: "source/id" });
    assert.deepEqual(
      events.map(({ id }) => id),
      ["master", "cancelled"],
    );
    assert.equal(events[1]?.start, undefined);
    assert.equal(requests.length, 3);
    assert.ok(
      requests.every(
        ({ method, params }) =>
          method === "GET" &&
          params?.singleEvents === false &&
          params.showDeleted === true &&
          params.timeMin === undefined &&
          params.timeMax === undefined,
      ),
    );
  });
  it("fully paginates an exact original-start replacement selector", async () => {
    const requests: CalendarHttpRequest[] = [];
    const reader = createGoogleCalendarProposalReader("unused", {
      request: async <T>(request: CalendarHttpRequest) => {
        requests.push(request);
        return {
          data: (request.params?.pageToken === undefined
            ? { items: [], nextPageToken: "last" }
            : {
                items: [
                  {
                    id: "replacement",
                    recurringEventId: "future",
                    originalStartTime: {
                      dateTime: "2026-10-12T10:00:00+08:00",
                    },
                  },
                ],
              }) as T,
        };
      },
    });
    assert.ok(reader.listSeriesInstances);
    const events = await reader.listSeriesInstances({
      calendarId: "target/id",
      eventId: "future",
      originalStart: "2026-10-12T02:00:00Z",
    });
    assert.equal(events[0]?.id, "replacement");
    assert.equal(requests.length, 2);
    assert.ok(
      requests.every(
        ({ method, params }) =>
          method === "GET" &&
          params?.originalStart === "2026-10-12T02:00:00Z" &&
          params.showDeleted === true,
      ),
    );
  });
});

it("refuses cycling and empty Calendar pagination tokens before a third request", async () => {
  for (const token of ["repeat", "", null, 42]) {
    for (const kind of ["calendars", "events"]) {
      let calls = 0;
      const requester: CalendarRequester = {
        request: async <T>() => {
          calls += 1;
          if (calls > 3) throw new Error("fixture loop limit");
          return {
            data: {
              items: [],
              nextPageToken: token,
              nextSyncToken: "synthetic-sync",
            } as T,
          };
        },
      };
      const pull =
        kind === "calendars"
          ? () =>
              createGoogleCalendarSetupReader(
                "/private/synthetic",
                requester,
              ).listCalendars()
          : () =>
              createGoogleCalendarRefreshReader(
                "/private/synthetic",
                requester,
              ).listEventChanges({
                calendarId: "synthetic",
                managementHorizon: "2026-01-01",
              });
      await assert.rejects(pull, /invalid or repeated pagination token/u);
      assert.equal(calls, token === "repeat" ? 2 : 1);
    }
  }
});
