// The Textbook-register vocabulary MF-TEXTBOOK-003 fixes: where a module records what it cut off
// the shared shelf, and which keys one recorded cut may carry.
export const textbookRegisterPath = "00 Module Admin/50 Textbook Register.yaml";

export const extractionKeys = [
  "book",
  "number",
  "title",
  "pages",
  "file",
  "source_sha256",
] as const;

// The facts the Shelf index owns. An entry naming one is the register repeating what it cites,
// which is exactly what citing a Book key exists to avoid.
export const shelfOwnedKeys = ["edition", "authors", "division", "sha256"];
