import { parse } from "yaml";

import {
  type CheatsheetAuthoringAuthority,
  type CheatsheetConstraints,
  cheatsheetAuthorities,
  type CheatsheetManifest,
  type CheatsheetReview,
  type CheatsheetSource,
} from "./types.js";

const sha256Pattern = /^[a-f0-9]{64}$/u;
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const sourceIdPattern = /^[A-Za-z0-9]+(?:[-_.][A-Za-z0-9]+)*$/u;

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be a mapping.`);
  }
  return value as Record<string, unknown>;
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
}

function numberAt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a number.`);
  }
  return value;
}

function sha256At(value: unknown, path: string): string {
  const digest = stringAt(value, path);
  if (!sha256Pattern.test(digest)) {
    throw new Error(`${path} must be a lowercase SHA-256 digest.`);
  }
  return digest;
}

function relativePathAt(value: unknown, path: string): string {
  const candidate = stringAt(value, path);
  const segments = candidate.split("/");
  if (
    candidate.startsWith("/") ||
    candidate.includes("\\") ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new Error(`${path} must be a normalized module-relative path.`);
  }
  return candidate;
}

function authoringAt(value: unknown): CheatsheetAuthoringAuthority {
  const authoring = objectAt(value, "authoring");
  if (authoring.kind === "self-contained") {
    return {
      kind: "self-contained",
      path: relativePathAt(authoring.path, "authoring.path"),
      sha256: sha256At(authoring.sha256, "authoring.sha256"),
    };
  }
  if (authoring.kind !== "fragments") {
    throw new Error("authoring.kind must be self-contained or fragments.");
  }
  if (!Array.isArray(authoring.fragments) || authoring.fragments.length === 0) {
    throw new Error("authoring.fragments must name at least one fragment.");
  }
  const paths = new Set<string>();
  const fragments = authoring.fragments.map((value, index) => {
    const fragment = objectAt(value, `authoring.fragments[${index}]`);
    const path = relativePathAt(
      fragment.path,
      `authoring.fragments[${index}].path`,
    );
    if (paths.has(path)) {
      throw new Error(`authoring.fragments repeats ${path}.`);
    }
    paths.add(path);
    return {
      path,
      sha256: sha256At(fragment.sha256, `authoring.fragments[${index}].sha256`),
    };
  });
  return { kind: "fragments", fragments };
}

function constraintsAt(value: unknown): CheatsheetConstraints {
  const constraints = objectAt(value, "constraints");
  if (constraints.paper !== "A4" || constraints.color !== "monochrome") {
    throw new Error("constraints require A4 paper and monochrome output.");
  }
  const pages = objectAt(constraints.pages, "constraints.pages");
  const exact = pages.exact;
  const maximum = pages.maximum;
  if ((exact === undefined) === (maximum === undefined)) {
    throw new Error(
      "constraints.pages requires exactly one of exact or maximum.",
    );
  }
  const pageLimit = numberAt(exact ?? maximum, "constraints.pages limit");
  if (!Number.isInteger(pageLimit) || pageLimit < 1) {
    throw new Error("constraints.pages limit must be a positive integer.");
  }
  const columns = numberAt(constraints.columns, "constraints.columns");
  if (!Number.isInteger(columns) || columns < 1 || columns > 6) {
    throw new Error("constraints.columns must be an integer from 1 to 6.");
  }
  const bodyPt = objectAt(constraints.body_pt, "constraints.body_pt");
  const preferred = numberAt(bodyPt.preferred, "constraints.body_pt.preferred");
  const floor = numberAt(bodyPt.floor, "constraints.body_pt.floor");
  if (floor <= 0 || preferred < floor) {
    throw new Error(
      "preferred body size must be at or above its positive floor.",
    );
  }
  return {
    paper: "A4",
    pages: exact === undefined ? { maximum: pageLimit } : { exact: pageLimit },
    color: "monochrome",
    columns,
    bodyPt: { preferred, floor },
  };
}

