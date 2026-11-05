import { fileURLToPath } from "node:url";
import { createFileTaskLifecycleStore } from "../tasks/file-task-lifecycle-store.js";
import { resolveStateRoot } from "../config/index.js";
import { OperationalError } from "../operational-error.js";
import { activeTaskRegisterTargets } from "../tasks/configured-task-targets.js";
import { loadCohortTasksConfig } from "./load-cohort-tasks-config.js";
import { parseArgumentTokens } from "./argument-tokens.js";

export async function runTasksRecoveryCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const usage =
    "Usage: academic-os tasks recovery --config <path> [--target <configured-key>] [--snapshot <id>] [--json]";
  const { values } = parseArgumentTokens({
    arguments: arguments_,
    command: "recovery",
    valueFlags: ["--config", "--target", "--snapshot"],
    booleanFlags: ["--json"],
    usage,
  });
  const configPath = values.get("--config");
  if (configPath === undefined)
    throw new OperationalError("invalid-arguments", usage);
  const { config } = await loadCohortTasksConfig(configPath);
  const lifecycle = await createFileTaskLifecycleStore({
    stateRoot: await resolveStateRoot(config),
    excludedRoots: [
      config.driveMount,
      fileURLToPath(new URL("../../../", import.meta.url)),
    ],
  }).read();
  const key = values.get("--target");
  const selected = activeTaskRegisterTargets(config).filter(
    (target) => key === undefined || target.identity.key === key,
  );
  if (
    selected.length === 0 ||
    (values.has("--snapshot") && selected.length !== 1)
  )
    throw new OperationalError(
      "invalid-arguments",
      "Select exactly one configured target when reading a recovery snapshot.",
    );
  const targets = [];
  for (const target of selected) {
    const id = values.get("--snapshot");
    const snapshots = (await target.recoveryStore?.list(target.identity)) ?? [];
    if (
      id !== undefined &&
      !snapshots.some((snapshot) => snapshot.snapshotId === id)
    )
      throw new OperationalError(
        "invalid-arguments",
        "Snapshot does not belong to the selected target or has expired.",
      );
    targets.push({
      target: target.identity,
      snapshots,
      ...(id === undefined
        ? {}
        : { snapshot: await target.recoveryStore?.read(id) }),
      observation: (await target.receiptStore?.read()) ?? null,
    });
  }
  const report = {
    schemaVersion: 1,
    command: "tasks recovery",
    outcome: "read",
    snapshotsAre: "historical; not current provider authority",
    nativeTiming: "unavailable unless independently observed in that snapshot",
    expectedLifecycleRevision: lifecycle.revision,
    targets,
  };
  process.stdout.write(
    json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `Recovery history: ${targets.length} target(s)\n`,
  );
}
