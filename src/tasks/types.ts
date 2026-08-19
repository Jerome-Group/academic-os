import type { taskStatuses } from "../contract/task-register.js";

export type TaskStatus = (typeof taskStatuses)[number];

export interface TaskProvenance {
  assessment?: string;
  source?: string;
  milestone?: string;
}

export interface TaskRegisterEntry {
  taskId?: string;
  title: string;
  doDate?: string;
  status: TaskStatus;
  notes?: string;
  provenance?: TaskProvenance;
}

export interface TaskRegister {
  // Absent until provisioning binds the module's list: the register is seeded before the list it
  // mirrors exists.
  listId?: string;
  tasks: TaskRegisterEntry[];
}

export interface TaskRegisterStore {
  read(): Promise<TaskRegister | undefined>;
  write(register: TaskRegister): Promise<void>;
}

export interface TaskList {
  id?: string;
  title?: string;
}

export interface LiveTask {
  id: string;
  title?: string;
  notes?: string;
  due?: string;
  status?: "needsAction" | "completed";
  deleted?: boolean;
}

export interface TaskListReader {
  listTaskLists(): Promise<TaskList[]>;
}

export interface TaskListWriter {
  createTaskList(title: string): Promise<{ id: string }>;
}

export interface TaskRefreshReader {
  listTasks(input: { listId: string }): Promise<LiveTask[]>;
}

// The fields of a live task an in-session operation writes, in Google's own vocabulary — the one
// place a Do-date is a `due` and a status is Google's, so every other unit reads the domain's.
export interface LiveTaskFields {
  title?: string;
  notes?: string;
  due?: string;
  status?: "needsAction" | "completed";
}

export interface TaskOperationWriter {
  createTask(input: {
    listId: string;
    task: LiveTaskFields & { title: string };
  }): Promise<{ id: string }>;
  patchTask(input: {
    listId: string;
    taskId: string;
    patch: LiveTaskFields;
  }): Promise<void>;
  readTask(input: {
    listId: string;
    taskId: string;
  }): Promise<LiveTask | undefined>;
  deleteTask(input: { listId: string; taskId: string }): Promise<void>;
}

// Cancel deletes the task in Google, which the next pull mirrors as a cancelled row: the register
// never drops a task it tracked, and nothing here re-pushes one Google has already forgotten.
export type TaskOperation =
  | {
      name: "create";
      title: string;
      doDate?: string;
      notes?: string;
      provenance?: TaskProvenance;
    }
  | {
      name: "change";
      taskId: string;
      title?: string;
      doDate?: string;
      notes?: string;
    }
  | { name: "complete"; taskId: string }
  | { name: "cancel"; taskId: string };

export type TaskOperationName = TaskOperation["name"];

// `parked` is the push Google refused — the live list is as it was, and the register kept no row
// for it. `unverified` is the push Google took whose live result then read back wrong: the list
// has moved, so the operation is not parked, and a pull is what settles what it now holds.
export interface TaskOperationReport {
  schemaVersion: 1;
  command: `tasks ${TaskOperationName}`;
  outcome: "applied" | "unverified" | "parked";
  module: ConfiguredModuleIdentity;
  taskId: string | null;
  register: TaskRefreshModuleReport | null;
  failure?: {
    code: string;
    message: string;
  };
}

export interface TaskRegisterReadReport {
  schemaVersion: 1;
  command: "tasks read-register";
  outcome: "read" | "stale";
  module: ConfiguredModuleIdentity;
  register: TaskRefreshModuleReport;
  tasks: TaskRegisterEntry[];
}

export interface TaskRegisterChanges {
  added: number;
  updated: number;
  cancelled: number;
}

export interface TaskProvisionReport {
  schemaVersion: 1;
  command: "tasks provision";
  outcome: "provisioned" | "preview";
  module: ConfiguredModuleIdentity;
  list: {
    title: string;
    action: "bound" | "adopted" | "created" | "would-adopt" | "would-create";
    listId: string | null;
  };
  register: "written" | "not-written";
}

export interface ConfiguredModuleIdentity {
  semester: string;
  module: string;
}

export interface TaskRefreshReport {
  schemaVersion: 1;
  command: "tasks refresh";
  outcome: "refreshed" | "partially-refreshed" | "stale";
  modules: TaskRefreshModuleReport[];
}

export interface TaskRefreshModuleReport extends ConfiguredModuleIdentity {
  freshness: "fresh" | "stale";
  listId: string | null;
  counts: TaskRegisterCounts;
  changes: TaskRegisterChanges;
  failure?: {
    code: string;
    message: string;
  };
}

export interface TaskRegisterCounts {
  tasks: number;
  open: number;
  completed: number;
  cancelled: number;
  unpushed: number;
}