function sourcesAt(value: unknown): CheatsheetSource[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("sources must contain at least one source.");
  }
  const ids = new Set<string>();
  return value.map((entry, index) => {
    const source = objectAt(entry, `sources[${index}]`);
    const id = stringAt(source.id, `sources[${index}].id`);
    if (!sourceIdPattern.test(id) || ids.has(id)) {
      throw new Error(`sources[${index}].id must be unique and stable.`);
    }
    ids.add(id);
    if (
      typeof source.authority !== "string" ||
      !cheatsheetAuthorities.includes(
        source.authority as (typeof cheatsheetAuthorities)[number],
      )
    ) {
      throw new Error(`sources[${index}].authority is unknown.`);
    }
    if (!Array.isArray(source.locators) || source.locators.length === 0) {
      throw new Error(`sources[${index}].locators must not be empty.`);
    }
    return {
      id,
      path: relativePathAt(source.path, `sources[${index}].path`),
      sha256: sha256At(source.sha256, `sources[${index}].sha256`),
      authority: source.authority as CheatsheetSource["authority"],
      locators: source.locators.map((locator, locatorIndex) =>
        stringAt(locator, `sources[${index}].locators[${locatorIndex}]`),
      ),
    };
  });
}

function reviewAt(value: unknown): CheatsheetReview {
  const review = objectAt(value, "release.review");
  if (
    review.status !== "unreviewed" &&
    review.status !== "pending" &&
    review.status !== "passed"
  ) {
    throw new Error("release.review.status is unknown.");
  }
  if (review.status === "passed") {
    return {
      status: "passed",
      reviewedPdfSha256: sha256At(
        review.reviewed_pdf_sha256,
        "release.review.reviewed_pdf_sha256",
      ),
    };
  }
  if (review.reviewed_pdf_sha256 !== undefined) {
    throw new Error("Only a passed review carries a reviewed PDF digest.");
  }
  return { status: review.status };
}

export function parseCheatsheetManifest(yaml: string): CheatsheetManifest {
  const root = objectAt(parse(yaml), "manifest");
  if (root.schema_version !== 1) {
    throw new Error("schema_version must be 1.");
  }
  const artifact = objectAt(root.artifact, "artifact");
  const id = stringAt(artifact.id, "artifact.id");
  if (!idPattern.test(id)) {
    throw new Error("artifact.id must be a lowercase hyphenated identifier.");
  }
  const release = objectAt(root.release, "release");
  const releaseTex = relativePathAt(
    artifact.release_tex,
    "artifact.release_tex",
  );
  const releasePdf = relativePathAt(
    artifact.release_pdf,
    "artifact.release_pdf",
  );
  const support = relativePathAt(artifact.support, "artifact.support");
  const personalNotes = "10 Learning Materials/30 Personal Notes/";
  if (
    !releaseTex.startsWith(personalNotes) ||
    !releasePdf.startsWith(personalNotes) ||
    releaseTex.slice(personalNotes.length).includes("/") ||
    releasePdf.slice(personalNotes.length).includes("/") ||
    !releaseTex.endsWith(".tex") ||
    !releasePdf.endsWith(".pdf") ||
    releaseTex.slice(0, -4) !== releasePdf.slice(0, -4)
  ) {
    throw new Error(
      "The release TeX/PDF must be one matching pair at Personal Notes top level.",
    );
  }
  const expectedSupport = `${personalNotes}support/${id}`;
  if (support !== expectedSupport) {
    throw new Error(`artifact.support must be ${expectedSupport}.`);
  }
  const authoring = authoringAt(root.authoring);
  if (
    (authoring.kind === "self-contained" && authoring.path !== releaseTex) ||
    (authoring.kind === "fragments" &&
      authoring.fragments.some(
        ({ path }) => !path.startsWith(`${support}/content/`),
      ))
  ) {
    throw new Error(
      "Authoring authority is either the release TeX or named fragments under support content.",
    );
  }
  const coverage = relativePathAt(root.coverage, "coverage");
  if (coverage !== `${support}/coverage.csv`) {
    throw new Error(`coverage must be ${support}/coverage.csv.`);
  }
  const pdfSha256 =
    release.pdf_sha256 === undefined
      ? undefined
      : sha256At(release.pdf_sha256, "release.pdf_sha256");
  const review = reviewAt(release.review);
  if (review.status === "passed" && review.reviewedPdfSha256 !== pdfSha256) {
    throw new Error(
      "The passed review must name the exact released PDF digest.",
    );
  }
  return {
    schemaVersion: 1,
    artifact: {
      id,
      title: stringAt(artifact.title, "artifact.title"),
      scope: stringAt(artifact.scope, "artifact.scope"),
      releaseTex,
      releasePdf,
      support,
    },
    authoring,
    constraints: constraintsAt(root.constraints),
    sources: sourcesAt(root.sources),
    coverage,
    release: {
      ...(release.tex_sha256 === undefined
        ? {}
        : { texSha256: sha256At(release.tex_sha256, "release.tex_sha256") }),
      ...(pdfSha256 === undefined ? {} : { pdfSha256 }),
      review,
    },
  };
}
