import type { ParsedShelfBook } from "./types.js";

const PDF_EXTENSION = ".pdf";
const SOLUTIONS_QUALIFIER = " Solutions";
const SURNAME = /^\p{Lu}[\p{L}\p{M}'’-]*$/u;
const EDITION = /^\d+e$/u;

// `<Title> <N>e <Author surnames, comma-separated>.pdf`, the edition token present only when the
// book has one and `Solutions` trailing a solutions manual. Surnames are single tokens, so the
// author list is what the commas delimit plus the one token in front of the first comma; the
// title is whatever remains once an edition token is taken off its end.
export function parseShelfFilename(file: string): ParsedShelfBook | undefined {
  if (!file.endsWith(PDF_EXTENSION)) return undefined;
  const stem = file.slice(0, -PDF_EXTENSION.length);
  // ` - ` separates author from title in the convention the shelf is being brought over from, and
  // the codified naming separates nothing: a name carrying one is that other convention's.
  if (
    stem === "" ||
    stem !== stem.trim() ||
    stem.includes("  ") ||
    stem.includes(" - ")
  ) {
    return undefined;
  }
  const solutions = stem.endsWith(SOLUTIONS_QUALIFIER);
  const named = solutions ? stem.slice(0, -SOLUTIONS_QUALIFIER.length) : stem;
  const [titleAndFirstAuthor = "", ...coAuthorSegments] = named.split(",");
  const coAuthors: string[] = [];
  for (const segment of coAuthorSegments) {
    if (!segment.startsWith(" ")) return undefined;
    coAuthors.push(segment.slice(1));
  }
  const titleTokens = titleAndFirstAuthor.split(" ");
  const firstAuthor = titleTokens.pop();
  if (firstAuthor === undefined) return undefined;
  const authors: [string, ...string[]] = [firstAuthor, ...coAuthors];
  if (!authors.every((author) => SURNAME.test(author))) return undefined;
  const editionCandidate = titleTokens.at(-1);
  if (editionCandidate === undefined) return undefined;
  // A digit in the edition's place without the codified `<N>e` shape — `8th`, `2` — is an edition
  // the Owner wrote another way, and reading it as the title's last word would index the book
  // under a title no book has.
  const edition = EDITION.test(editionCandidate)
    ? titleTokens.pop()
    : undefined;
  if (edition === undefined && /\d/u.test(editionCandidate)) return undefined;
  const title = titleTokens.join(" ");
  if (title === "") return undefined;
  return {
    title,
    ...(edition === undefined ? {} : { edition }),
    authors,
    solutions,
  };
}

export function defaultBookKey(book: ParsedShelfBook): string {
  return book.authors[0];
}
