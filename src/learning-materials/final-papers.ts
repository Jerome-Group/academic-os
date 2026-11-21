import { lstat, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { hashMaterializedSource } from "../mounted/hash-materialized-source.js";
import { OperationalError } from "../operational-error.js";

export const finalAssessmentDirectory = "30 Assessments/40 Finals";
const code = "[A-Z]{2,}[0-9]{3,}[A-Z]?";
const filename = new RegExp(
  `^((?:${code}_)+)Final_(\\d{4})-(\\d{4})(?:_([A-Za-z0-9_-]+))?_Questions\\.pdf$`,
  "u",
);
const paperTitle = new RegExp(
  `^(${code}) (\\d{2}|\\d{4})/(\\d{2}|\\d{4})(?: (.+))?$`,
  "iu",
);

export interface FinalPaper {
  title: string;
  questions: string;
  solutions: string | null;
  codes: readonly string[];
  startYear: string;
  endYear: string;
  qualifier: string;
}

export async function readFinalPapers(
  root: string,
  module: string,
): Promise<FinalPaper[]> {
  for (const folder of ["30 Assessments", finalAssessmentDirectory]) {
    const path = join(root, folder);
    if (!(await lstat(path)).isDirectory() || (await realpath(path)) !== path)
      throw new OperationalError(
        "invalid-target",
        "Finals must be an ordinary directory inside the Module.",
      );
  }
  const names = new Set(await readdir(join(root, finalAssessmentDirectory)));
  return [...names].sort().flatMap((name) => {
    const match = filename.exec(name);
    if (!match) return [];
    const [, codesField = "", startYear = "", endYear = "", suffix = ""] =
      match;
    const codes = codesField.split("_").filter(Boolean);
    if (!codes.includes(module)) return [];
    const qualifier = suffix.replaceAll("_", " ");
    const edition = qualifier ? ` ${qualifier}` : "";
    const title = `${module} ${startYear.slice(-2)}/${endYear.slice(-2)}${edition} Final`;
    const solutions = name.replace(/_Questions\.pdf$/u, "_Solutions.pdf");
    return [
      {
        title,
        codes,
        startYear,
        endYear,
        qualifier,
        questions: `${finalAssessmentDirectory}/${name}`,
        solutions: names.has(solutions)
          ? `${finalAssessmentDirectory}/${solutions}`
          : null,
      },
    ];
  });
}

export function matchFinalPapers(
  papers: readonly FinalPaper[],
  name: string,
): FinalPaper[] {
  const path = papers.filter((paper) => paper.questions === name);
  if (path.length) return path;
  const title = paperTitle.exec(name.replace(/\s+/gu, " "));
  if (!title) return [];
  const [, course = "", start = "", end = "", qualifier] = title;
  return papers.filter(
    (paper) =>
      paper.codes.includes(course.toUpperCase()) &&
      paper.startYear.endsWith(start) &&
      paper.endYear.endsWith(end) &&
      (qualifier === undefined ||
        qualifier.toLowerCase() === paper.qualifier.toLowerCase()),
  );
}

export function parseFinalStudyRequest(request: string): {
  name: string;
  mode: "review" | "attempt";
} {
  const input = request.trim();
  return {
    name: input
      .replace(/^review\s+/iu, "")
      .replace(/\s+Final(?:\s+Review)?$/iu, ""),
    mode: /^review\s|\sFinal\s+Review$/iu.test(input) ? "review" : "attempt",
  };
}

export async function verifyFinalSources(root: string, paper: FinalPaper) {
  return {
    questions: {
      file: paper.questions,
      ...(await hashMaterializedSource(root, paper.questions)),
    },
    solutions:
      paper.solutions === null
        ? null
        : {
            file: paper.solutions,
            ...(await hashMaterializedSource(root, paper.solutions)),
          },
  };
}
