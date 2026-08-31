import { OperationalError } from "../operational-error.js";
import type { TaskRegister } from "./types.js";

// Seeding writes the register before its target has a list at all, so a register naming no list is
// one waiting for `tasks provision` rather than a malformed file. Both Tasks paths read it that
// way, and both say which step is outstanding.
export function provisionedList(
  register: TaskRegister | undefined,
  module: string,
): { register: TaskRegister; listId: string } {
  if (register === undefined) {
    throw new OperationalError(
      "missing-target",
      `${module} has no Task register; run tasks provision first.`,
    );
  }
  if (register.listId === undefined) {
    throw new OperationalError(
      "missing-target",
      `The Task register for ${module} names no task list yet; run tasks provision first.`,
    );
  }
  return { register, listId: register.listId };
}
