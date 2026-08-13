import { readFile, writeFile } from "node:fs/promises";

import { GoogleAuth } from "google-auth-library";

interface FakeCalendar {
  id: string;
  primary?: boolean;
  summary: string;
}

interface FakeCalendarState {
  calendars: FakeCalendar[];
  eventReadFailures?: string[];
  eventPageSizes?: Record<string, number>;
  eventPageFailures?: Record<string, string[]>;
  events?: Record<string, unknown[]>;
  expiredSyncTokens?: string[];
  incrementalEvents?: Record<string, Record<string, unknown[]>>;
  nextSyncTokens?: Record<string, string>;
  nextId?: number;
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
    const calendar = { id, summary: body.summary ?? "" };
    state.calendars.push(calendar);
    await writeFile(statePath, `${JSON.stringify(state)}\n`);
    return { data: calendar };
  }

  const eventsMatch = options.url?.match(
    /^https:\/\/www\.googleapis\.com\/calendar\/v3\/calendars\/([^/]+)\/events$/u,
  );
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
    const events =
      params?.syncToken === undefined
        ? (state.events?.[calendarId] ?? [])
        : (state.incrementalEvents?.[calendarId]?.[params.syncToken] ?? []);
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
