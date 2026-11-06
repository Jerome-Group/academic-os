import type { ResearchProjectInitialFile } from "../../src/seed/index.js";

export const initialMeetingDirectory =
  "20 Supervisor Meetings/2026-11-06 Initial discussion";
export const initialMeetingNotePath = `${initialMeetingDirectory}/Meeting.md`;
export const initialSchedulePath = "20 Supervisor Meetings/SCHEDULE.md";

export const initialMeetingNote = `---
date: 2026-11-06
participants:
  - Synthetic owner
status: planned
---

# Initial discussion

Exact approved prose: café.
`;

export const initialMeetingSchedule = `# Approved initial schedule

| Date | Folder | State |
| --- | --- | --- |
| 2026-11-06 | \`${initialMeetingDirectory}\` | planned |
`;

export function researchMeetingInitialFiles(): ResearchProjectInitialFile[] {
  return [
    {
      destination: initialSchedulePath,
      encoding: "utf8",
      contents: initialMeetingSchedule,
    },
    {
      destination: initialMeetingNotePath,
      encoding: "utf8",
      contents: initialMeetingNote,
    },
    {
      destination: `${initialMeetingDirectory}/Sources/source.pdf`,
      encoding: "binary",
      contentsBase64: "AP8KgEE=",
    },
    {
      destination: `${initialMeetingDirectory}/10 Learning/records/0001-initial.md`,
      encoding: "utf8",
      contents: "# Initial Learning record\n",
    },
    {
      destination: `${initialMeetingDirectory}/20 Exercises/records/0001-initial.md`,
      encoding: "utf8",
      contents: "# Initial Exercise record\n",
    },
  ];
}
