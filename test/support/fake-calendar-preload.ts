import { readFile, writeFile } from "node:fs/promises";

import { GoogleAuth } from "google-auth-library";

interface FakeCalendar {
  id: string;
  primary?: boolean;
  summary: string;
}

interface FakeCalendarState {
  calendars: FakeCalendar[];
  nextId?: number;
  requests?: Array<{
    body?: unknown;
    credential?: string;
    method?: string;
    scopes?: string[];
    url?: string;
  }>;
}

interface RequestOptions {
  url?: string;
  method?: string;
  data?: unknown;
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

  throw new Error(`Unexpected synthetic Calendar request: ${options.url}.`);
};
