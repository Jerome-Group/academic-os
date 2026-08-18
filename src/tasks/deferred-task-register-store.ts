import { type LocalConfig, resolveTarget } from "../mounted/index.js";
import { createFileTaskRegisterStore } from "./file-task-register-store.js";
import type { TaskRegisterStore } from "./types.js";

// Resolving a module folder is a Drive read that can fail on its own, so a cohort refresh defers
// it to the moment the register is touched: one unresolvable module reports stale beside the
// modules that refreshed rather than aborting the run before it starts.
export function createDeferredTaskRegisterStore(
  config: LocalConfig,
): TaskRegisterStore {
  let moduleRoot: Promise<string> | undefined;
  const resolved = async (): Promise<TaskRegisterStore> => {
    moduleRoot ??= resolveTarget(config).then((target) => target.moduleRoot);
    return createFileTaskRegisterStore(await moduleRoot);
  };
  return {
    read: async () => await (await resolved()).read(),
    write: async (register) => await (await resolved()).write(register),
  };
}
