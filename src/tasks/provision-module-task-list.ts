import { OperationalError } from "../operational-error.js";
import type {
  ConfiguredModuleIdentity,
  TaskListReader,
  TaskListWriter,
  TaskProvisionReport,
  TaskRegister,
  TaskRegisterStore,
} from "./types.js";

// The persisted list ID is the module's task-list identity; a title is only ever how a list is
// found the first time, and never how it is resolved again.
export async function provisionModuleTaskList(input: {
  module: ConfiguredModuleIdentity;
  reader: TaskListReader;
  writer: TaskListWriter;
  registerStore: TaskRegisterStore;
  apply: boolean;
}): Promise<TaskProvisionReport> {
  const title = input.module.module;
  const register = await input.registerStore.read();
  const lists = await input.reader.listTaskLists();
  const boundList =
    register === undefined
      ? undefined
      : lists.find(({ id }) => id === register.listId);
  if (register !== undefined && boundList === undefined) {
    throw new OperationalError(
      "missing-target",
      `The Task register for ${title} names a task list Google does not have: ${register.listId}.`,
    );
  }
  if (register !== undefined && boundList !== undefined) {
    return report({
      module: input.module,
      outcome: "provisioned",
      title,
      action: "bound",
      listId: register.listId,
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
    return report({
      module: input.module,
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
  await input.registerStore.write(emptyRegister(listId));
  return report({
    module: input.module,
    outcome: "provisioned",
    title,
    action: adopted === undefined ? "created" : "adopted",
    listId,
    register: "written",
  });
}

function emptyRegister(listId: string): TaskRegister {
  return { listId, tasks: [] };
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

function report(input: {
  module: ConfiguredModuleIdentity;
  outcome: TaskProvisionReport["outcome"];
  title: string;
  action: TaskProvisionReport["list"]["action"];
  listId: string | null;
  register: TaskProvisionReport["register"];
}): TaskProvisionReport {
  return {
    schemaVersion: 1,
    command: "tasks provision",
    outcome: input.outcome,
    module: input.module,
    list: { title: input.title, action: input.action, listId: input.listId },
    register: input.register,
  };
}
