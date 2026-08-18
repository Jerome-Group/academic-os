import { pinnedDocumentPaths } from "../contract/pinned-documents.js";

export const moduleControlPaths = {
  profile: "00 Module Admin/00 Module Profile.md",
  definition: "00 Module Admin/10 Module Definition.yaml",
  curationRegister: "00 Module Admin/20 Curation Register.jsonl",
  claude: "CLAUDE.md",
  context: "CONTEXT.md",
  ...pinnedDocumentPaths,
} as const;
