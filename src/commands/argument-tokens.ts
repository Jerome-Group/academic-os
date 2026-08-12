import { OperationalError } from "../mounted/index.js";

export interface ParsedArgumentTokens {
  values: ReadonlyMap<string, string>;
  flags: ReadonlySet<string>;
}

export function parseArgumentTokens(input: {
  arguments: string[];
  command: string;
  valueFlags: readonly string[];
  booleanFlags: readonly string[];
  usage: string;
}): ParsedArgumentTokens {
  if (input.arguments[0] !== input.command) {
    throw new OperationalError("invalid-arguments", input.usage);
  }
  const valueFlags = new Set(input.valueFlags);
  const booleanFlags = new Set(input.booleanFlags);
  const supported = new Set([input.command, ...valueFlags, ...booleanFlags]);
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 1; index < input.arguments.length; index += 1) {
    const argument = input.arguments[index];
    if (argument === undefined || !supported.has(argument)) {
      throw new OperationalError(
        "invalid-arguments",
        argument === undefined
          ? input.usage
          : `Unexpected argument: ${argument}.`,
      );
    }
    if (booleanFlags.has(argument)) {
      flags.add(argument);
      continue;
    }
    const value = input.arguments[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new OperationalError("invalid-arguments", input.usage);
    }
    values.set(argument, value);
    index += 1;
  }
  return { values, flags };
}
