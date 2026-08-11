import { execFile } from "node:child_process";
import { rename } from "node:fs/promises";
import { promisify } from "node:util";

import { OperationalError } from "./operational-error.js";

const executeFile = promisify(execFile);
const darwinDestinationExists = 17;
const renameExclusiveRuby = `
require "fiddle/import"
RENAME_EXCL = 0x00000004
module LibC
  extend Fiddle::Importer
  dlload Fiddle.dlopen(nil)
  extern "int renamex_np(const char *, const char *, unsigned int)"
end
result = LibC.renamex_np(ARGV.fetch(0), ARGV.fetch(1), RENAME_EXCL)
puts(result == 0 ? 0 : Fiddle.last_error)
`;

export async function renameExclusive(
  source: string,
  destination: string,
): Promise<"renamed" | "destination-exists"> {
  if (process.platform !== "darwin") {
    await rename(source, destination);
    return "renamed";
  }
  let stdout: string;
  try {
    ({ stdout } = await executeFile("/usr/bin/ruby", [
      "-e",
      renameExclusiveRuby,
      source,
      destination,
    ]));
  } catch {
    throw new OperationalError(
      "operational-failure",
      "Atomic no-clobber publication could not invoke renamex_np.",
    );
  }
  const errorNumber = Number(stdout.trim());
  if (errorNumber === 0) return "renamed";
  if (errorNumber === darwinDestinationExists) return "destination-exists";
  throw new OperationalError(
    "operational-failure",
    `Atomic no-clobber publication failed with errno ${errorNumber}.`,
  );
}
