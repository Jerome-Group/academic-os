import { inventoryMountedModule } from "./inventory-mounted-module.js";
import { readControls, type ControlRead } from "../controls/index.js";
import { moduleControlPaths } from "../conformance/control-paths.js";
import { OperationalError } from "../operational-error.js";
import { observeModuleControls } from "./observe-module-controls.js";
import type { LocalConfig, MountedAuditInputResult } from "./types.js";

export async function inspectMountedModule(
  config: LocalConfig,
  options: { controls: "any" | "legacy" } = { controls: "legacy" },
): Promise<MountedAuditInputResult & { controlRead: ControlRead }> {
  const mounted = await inventoryMountedModule(config);
  const controlRead = readControls({
    moduleCode: mounted.target.module,
    files: await observeModuleControls(
      mounted.target.moduleRoot,
      mounted.inventory,
    ),
  });
  const legacyPaths = new Set<string>(Object.values(moduleControlPaths));
  const unreadableLegacy =
    controlRead.kind === "legacy"
      ? controlRead.diagnostics.find(
          (item) =>
            ["invalid-legacy-utf8", "legacy-control-read-failure"].includes(
              item.code,
            ) && legacyPaths.has(item.path),
        )
      : undefined;
  if (unreadableLegacy !== undefined)
    throw new OperationalError(
      "operational-failure",
      `Control cannot be read: ${unreadableLegacy.path}.`,
    );
  if (controlRead.kind !== "legacy" && options.controls === "legacy") {
    throw new OperationalError(
      "invalid-target",
      `Canonical controls require module inspect; legacy audit and mutation coverage are unavailable. ${controlRead.diagnostics.map((item) => `${item.code} at ${item.path}: ${item.message} ${item.remediation}`).join(" ")}`,
    );
  }
  const documents = controlRead.kind === "legacy" ? controlRead.documents : [];
  const controls = Object.fromEntries(
    Object.entries(moduleControlPaths).flatMap(([name, path]) => {
      const document = documents.find((document) => document.path === path);
      return document === undefined ? [] : [[name, document.source]];
    }),
  );
  return { ...mounted, controls, controlRead };
}
