import { type LocalConfig, resolveTarget } from "../mounted/index.js";
import { taskRegisterPath } from "../contract/task-register.js";
import { createFileTaskRegisterStore } from "./file-task-register-store.js";
import type { TaskRegisterProvenance, TaskRegisterStore } from "./types.js";

// Resolving a module folder is a Drive read that can fail on its own, so a cohort refresh defers
// it to the moment the register is touched: one unresolvable module reports stale beside the
// modules that refreshed rather than aborting the run before it starts.
export function createDeferredTaskRegisterStore(
  config: LocalConfig,
): TaskRegisterStore {
  return createDeferredPathTaskRegisterStore({
    resolveRoot: async () => (await resolveTarget(config)).moduleRoot,
    registerPath: taskRegisterPath,
  });
}

export function createDeferredPathTaskRegisterStore(input: {
  resolveRoot(): Promise<string>;
  registerPath: string;
  provenanceKeys?: readonly (keyof TaskRegisterProvenance)[];
}): TaskRegisterStore {
  let targetRoot: Promise<string> | undefined;
  const resolved = async (): Promise<TaskRegisterStore> => {
    targetRoot ??= input.resolveRoot();
    return createFileTaskRegisterStore(
      await targetRoot,
      input.registerPath,
      input.provenanceKeys,
    );
  };
  return {
    read: async () => await (await resolved()).read(),
    write: async (register) => await (await resolved()).write(register),
  };
}
