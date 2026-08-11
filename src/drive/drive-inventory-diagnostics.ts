import type { InventoryDiagnostic } from "../conformance/index.js";
import {
  type ListedDriveItem,
  shortcutMimeType,
} from "./drive-inventory-state.js";

export function inventoryDiagnostics(
  items: ListedDriveItem[],
  listingDiagnostics: InventoryDiagnostic[],
): InventoryDiagnostic[] {
  const visibleItems = items.filter(({ file }) => file.trashed !== true);
  return [
    ...listingDiagnostics,
    ...duplicatePathDiagnostics(visibleItems),
    ...shortcutCycleDiagnostics(visibleItems),
  ].sort(compareDiagnostics);
}

function duplicatePathDiagnostics(
  items: ListedDriveItem[],
): InventoryDiagnostic[] {
  const counts = new Map<string, number>();
  for (const { path } of items) counts.set(path, (counts.get(path) ?? 0) + 1);
  return [...counts]
    .filter(([, count]) => count > 1)
    .map(([path, count]) => ({
      kind: "duplicate-visible-name" as const,
      severity: "error" as const,
      evidence: `Drive inventory has ${count} items at visible path ${path}.`,
    }));
}

function shortcutCycleDiagnostics(
  items: ListedDriveItem[],
): InventoryDiagnostic[] {
  const targetByShortcut = new Map<string, string>();
  const shortcutById = new Map<string, ListedDriveItem>();
  const diagnostics: InventoryDiagnostic[] = [];
  for (const item of items) {
    const { file } = item;
    if (file.id === undefined || file.mimeType !== shortcutMimeType) continue;
    shortcutById.set(file.id, item);
    const targetId = file.shortcutDetails?.targetId;
    if (targetId === undefined) continue;
    targetByShortcut.set(file.id, targetId);
    if (item.ancestorIds.includes(targetId)) {
      diagnostics.push(shortcutCycleDiagnostic(item.path));
    }
  }

  const reported = new Set<string>();
  for (const [shortcutId, item] of shortcutById) {
    const seen = new Set<string>();
    let current: string | undefined = shortcutId;
    while (current !== undefined && !seen.has(current)) {
      seen.add(current);
      current = targetByShortcut.get(current);
    }
    if (current !== undefined && seen.has(current)) {
      const cycle = [...seen].filter((id) => shortcutById.has(id)).sort();
      const key = cycle.join("\u0000");
      if (!reported.has(key)) {
        reported.add(key);
        diagnostics.push(shortcutCycleDiagnostic(item.path));
      }
    }
  }
  return diagnostics;
}

function shortcutCycleDiagnostic(path: string): InventoryDiagnostic {
  return {
    kind: "shortcut-cycle",
    severity: "error",
    evidence: `Drive shortcut relationships form a cycle reachable from ${path}.`,
  };
}

function compareDiagnostics(
  left: InventoryDiagnostic,
  right: InventoryDiagnostic,
): number {
  return `${left.kind}\u0000${left.evidence}`.localeCompare(
    `${right.kind}\u0000${right.evidence}`,
  );
}
