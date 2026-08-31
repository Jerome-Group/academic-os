import { OperationalError } from "../operational-error.js";
import type {
  ConfiguredModuleIdentity,
  TaskListReader,
  TaskListWriter,
  TaskProvisionReport,
  TaskRegisterStore,
  TaskTargetIdentity,
  TaskTargetProvisionReport,
} from "./types.js";

// The persisted list ID is a target's task-list identity; a title is only ever how a list is found
// the first time, and never how it is resolved again.
export async function provisionTaskList(input: {
  target: TaskTargetIdentity;
  reader: TaskListReader;
  writer: TaskListWriter;
  registerStore: TaskRegisterStore;
  apply: boolean;
}): Promise<TaskTargetProvisionReport> {
  const title = input.target.title;
  const register = await input.registerStore.read();
  const lists = await input.reader.listTaskLists();
  // Seeding writes the register before the list exists, so the header's ID — and never the file —
  // is what says the target is already bound. Without one, provisioning runs as it does for a
  // target with no register at all, and fills the skeleton it finds.
  const boundListId = register?.listId;
  if (boundListId !== undefined) {
    if (!lists.some(({ id }) => id === boundListId)) {
      throw new OperationalError(
        "missing-target",
        `The Task register for ${title} names a task list Google does not have: ${boundListId}.`,
      );
    }
    return targetReport({
      target: input.target,
      outcome: "provisioned",
      title,
      action: "bound",
      listId: boundListId,
      register: "not-written",
    });
  }

  const named = lists.filter((list) => list.title === title);
  if (named.length > 1) {
    throw new OperationalError(
      "ambiguous-target",
      `Task-list provisioning found ${named.length} lists titled ${title}.`,
    );
  }
  const adopted = named[0];
  if (!input.apply) {
    return targetReport({
      target: input.target,
      outcome: "preview",
      title,
      action: adopted === undefined ? "would-create" : "would-adopt",
      listId: adopted === undefined ? null : requireListId(adopted, title),
      register: "not-written",
    });
  }
  const listId =
    adopted === undefined
      ? (await input.writer.createTaskList(title)).id
      : requireListId(adopted, title);
  await input.registerStore.write({ listId, tasks: register?.tasks ?? [] });
  return targetReport({
    target: input.target,
    outcome: "provisioned",
    title,
    action: adopted === undefined ? "created" : "adopted",
    listId,
    register: "written",
  });
}

// The module entry point is a compatibility adapter: its arguments and JSON report stay the v1
// shape while the provisioning rule itself no longer knows what kind of academic target it serves.
export async function provisionModuleTaskList(input: {
  module: ConfiguredModuleIdentity;
  reader: TaskListReader;
  writer: TaskListWriter;
  registerStore: TaskRegisterStore;
  apply: boolean;
}): Promise<TaskProvisionReport> {
  const target = await provisionTaskList({
    target: {
      kind: "module",
      key: `${input.module.semester}/${input.module.module}`,
      title: input.module.module,
    },
    reader: input.reader,
    writer: input.writer,
    registerStore: input.registerStore,
    apply: input.apply,
  });
  return {
    schemaVersion: 1,
    command: "tasks provision",
    outcome: target.outcome,
    module: input.module,
    list: target.list,
    register: target.register,
  };
}

function requireListId(list: { id?: string }, title: string): string {
  if (typeof list.id !== "string" || list.id === "") {
    throw new OperationalError(
      "invalid-target",
      `Task-list provisioning found no provider ID for ${title}.`,
    );
  }
  return list.id;
}

function targetReport(input: {
  target: TaskTargetIdentity;
  outcome: TaskProvisionReport["outcome"];
  title: string;
  action: TaskProvisionReport["list"]["action"];
  listId: string | null;
  register: TaskProvisionReport["register"];
}): TaskTargetProvisionReport {
  return {
    target: input.target,
    outcome: input.outcome,
    list: { title: input.title, action: input.action, listId: input.listId },
    register: input.register,
  };
}
