import { createReadStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  activityProblem,
  maximumActivityBytes,
  readActivityJson,
  requireActivitySize,
} from "../controls/index.js";
import { createModuleActivityTools, moduleActivityActions } from "./actions.js";

export async function runModuleActivityCommand(args: string[]): Promise<void> {
  try {
    const action = moduleActivityActions.find((a) => a.cli[2] === args[0]);
    if (!action) throw new Error("Unknown Module activity action.");
    const { values } = parseArgs({
      args: args.slice(1),
      strict: true,
      allowPositionals: false,
      options: { input: { type: "string" }, json: { type: "boolean" } },
    });
    if (!values.input)
      throw new Error(
        "Supply --input with the strict action JSON packet, or - for stdin.",
      );
    const chunks: Buffer[] = [];
    let length = 0;
    const stream =
      values.input === "-"
        ? process.stdin
        : createReadStream(values.input, { highWaterMark: 64 * 1024 });
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.byteLength;
      if (length > maximumActivityBytes) {
        stream.destroy();
        throw new Error(
          `Activity input measured at least ${length} bytes; limit ${maximumActivityBytes}.`,
        );
      }
      chunks.push(bytes);
    }
    const tool = createModuleActivityTools({
      exclusionPaths:
        values.input === "-" ? [] : [dirname(resolve(values.input))],
    }).find((t) => t.name === action.mcp);
    if (!tool) throw new Error("Missing registered activity handler.");
    const result = await tool.call(readActivityJson(Buffer.concat(chunks)));
    requireActivitySize(result.report);
    process.stdout.write(`${JSON.stringify(result.report)}\n`);
    if (result.failed) process.exitCode = 2;
  } catch (error) {
    process.stdout.write(`${JSON.stringify(activityProblem(error))}\n`);
    process.exitCode = 2;
  }
}
