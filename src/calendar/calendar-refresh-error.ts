export class CalendarSyncTokenExpiredError extends Error {
  constructor() {
    super("The Google Calendar sync token expired.");
    this.name = "CalendarSyncTokenExpiredError";
  }
}
