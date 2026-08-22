import { pinnedDocumentPaths } from "../contract/pinned-documents.js";
import { taskRegisterPath } from "../contract/task-register.js";
import { textbookRegisterPath } from "../contract/textbook-register.js";

// Controls this system writes and reads back. Each is validated against its own shape by its own
// rule, so what a valid one looks like is a question only that rule can answer.
export const writtenControlPaths = {
  profile: "00 Module Admin/00 Module Profile.md",
  definition: "00 Module Admin/10 Module Definition.yaml",
  curationRegister: "00 Module Admin/20 Curation Register.jsonl",
  taskRegister: taskRegisterPath,
  sourceMap: "00 Module Admin/40 Source Map.yaml",
  textbookRegister: textbookRegisterPath,
  claude: "CLAUDE.md",
  context: "CONTEXT.md",
} as const;

// Every control the contract's Module controls section names, which is the written ones above and
// the pinned ones this repository authors. The split is how a control is validated, not whether it
// is one: a written control is checked against its own shape, a pinned control against the template
// it was seeded from. An audit opens both, which is why the union exists at all.
export const moduleControlPaths = {
  ...writtenControlPaths,
  ...pinnedDocumentPaths,
} as const;

// Whether a rule keyed on a file name can say anything about a control in this home. `docs/` and
// the Teaching workspace are outside every curated root and their interiors are their own
// procedures' business, so a control living there is not one a naming rule reaches — and treating
// it as one would make a `preferences.md` in `90 Resources/` a misplaced control rather than the
// badly named resource it is.
export function isGovernedControlHome(path: string): boolean {
  return !path.includes("/") || path.startsWith("00 Module Admin/");
}
