// Where a cut chapter lands and what it is called. MF-TEXTBOOK-004 fixes the name exactly, so the
// auditor reading the chapter home and the auditor reading the register that records it ask the
// same question of a filename rather than each holding its own idea of one.
export const textbookChaptersPath =
  "10 Learning Materials/20 Textbook Chapters";

const CHAPTER_EXTENSION = ".pdf";
// A Book key is a surname, Owner-qualified where two books would collide — `Isaacs_FGT`, `Tao_I`,
// `Axler_Solutions` — so a key token is Title Case or the qualifier's own capitals. Title tokens
// are the book's contents title, Title_Cased.
const NAME_TOKEN = /^\p{Lu}[\p{L}\p{M}\p{N}'’-]*$/u;
// The book's own word for how it divides itself, taken from the Shelf index in full.
const DIVISION = /^\p{Lu}\p{Ll}+$/u;
// Zero-padded arabic even where the book prints roman; appendix letters as printed.
const NUMBER = /^(?:\d{2}|\p{Lu})$/u;

export function isChapterFileName(name: string, moduleCode: string): boolean {
  if (!name.endsWith(CHAPTER_EXTENSION)) return false;
  const stem = name.slice(0, -CHAPTER_EXTENSION.length);
  if (!stem.startsWith(`${moduleCode}_`)) return false;
  const tokens = stem.slice(moduleCode.length + 1).split("_");
  return tokens.some((_, index) => isDivisionAt(tokens, index));
}

// A Book key of more than one token leaves the division's place ambiguous in the name alone, and
// the Shelf index that would settle it sits outside every module folder. So the name is read as
// conformant when any division-and-number in it leaves a key in front and a title behind.
function isDivisionAt(tokens: readonly string[], index: number): boolean {
  const key = tokens.slice(0, index);
  const title = tokens.slice(index + 2);
  return (
    key.length > 0 &&
    title.length > 0 &&
    DIVISION.test(tokens[index] ?? "") &&
    NUMBER.test(tokens[index + 1] ?? "") &&
    [...key, ...title].every((token) => NAME_TOKEN.test(token))
  );
}

export const CHAPTER_NAME_PATTERN = "<Key>_<Division>_<NN>_<Title>.pdf";
