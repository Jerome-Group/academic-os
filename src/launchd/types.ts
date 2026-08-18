export interface LaunchdCalendarIntervalSchedule {
  kind: "calendar-interval";
  hour: number;
  minute: number;
  timeZone: string;
}

export interface LaunchdKeepAliveSchedule {
  kind: "keep-alive";
}

export type LaunchdSchedule =
  | LaunchdCalendarIntervalSchedule
  | LaunchdKeepAliveSchedule;

export interface LaunchdJobDescription {
  name: string;
  programArguments: string[];
  schedule: LaunchdSchedule;
  standardOutPath: string;
  standardErrorPath: string;
}

export interface LaunchdJobTarget {
  label: string;
  plistPath: string;
  domainTarget: string;
  serviceTarget: string;
}

export interface LaunchdJobPlan extends LaunchdJobTarget {
  programArguments: string[];
  schedule: LaunchdSchedule;
  runAtLoad: boolean;
  standardOutPath: string;
  standardErrorPath: string;
  plist: string;
}
