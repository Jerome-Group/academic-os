import { inventoryMountedModule } from "./inventory-mounted-module.js";
import { readModuleControls } from "./read-module-controls.js";
import type { LocalConfig, MountedAuditInputResult } from "./types.js";

export async function inspectMountedModule(
  config: LocalConfig,
): Promise<MountedAuditInputResult> {
  const mounted = await inventoryMountedModule(config);
  return {
    ...mounted,
    controls: await readModuleControls(mounted.target.moduleRoot),
  };
}
