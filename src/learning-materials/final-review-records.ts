import { readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { readControlDocument } from "../conformance/control-document.js";
import { isRecord } from "../conformance/value-shape.js";
import { readSafeFile } from "../mounted/read-safe-file.js";
import { OperationalError } from "../operational-error.js";

export interface FinalReviewRecord {
  path: string;
  taskId?: string;
}

const records = ["70 Learning", "40 Past Papers", "records"];

export async function readFinalReviewRecords(
  root: string,
  questions: string,
): Promise<FinalReviewRecord[]> {
  const directory = join(root, ...records);
  const resolved = await realpath(directory).catch((error: unknown) => {
    if (isRecord(error) && error.code === "ENOENT") return undefined;
    throw error;
  });
  if (resolved === undefined) return [];
  if (resolved !== directory)
    throw new OperationalError(
      "invalid-target",
      "Past-paper records must be inside the Module.",
    );
  const names = (await readdir(directory)).filter((name) =>
    /^\d+-[^/]+\.md$/u.test(name),
  );
  const completed: FinalReviewRecord[] = [];
  const superseded = new Set<string>();
  for (const name of names.sort()) {
    const components = [...records, name];
    const text = await readSafeFile(root, components, "Past-paper record");
    const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text)?.[1];
    if (header === undefined) continue;
    const parsed = readControlDocument(header);
    if (!("value" in parsed) || !isRecord(parsed.value)) continue;
    const value = parsed.value;
    const replacements = Array.isArray(value.supersedes)
      ? value.supersedes
      : [value.supersedes];
    for (const id of replacements) {
      if (typeof id === "string" || typeof id === "number")
        superseded.add(String(id).replace(/^0+(?=\d)/u, ""));
    }
    if (
      value.mode !== "final-review" ||
      value.kind !== "session" ||
      value.status !== "complete" ||
      !Array.isArray(value.sources) ||
      !value.sources.some(
        (source) => isRecord(source) && source.file === questions,
      )
    )
      continue;
    completed.push({
      path: components.join("/"),
      ...(typeof value.task_id !== "string" || value.task_id === ""
        ? {}
        : { taskId: value.task_id }),
    });
  }
  return completed.filter(({ path }) => {
    const recordId = path.split("/").at(-1)?.split("-")[0];
    return (
      recordId !== undefined &&
      !superseded.has(recordId.replace(/^0+(?=\d)/u, ""))
    );
  });
}
