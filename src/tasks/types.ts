export type TaskStatus = "open" | "completed" | "cancelled";

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
  listId: string;
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
