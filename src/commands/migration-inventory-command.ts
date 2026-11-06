import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inventoryNativeRoot } from "../migration/native-inventory/index.js";
import { OperationalError } from "../operational-error.js";
import { parseArgumentTokens } from "./argument-tokens.js";

const usage =
  "Usage: academic-os migration inventory --root <physical-root> [--log <private-new-file>] [--json]";
const repository = fileURLToPath(new URL("../../../", import.meta.url));
function inside(root: string, path: string) {
  const pathFromRoot = relative(root, path);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith(
      `..${process.platform === "win32" ? "\\" : "/"}`,
    ) &&
      pathFromRoot !== ".." &&
      !isAbsolute(pathFromRoot))
  );
}

async function validateLog(path: string, root: string) {
  if (!isAbsolute(path) || inside(root, path) || inside(repository, path))
    throw new OperationalError(
      "invalid-arguments",
      "Inventory logs require an absolute new private file outside the source and repository.",
    );
  const protectedRoots = await Promise.all([
    lstat(root, { bigint: true }),
    lstat(await realpath(repository), { bigint: true }),
  ]);
  if (
    protectedRoots.some((stat) => !stat.isDirectory() || stat.isSymbolicLink())
  )
    throw new OperationalError(
      "invalid-arguments",
      "Inventory logs require a physical source and repository directory.",
    );
  const identities = new Set(
    protectedRoots.map((stat) => `${stat.dev}:${stat.ino}`),
  );
  const parent = await lstat(dirname(path), { bigint: true });
  for (let ancestor = dirname(path); ; ancestor = dirname(ancestor)) {
    const stat = await lstat(ancestor, { bigint: true });
    if (identities.has(`${stat.dev}:${stat.ino}`))
      throw new OperationalError(
        "invalid-arguments",
        "Inventory log resolves inside the source or repository.",
      );
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new OperationalError(
        "invalid-arguments",
        "Inventory log ancestors must be physical directories.",
      );
    if (
      ancestor === dirname(path) &&
      ((stat.mode & 0o077n) !== 0n ||
        stat.uid !== BigInt(process.getuid?.() ?? -1))
    )
      throw new OperationalError(
        "invalid-arguments",
        "Inventory log parent must be private and owned by the current user.",
      );
    if (ancestor === dirname(ancestor)) break;
  }
  try {
    await lstat(path);
    throw new OperationalError(
      "invalid-arguments",
      "Inventory logs refuse replacement.",
    );
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  return parent;
}

export async function runMigrationInventoryCommand(
  arguments_: string[],
  json: boolean,
) {
  const { values } = parseArgumentTokens({
    arguments: arguments_,
    command: "inventory",
    valueFlags: ["--root", "--log"],
    booleanFlags: ["--json"],
    usage,
  });
  const input = values.get("--root");
  if (input === undefined)
    throw new OperationalError("invalid-arguments", usage);
  const root = resolve(input);
  const log = values.get("--log");
  if (log !== undefined) await validateLog(log, root);
  const report = await inventoryNativeRoot(root);
  const bytes = `${JSON.stringify(report, null, 2)}\n`;
  if (log !== undefined) {
    const parent = await open(
      dirname(log),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      const current = await validateLog(log, root);
      const pinned = await parent.stat({ bigint: true });
      if (
        pinned.dev !== current.dev ||
        pinned.ino !== current.ino ||
        pinned.uid !== BigInt(process.getuid?.() ?? -1) ||
        (pinned.mode & 0o077n) !== 0n
      )
        throw new OperationalError(
          "invalid-arguments",
          "Inventory log parent changed.",
        );
      const destination = await open(
        log,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await destination.writeFile(bytes);
        await destination.sync();
      } finally {
        await destination.close();
      }
    } finally {
      await parent.close();
    }
  }
  process.stdout.write(
    json
      ? bytes
      : `${report.outcome}; entries=${report.entries.length}; complete=${report.complete}\n${report.diagnostics.map((item) => `${item.code} ${item.pathHex} ${item.detail}`).join("\n")}\n`,
  );
  process.exitCode = report.complete ? 0 : 2;
}
