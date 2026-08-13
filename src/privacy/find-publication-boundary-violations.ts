import { posix } from "node:path";

export interface PublicationCandidate {
  path: string;
  contents: string;
}

export interface PublicationBoundaryViolation {
  path: string;
  kind: "academic-content" | "private-state" | "credential";
}

const courseworkBearingExtensions = new Set([
  ".doc",
  ".docx",
  ".heic",
  ".ipynb",
  ".jpeg",
  ".jpg",
  ".key",
  ".m4a",
  ".mov",
  ".mp3",
  ".mp4",
  ".numbers",
  ".pages",
  ".pdf",
  ".png",
  ".ppt",
  ".pptx",
  ".tex",
  ".xls",
  ".xlsx",
]);
const academicTextExtensions = new Set([
  ".ipynb",
  ".md",
  ".py",
  ".tex",
  ".ts",
  ".txt",
]);
const allowedSyntheticOrNormativeText = new Set([
  "CONTEXT.md",
  "docs/module-folder-contract.md",
  "docs/operator-guide.md",
  "test/fixtures/module-controls.ts",
]);
const privateStatePath =
  /(?:^|\/)(?:observations|journals|reports|academic-os-state|drive-api-responses|calendar-provider-responses)(?:\/|$)|^calendar\/|\.calendar-provider-response\.json$/u;
const credentialPath =
  /(?:^|\/)(?:\.env(?:\..+)?|credentials\.json|[^/]*\.credentials\.json|client_secret[^/]*\.json|application_default_credentials\.json)$/u;
const credentialContents =
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bAIza[0-9A-Za-z_-]{35}\b|\bgh[pousr]_[0-9A-Za-z]{30,}\b|\bAKIA[0-9A-Z]{16}\b/u;

export function findPublicationBoundaryViolations(
  candidates: PublicationCandidate[],
): PublicationBoundaryViolation[] {
  const violations: PublicationBoundaryViolation[] = [];
  for (const { path, contents } of candidates) {
    if (isAcademicPath(path) || containsAcademicText(path, contents)) {
      violations.push({ path, kind: "academic-content" });
    }
    if (privateStatePath.test(path)) {
      violations.push({ path, kind: "private-state" });
    }
    if (credentialPath.test(path) || credentialContents.test(contents)) {
      violations.push({ path, kind: "credential" });
    }
  }
  return violations;
}

function isAcademicPath(path: string): boolean {
  const segments = path.split("/");
  return (
    segments.some(
      (segment) =>
        segment.toLowerCase() === "modules" ||
        /^Y[0-9]S[0-9]$/u.test(segment) ||
        /^(?:CC|MH)[0-9]{4}$/u.test(segment),
    ) ||
    isAcademicTextFilename(posix.basename(path)) ||
    courseworkBearingExtensions.has(posix.extname(path).toLowerCase())
  );
}

function isAcademicTextFilename(filename: string): boolean {
  return /^(?:notes|course[-_ ]?notes|study[-_ ]?guide|proofs?|exercises?|lecture[^/]*|tutorial[^/]*|assignment[^/]*|quiz[^/]*|midterm[^/]*|final[^/]*|labs?|projects?[^/]*)\.(?:md|txt|tex|ipynb)$/iu.test(
    filename,
  );
}

function containsAcademicText(path: string, contents: string): boolean {
  if (
    allowedSyntheticOrNormativeText.has(path) ||
    isExecutableSyntheticTest(path, contents) ||
    !academicTextExtensions.has(posix.extname(path).toLowerCase())
  ) {
    return false;
  }
  return (
    /\b(?:week|lecture|tutorial|assignment|quiz|midterm|final|lab|project|exercise|problem set|study guide)\s*(?:0?[1-9]|[1-9][0-9])\b/iu.test(
      contents,
    ) ||
    /^(?:#{1,6}|\/\/|%)\s*(?:course notes|study guide|proof|theorem|exercise|lab|project)\b/imu.test(
      contents,
    ) ||
    (/\b[A-Z]{2,4}[0-9]{4}[A-Z]?\b/u.test(contents) &&
      /\b(?:week|lecture|tutorial|assignment|quiz|midterm|final|lab|project|proof|theorem|exercise|problem set|study guide|course notes)\b/iu.test(
        contents,
      ))
  );
}

function isExecutableSyntheticTest(path: string, contents: string): boolean {
  return path.endsWith(".test.ts") && contents.includes('from "node:test"');
}
