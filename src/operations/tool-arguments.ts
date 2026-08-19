import { OperationalError } from "../operational-error.js";
import type { OperationTool, OperationToolField } from "./types.js";

export interface ToolInputSchema {
  type: "object";
  properties: Record<string, { type: "string"; description: string }>;
  required: string[];
  additionalProperties: false;
}

export function toolInputSchema(
  fields: readonly OperationToolField[],
): ToolInputSchema {
  return {
    type: "object",
    properties: Object.fromEntries(
      fields.map(({ name, description }) => [
        name,
        { type: "string" as const, description },
      ]),
    ),
    required: fields
      .filter(({ required }) => required === true)
      .map(({ name }) => name),
    additionalProperties: false,
  };
}

// Every argument this surface takes is a string, so the parse is one shape check per declared
// field and a refusal of anything undeclared: a misspelt argument that fell through would push a
// change to the live list with the half the caller meant silently missing.
export function readToolArguments(
  tool: OperationTool,
  arguments_: unknown,
): ReadonlyMap<string, string> {
  if (arguments_ !== undefined && !isObject(arguments_)) {
    throw new OperationalError(
      "invalid-arguments",
      `${tool.name} takes an arguments object.`,
    );
  }
  const supplied = arguments_ ?? {};
  const declared = new Set(tool.fields.map(({ name }) => name));
  const undeclared = Object.keys(supplied).filter(
    (name) => !declared.has(name),
  );
  if (undeclared.length > 0) {
    throw new OperationalError(
      "invalid-arguments",
      `${tool.name} does not take ${undeclared.join(", ")}.`,
    );
  }
  const values = new Map<string, string>();
  for (const field of tool.fields) {
    const value = supplied[field.name];
    if (value === undefined) {
      if (field.required === true) {
        throw new OperationalError(
          "invalid-arguments",
          `${tool.name} requires ${field.name}.`,
        );
      }
      continue;
    }
    if (typeof value !== "string" || value === "") {
      throw new OperationalError(
        "invalid-arguments",
        `${tool.name} takes ${field.name} as a non-empty string.`,
      );
    }
    values.set(field.name, value);
  }
  return values;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
