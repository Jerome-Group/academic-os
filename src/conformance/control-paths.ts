import { pinnedDocumentPaths } from "../contract/pinned-documents.js";
import { taskRegisterPath } from "../contract/task-register.js";

export const moduleControlPaths = {
  profile: "00 Module Admin/00 Module Profile.md",
  definition: "00 Module Admin/10 Module Definition.yaml",
  curationRegister: "00 Module Admin/20 Curation Register.jsonl",
  taskRegister: taskRegisterPath,
  sourceMap: "00 Module Admin/40 Source Map.yaml",
  claude: "CLAUDE.md",
  context: "CONTEXT.md",
  ...pinnedDocumentPaths,
} as const;
