import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createPublicationService } from "./index.js";

export async function runControlsPublicationCommand(
  arguments_: string[],
): Promise<void> {
  const operation = arguments_[0];
  const { values } = parseArgs({
    args: arguments_.slice(1),
    strict: true,
    allowPositionals: false,
    options: {
      json: { type: "boolean" },
      request: { type: "string" },
      candidate: { type: "string" },
      identity: { type: "string" },
      bundle: { type: "string" },
      generation: { type: "string" },
      "expect-absent": { type: "boolean" },
      "expected-head": { type: "string" },
    },
  });
  const permitted =
    operation === "create-generated-candidate"
      ? ["json", "request", "identity"]
      : operation === "publish-generation"
        ? [
            "json",
            "request",
            "candidate",
            "bundle",
            "expect-absent",
            "expected-head",
          ]
        : operation === "inspect-candidate"
          ? ["json", "candidate", "generation"]
          : [];
  if (
    !permitted.length ||
    Object.keys(values).some((key) => !permitted.includes(key))
  )
    throw new Error("Unsupported controls publication command or option.");
  function required(value: string | undefined, name: string): string {
    if (!value) throw new Error(`Missing --${name}.`);
    return value;
  }
  const source =
    operation === "create-generated-candidate"
      ? required(values.identity, "identity")
      : operation === "publish-generation"
        ? required(values.bundle, "bundle")
        : undefined;
  const service = createPublicationService({
    exclusionPaths: source === undefined ? [] : [dirname(resolve(source))],
  });
  const report =
    operation === "create-generated-candidate"
      ? await service.create({
          requestId: required(values.request, "request"),
          identityBytes: await readFile(required(source, "identity")),
        })
      : operation === "publish-generation"
        ? await service.publish({
            candidateId: required(values.candidate, "candidate"),
            requestId: required(values.request, "request"),
            expectedHead:
              values["expect-absent"] === true &&
              values["expected-head"] === undefined
                ? { kind: "absent" }
                : values["expect-absent"] === undefined &&
                    values["expected-head"] !== undefined
                  ? { kind: "digest", headByteSha256: values["expected-head"] }
                  : (() => {
                      throw new Error(
                        "Supply exactly one of --expect-absent or --expected-head.",
                      );
                    })(),
            bundleBytes: await readFile(required(source, "bundle")),
          })
        : await service.inspect({
            candidateId: required(values.candidate, "candidate"),
            selection:
              values.generation === undefined
                ? { kind: "current" }
                : { kind: "pinned", generationId: values.generation },
          });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.kind === "refused" || report.kind === "recovery-required")
    process.exitCode = 2;
}
