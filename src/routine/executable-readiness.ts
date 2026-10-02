import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";

export interface RoutineExecutableReadiness {
  tool: "codex" | "gh";
  status: "ready" | "missing" | "not-executable" | "unavailable";
}

// Read-only installation evidence: no process invocation, provider access or config repair.
export async function inspectRoutineExecutables(config: {
  codexPath: string;
  ghPath: string;
}): Promise<RoutineExecutableReadiness[]> {
  return await Promise.all(
    (["codex", "gh"] as const).map(async (tool) => {
      const path = tool === "codex" ? config.codexPath : config.ghPath;
      try {
        const info = await stat(path);
        if (!info.isFile()) return { tool, status: "not-executable" as const };
        await access(path, constants.X_OK);
        return { tool, status: "ready" as const };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return {
          tool,
          status:
            code === "ENOENT" || code === "ENOTDIR"
              ? ("missing" as const)
              : code === "EACCES"
                ? ("not-executable" as const)
                : ("unavailable" as const),
        };
      }
    }),
  );
}
