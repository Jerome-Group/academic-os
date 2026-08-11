import type { Inventory, InventoryEntry } from "./types.js";

export function directChildEntries(
  inventory: Inventory,
  parent: string,
): InventoryEntry[] {
  const prefix = `${parent}/`;
  return inventory.entries.filter(
    ({ path }) =>
      path.startsWith(prefix) && !path.slice(prefix.length).includes("/"),
  );
}

export function directChildren(inventory: Inventory, parent: string): string[] {
  return directChildEntries(inventory, parent)
    .map(({ path }) => path)
    .sort();
}

export function directChildDirectories(
  inventory: Inventory,
  parent: string,
): string[] {
  return directChildEntries(inventory, parent)
    .filter(({ kind }) => kind === "directory")
    .map(({ path }) => path)
    .sort();
}

export function isInsideRoot(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}
