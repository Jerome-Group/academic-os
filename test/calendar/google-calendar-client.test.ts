import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CalendarSyncTokenExpiredError,
  CALENDAR_LIST_READONLY_SCOPE,
  CALENDAR_PROPERTIES_WRITE_SCOPE,
  createGoogleCalendarRefreshReader,
  createGoogleCalendarPromotionWriter,
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

describe("recurring Calendar split adapter", () => {
  const splitInput = {
    sourceCalendarId: "source",
    targetCalendarId: "target",
    recurringEventId: "master",
    instanceId: "instance",
    recurringMaster: {
      id: "master",
      recurrence: ["RRULE:FREQ=DAILY;COUNT=400"],
    },
    patch: {
      start: {
        dateTime: "2026-10-01T11:00:00+08:00",
        timeZone: "Asia/Singapore",
      },
      end: {
        dateTime: "2026-10-01T12:00:00+08:00",
        timeZone: "Asia/Singapore",
      },
    },
    idempotencyKey: "synthetic-split",
    exceptions: [],
  };
  const instance = {
    id: "instance",
    start: { dateTime: "2026-10-01T09:00:00+08:00" },
    end: { dateTime: "2026-10-01T10:00:00+08:00" },
  };

  it("counts every predecessor page and preserves the requested future start and end", async () => {
    const requests: CalendarHttpRequest[] = [];
    const requester: CalendarRequester = {
      request: async <T>(request: CalendarHttpRequest) => {
        requests.push(request);
        if (
          request.method === "GET" &&
          !request.url.endsWith("/instance") &&
          !request.url.endsWith("/instances")
        )
          throw { response: { status: 404 } };
        return {
          data: (request.url.endsWith("/instance")
            ? instance
            : request.url.endsWith("/instances")
              ? request.params?.pageToken === undefined
                ? {
                    items: Array.from({ length: 250 }, (_, index) => ({
                      id: `prior-${index}`,
                      originalStartTime: {
                        dateTime: "2026-09-01T09:00:00+08:00",
                      },
                    })),
                    nextPageToken: "next",
                  }
                : {
                    items: [
                      {
                        id: "deleted",
                        status: "cancelled",
                        originalStartTime: {
                          dateTime: "2026-09-01T09:00:00+08:00",
                        },
                      },
                      {
                        id: "previous",
                        originalStartTime: {
                          dateTime: "2026-09-01T09:00:00+08:00",
                        },
                      },
                    ],
                  }
              : {}) as T,
        };
      },
    };
    await createGoogleCalendarPromotionWriter(
      "unused",
      requester,
    ).splitRecurringEvent(splitInput);
    const instanceRequests = requests.filter((request) =>
      request.url.endsWith("/instances"),
    );
    assert.equal(instanceRequests.length, 2);
    assert.equal(instanceRequests[1]?.params?.pageToken, "next");
    assert.equal(instanceRequests[0]?.params?.showDeleted, true);
    const created = requests.find((request) => request.method === "POST")?.data;
    assert.deepEqual(created?.recurrence, ["RRULE:FREQ=DAILY;COUNT=148"]);
    assert.deepEqual(created?.start, splitInput.patch.start);
    assert.deepEqual(created?.end, splitInput.patch.end);
  });

  it("does not trim or create a series after an inconclusive existence check", async () => {
    for (const status of [403, 503]) {
      const requests: CalendarHttpRequest[] = [];
      const requester: CalendarRequester = {
        request: async (request) => {
          requests.push(request);
          throw { response: { status } };
        },
      };
      await assert.rejects(
        createGoogleCalendarPromotionWriter(
          "unused",
          requester,
        ).splitRecurringEvent(splitInput),
      );
      assert.equal(requests.length, 1);
      assert.equal(requests[0]?.method, "GET");
    }
  });

  it("validates the future occurrence count before trimming the source", async () => {
    const requests: CalendarHttpRequest[] = [];
    const requester: CalendarRequester = {
      request: async <T>(request: CalendarHttpRequest) => {
        requests.push(request);
        if (
          !request.url.endsWith("/instance") &&
          !request.url.endsWith("/instances")
        )
          throw { response: { status: 404 } };
        return {
          data: (request.url.endsWith("/instance")
            ? instance
            : {
                items: [
                  {
                    id: "first",
                    originalStartTime: {
                      dateTime: "2026-09-01T09:00:00+08:00",
                    },
                  },
                ],
              }) as T,
        };
      },
    };
    await assert.rejects(
      createGoogleCalendarPromotionWriter(
        "unused",
        requester,
      ).splitRecurringEvent({
        ...splitInput,
        recurringMaster: {
          id: "master",
          recurrence: ["RRULE:FREQ=DAILY;COUNT=1"],
        },
      }),
      /no future occurrences/u,
    );
    assert.equal(
      requests.some((request) => request.method !== "GET"),
      false,
    );
  });

  it("counts original anchors rather than moved instance start times", async () => {
    const requests: CalendarHttpRequest[] = [];
    const requester: CalendarRequester = {
      request: async <T>(request: CalendarHttpRequest) => {
        requests.push(request);
        if (
          request.method === "GET" &&
          !request.url.endsWith("/instance") &&
          !request.url.endsWith("/instances")
        )
          throw { response: { status: 404 } };
        return {
          data: (request.url.endsWith("/instance")
            ? instance
            : request.url.endsWith("/instances")
              ? {
                  items: [
                    {
                      id: "moved-after",
                      originalStartTime: {
                        dateTime: "2026-09-30T09:00:00+08:00",
                      },
                      start: { dateTime: "2026-10-02T09:00:00+08:00" },
                    },
                    {
                      id: "moved-before",
                      originalStartTime: {
                        dateTime: "2026-10-02T09:00:00+08:00",
                      },
                      start: { dateTime: "2026-09-30T09:00:00+08:00" },
                    },
                    { ...instance, originalStartTime: instance.start },
                  ],
                }
              : {}) as T,
        };
      },
    };
    await createGoogleCalendarPromotionWriter(
      "unused",
      requester,
    ).splitRecurringEvent({
      ...splitInput,
      recurringMaster: {
        id: "master",
        recurrence: ["RRULE:FREQ=DAILY;COUNT=3"],
      },
    });
    assert.equal(
      requests.find((request) => request.url.endsWith("/instances"))?.params
        ?.timeMax,
      undefined,
    );
    assert.deepEqual(
      requests.find((request) => request.method === "POST")?.data?.recurrence,
      ["RRULE:FREQ=DAILY;COUNT=2"],
    );
  });

  it("uses an explicit replacement recurrence and skips obsolete predecessor counting", async () => {
    const requests: CalendarHttpRequest[] = [];
    const requester: CalendarRequester = {
      request: async <T>(request: CalendarHttpRequest) => {
        requests.push(request);
        if (request.method === "GET" && !request.url.endsWith("/instance"))
          throw { response: { status: 404 } };
        return {
          data: (request.url.endsWith("/instance") ? instance : {}) as T,
        };
      },
    };
    const recurrence = ["RRULE:FREQ=WEEKLY;COUNT=12"];
    await createGoogleCalendarPromotionWriter(
      "unused",
      requester,
    ).splitRecurringEvent({ ...splitInput, patch: { recurrence } });
    assert.deepEqual(
      requests.find((request) => request.method === "POST")?.data?.recurrence,
      recurrence,
    );
    assert.equal(
      requests.some((request) => request.url.endsWith("/instances")),
      false,
    );
  });

  it("refuses unsupported recurrence combinations before sending requests", async () => {
    let requests = 0;
    const requester: CalendarRequester = {
      request: async () => {
        requests += 1;
        return { data: {} as never };
      },
    };
    for (const recurrence of [
      ["RRULE:FREQ=DAILY;COUNT=10", "RRULE:FREQ=WEEKLY;COUNT=5"],
      ["RRULE:FREQ=DAILY;COUNT=10", "RDATE:20261004T010000Z"],
      ["RRULE:FREQ=DAILY;COUNT=10", "EXDATE:20261004T010000Z"],
      ["RRULE:FREQ=DAILY", "RRULE:FREQ=WEEKLY"],
      ["RRULE:FREQ=DAILY", "RDATE:20261004T010000Z"],
      ["RRULE:FREQ=DAILY", "EXDATE:20261004T010000Z"],
      ["RDATE:20261004T010000Z"],
    ]) {
      await assert.rejects(
        createGoogleCalendarPromotionWriter(
          "unused",
          requester,
        ).splitRecurringEvent({
          ...splitInput,
          recurringMaster: { id: "master", recurrence },
        }),
        /Recurring splits require one RRULE/u,
      );
    }
    assert.equal(requests, 0);
  });

  it("skips predecessor reads when no rule has COUNT", async () => {
    const requests: CalendarHttpRequest[] = [];
    const requester: CalendarRequester = {
      request: async <T>(request: CalendarHttpRequest) => {
        requests.push(request);
        if (request.method === "GET" && !request.url.endsWith("/instance"))
          throw { response: { status: 404 } };
        return {
          data: (request.url.endsWith("/instance") ? instance : {}) as T,
        };
      },
    };
    await createGoogleCalendarPromotionWriter(
      "unused",
      requester,
    ).splitRecurringEvent({
      ...splitInput,
      recurringMaster: { id: "master", recurrence: ["RRULE:FREQ=DAILY"] },
    });
    assert.equal(
      requests.some((request) => request.url.endsWith("/instances")),
      false,
    );
  });

  it("refuses exception-anchor changes before sending requests", async () => {
    let requests = 0;
    const requester: CalendarRequester = {
      request: async () => {
        requests += 1;
        return { data: {} as never };
      },
    };
    await assert.rejects(
      createGoogleCalendarPromotionWriter(
        "unused",
        requester,
      ).splitRecurringEvent({
        ...splitInput,
        exceptions: [{ id: "retained-exception" }],
      }),
      /cannot change its start or recurrence/u,
    );
    assert.equal(requests, 0);
  });

  it("recovers a disappeared split occurrence from its bound snapshot only for a missing response", async () => {
    for (const status of [404, 503]) {
      const requests: CalendarHttpRequest[] = [];
      const requester: CalendarRequester = {
        request: async <T>(request: CalendarHttpRequest) => {
          requests.push(request);
          if (request.method === "GET")
            throw {
              response: {
                status: request.url.endsWith("/instance") ? status : 404,
              },
            };
          return { data: {} as T };
        },
      };
      const writer = createGoogleCalendarPromotionWriter("unused", requester);
      const input = {
        ...splitInput,
        occurrence: instance,
        recurringMaster: { id: "master", recurrence: ["RRULE:FREQ=DAILY"] },
      };
      if (status === 404) {
        await writer.splitRecurringEvent(input);
        assert.deepEqual(
          requests.find((request) => request.method === "POST")?.data?.start,
          splitInput.patch.start,
        );
      } else {
        await assert.rejects(writer.splitRecurringEvent(input));
        assert.equal(
          requests.some((request) => request.method !== "GET"),
          false,
        );
      }
    }
  });
});
