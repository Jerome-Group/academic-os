import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isCuratedFileName,
  planNamingJson,
  resolveArtifactNames,
  type NamingEntry,
  type NamingPlan,
} from "../../src/naming/index.js";
import { isChapterFileName } from "../../src/contract/textbook-chapters.js";
import { unnumberedSourcePath } from "../../src/curation/unnumbered-source-path.js";
import { artifact, request } from "./fixtures.js";

function entries(plan: NamingPlan): readonly NamingEntry[] {
  assert.notEqual(plan.outcome, "refused");
  if (plan.outcome === "refused") throw new Error("Refused fixture");
  return plan.entries;
}

function resolvedPath(plan: NamingPlan): string {
  assert.equal(plan.outcome, "resolved");
  const entry = entries(plan)[0];
  assert.ok(entry?.kind === "resolved");
  return entry.path;
}

function frozen<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}

describe("complete-set artifact naming", () => {
  it("preserves accepted proper names, source identity, orthogonal traits and compound native extensions [MF-NAMING-002]", () => {
    const item = artifact({
      titleTokens: ["LinkedIn", "NTU", "iPhone"],
      sourceTokens: ["mh-001", "ABC"],
      traits: {
        content: "questions",
        annotation: "annotated",
        grading: "graded",
        evidence: ["evidence:combined"],
      },
      representation: {
        kind: "file",
        role: "editable",
        extension: "drawio.svg",
        evidence: ["evidence:representation"],
      },
      issued: { day: "2024-02-29", evidence: ["evidence:issued"] },
      academicYear: { value: "2024-2025", evidence: ["evidence:year"] },
      qualifiers: [{ tokens: ["Draft", "02"], evidence: ["evidence:draft"] }],
    });
    const input = frozen(request([item]));
    const before = JSON.stringify(input);
    const plan = resolveArtifactNames(input);
    assert.equal(
      resolvedPath(plan),
      "10 Learning Materials/10 Lecture Materials/MH2100_Lecture_01_LinkedIn_NTU_iPhone_Source_mh-001_ABC_2024-2025_2024-02-29_Questions_Annotated_Graded_Draft_02.drawio.svg",
    );
    assert.deepEqual(entries(plan)[0]?.artifact, item);
    assert.equal(JSON.stringify(input), before);
    assert.equal(
      isCuratedFileName(
        resolvedPath(plan).split("/").at(-1) ?? "",
        "MH2100",
        "module-artifact-naming/1",
      ),
      true,
    );
  });

  it("keeps proposal resolution separate from target-contract admission", () => {
    const input = request();
    const legacy = resolveArtifactNames(input);
    assert.notEqual(legacy.outcome, "refused");
    if (legacy.outcome !== "refused")
      assert.deepEqual(legacy.admission, {
        kind: "not-admitted",
        requiredContractVersion: 8,
        targetContractVersion: 7,
        reason: "target-contract-version",
      });
    input.targetContractVersion = 8;
    const future = resolveArtifactNames(input);
    assert.notEqual(future.outcome, "refused");
    if (future.outcome !== "refused")
      assert.equal(future.admission.reason, "activation-pending");
  });

  it("retains opaque legacy identities without applying a new identity algorithm", () => {
    const item = artifact();
    item.source.legacyIdentity = {
      algorithm: "curation-source-id/legacy-two-digit/1",
      value: "100 Lectures/1000 Original.pdf",
      evidence: ["evidence:original-event"],
    };
    const plan = resolveArtifactNames(request([item]));
    assert.equal(plan.outcome, "resolved");
    assert.deepEqual(
      entries(plan)[0]?.artifact.source.legacyIdentity,
      item.source.legacyIdentity,
    );
  });

  it("retains native bundle identity independently of role and never converts representations", () => {
    const input = request([
      artifact({
        representation: {
          kind: "native-bundle",
          role: "editable",
          extension: "pages",
          evidence: ["evidence:bundle"],
        },
      }),
      artifact({
        id: "artifact:rendered",
        representation: {
          kind: "file",
          role: "rendered",
          extension: "pdf",
          evidence: ["evidence:rendered"],
        },
      }),
    ]);
    const plan = resolveArtifactNames(input);
    assert.equal(plan.outcome, "resolved");
    assert.deepEqual(
      entries(plan).map(({ artifact: item }) => item.representation),
      input.artifacts.map(({ representation }) => representation),
    );
  });

  it("preserves the supported module code grammar through the authoritative identity schema", () => {
    for (const code of ["MH2100", "ABC1234", "ABCD1234A"]) {
      const input = request();
      input.module.moduleCode = code;
      assert.ok(
        resolvedPath(resolveArtifactNames(input)).includes(`/${code}_`),
      );
    }
    for (const code of ["A1234", "ABCDE1234", "mh2100", "MH2100ab"]) {
      const input = request();
      input.module.moduleCode = code;
      assert.equal(resolveArtifactNames(input).outcome, "refused");
    }
  });

  it("requires real days and adjacent academic years", () => {
    for (const day of [
      "2023-02-29",
      "1900-02-29",
      "2024-04-31",
      "2024-00-01",
      "0000-01-01",
    ])
      assert.equal(
        resolveArtifactNames(
          request([artifact({ issued: { day, evidence: ["evidence:date"] } })]),
        ).outcome,
        "unresolved",
      );
    for (const day of ["2000-02-29", "2026-11-05"])
      assert.equal(
        resolveArtifactNames(
          request([artifact({ issued: { day, evidence: ["evidence:date"] } })]),
        ).outcome,
        "resolved",
      );
    assert.equal(
      resolveArtifactNames(
        request([
          artifact({
            academicYear: { value: "2024-2026", evidence: ["evidence:year"] },
          }),
        ]),
      ).outcome,
      "unresolved",
    );
    assert.equal(
      isCuratedFileName("MH2100_Quiz_2025-02-29.pdf", "MH2100"),
      false,
    );
  });

  it("never guesses unknown sequence or capitalization or defaults unresolved placement", () => {
    const unknown = artifact({
      sequence: {
        kind: "unknown",
        reason: "Source does not number itself",
        evidence: ["evidence:source"],
      },
    });
    assert.equal(
      resolveArtifactNames(request([unknown])).outcome,
      "unresolved",
    );
    assert.equal(
      resolveArtifactNames(request([artifact({ titleTokens: ["lowercase"] })]))
        .outcome,
      "unresolved",
    );
    for (const directory of [
      "90 Resources",
      "90 Resources/00 Unclassified",
      "90 Resources/10 Miscellaneous",
      "30 Assessments/99 Other",
      "20 Tutorials/../NTULearn",
      "NTULearn",
      "10 Learning Materials/20 Textbook Chapters",
    ])
      assert.notEqual(
        resolveArtifactNames(
          request([
            artifact({
              destination: {
                category: "resource",
                directory,
                evidence: ["evidence:placement"],
              },
            }),
          ]),
        ).outcome,
        "resolved",
      );
  });

  it("uses exact existing category homes, flat assessments and accepted grouped tutorials", () => {
    const homes = [
      ["lecture", "10 Learning Materials/10 Lecture Materials"],
      ["personal-note", "10 Learning Materials/30 Personal Notes/Release"],
      ["tutorial", "20 Tutorials/Workshop 7"],
      ["quiz", "30 Assessments/10 Quizzes"],
      ["test", "30 Assessments/20 Tests"],
      ["midterm", "30 Assessments/30 Midterms"],
      ["final", "30 Assessments/40 Finals"],
      ["assignment", "30 Assessments/50 Assignments"],
      ["project", "40 Projects and Labs/10 Projects/30 Working/Outline"],
      ["lab", "40 Projects and Labs/20 Labs/40 Data"],
      ["resource", "90 Resources/10 Reference"],
    ] as const;
    for (const [category, directory] of homes) {
      const input = request([
        artifact({
          destination: {
            category,
            directory,
            evidence: ["evidence:placement"],
          },
        }),
      ]);
      assert.ok(
        resolvedPath(resolveArtifactNames(input)).startsWith(`${directory}/`),
      );
    }
    assert.equal(
      resolveArtifactNames(
        request([
          artifact({
            destination: {
              category: "quiz",
              directory: "30 Assessments/10 Quizzes/Nested",
              evidence: ["evidence:placement"],
            },
          }),
        ]),
      ).outcome,
      "unresolved",
    );
  });

  it("preserves exact evidenced Resource categories without inventing numeric prefixes", () => {
    for (const directory of [
      "90 Resources/Reference",
      "90 Resources/École Références/Collected",
      "90 Resources/10 Reference/Nested",
    ])
      assert.ok(
        resolvedPath(
          resolveArtifactNames(
            request([
              artifact({
                destination: {
                  category: "resource",
                  directory,
                  evidence: ["evidence:declared-category"],
                },
              }),
            ]),
          ),
        ).startsWith(`${directory}/`),
      );
  });

  it("resolves complete-set collisions using accepted meaning independent of enumeration", () => {
    const first = artifact({
      disambiguators: [
        { kind: "source-version", tokens: ["V1"], evidence: ["evidence:v1"] },
      ],
    });
    const second = artifact({
      id: "artifact:two",
      disambiguators: [
        { kind: "source-version", tokens: ["V2"], evidence: ["evidence:v2"] },
      ],
    });
    const plan = resolveArtifactNames(frozen(request([first, second])));
    assert.equal(plan.outcome, "resolved");
    assert.deepEqual(plan, resolveArtifactNames(request([second, first])));
    assert.ok(
      entries(plan).every(
        (entry) =>
          entry.kind === "resolved" && /_Version_V[12]\.pdf$/u.test(entry.path),
      ),
    );
    const ambiguous = resolveArtifactNames(
      request([artifact(), artifact({ id: "artifact:two" })]),
    );
    assert.equal(ambiguous.outcome, "unresolved");
    assert.ok(
      entries(ambiguous).every(
        (entry) => entry.kind === "unresolved" && !("path" in entry),
      ),
    );
  });

  it("handles accent, decomposition, Greek sigma, sharp-s and compatibility collisions with pinned Unicode", () => {
    for (const [left, right] of [
      ["École", "E\u0301cole"],
      ["Σ", "ς"],
      ["Straße", "STRASSE"],
      ["Ｋ", "K"],
      ["İ", "I\u0307"],
    ]) {
      const plan = resolveArtifactNames(
        request([
          artifact({ sourceTokens: [left ?? ""] }),
          artifact({ id: "artifact:two", sourceTokens: [right ?? ""] }),
        ]),
      );
      assert.equal(plan.outcome, "unresolved", `${left}/${right}`);
      assert.ok(
        entries(plan).every((entry) =>
          entry.diagnostics.some(({ code }) => code === "unresolved-collision"),
        ),
      );
    }
    const raw = artifact({
      titleTokens: ["E\u0301cole"],
      source: {
        id: "source:raw",
        legacyIdentity: null,
        title: "E\u0301cole",
        filename: "E\u0301cole.pdf",
        evidence: ["evidence:raw"],
      },
    });
    const plan = resolveArtifactNames(request([raw]));
    assert.ok(resolvedPath(plan).includes("École"));
    assert.equal(entries(plan)[0]?.artifact.source.title, "E\u0301cole");
    const normalization = entries(plan)[0]?.diagnostics.find(
      ({ kind }) => kind === "normalization",
    );
    assert.ok(normalization?.kind === "normalization");
    assert.equal(normalization.pointer, "/titleTokens/0");
    assert.equal(normalization.original, "E\u0301cole");
    assert.equal(normalization.normalized, "École");
    assert.ok(
      entries(plan)[0]?.diagnostics.some(
        ({ code }) => code === "normalized-nfc",
      ),
    );
  });

  it("checks occupied case variants, directories and generated disambiguators across intents", () => {
    const input = request();
    const path = resolvedPath(resolveArtifactNames(input));
    input.occupiedPaths = [
      {
        path: path.replace(/[^/]+$/u, (name) => name.toLowerCase()),
        kind: "file",
      },
    ];
    assert.equal(resolveArtifactNames(input).outcome, "unresolved");
    input.artifacts[0]?.disambiguators.push({
      kind: "source-id",
      tokens: ["Issued", "2"],
      evidence: ["evidence:id"],
    });
    assert.equal(resolveArtifactNames(input).outcome, "resolved");
    input.artifacts.push(
      artifact({
        id: "artifact:other",
        titleTokens: ["Synthetic", "Clean"],
        sourceTokens: ["Issued", "2"],
        traits: {
          content: "other",
          annotation: "unknown",
          grading: "unknown",
          evidence: ["evidence:unknown"],
        },
      }),
    );
    assert.equal(resolveArtifactNames(input).outcome, "unresolved");
    input.occupiedPaths = [
      { path: "10 Learning Materials", kind: "directory" },
    ];
    assert.equal(resolveArtifactNames(input).outcome, "resolved");
    input.occupiedPaths = [
      { path: "10 learning materials", kind: "directory" },
    ];
    assert.equal(resolveArtifactNames(input).outcome, "unresolved");
    input.occupiedPaths = [
      { path: "10 learning materials/Existing.pdf", kind: "file" },
    ];
    assert.equal(resolveArtifactNames(input).outcome, "unresolved");
  });

  it("refuses equivalent directory spellings and catches collisions introduced by a second qualification", () => {
    const first = artifact({
      destination: {
        category: "tutorial",
        directory: "20 Tutorials/Workshop",
        evidence: ["evidence:group"],
      },
    });
    const second = artifact({
      id: "artifact:two",
      titleTokens: ["Different"],
      destination: {
        category: "tutorial",
        directory: "20 Tutorials/WORKSHOP",
        evidence: ["evidence:group"],
      },
    });
    assert.equal(
      resolveArtifactNames(request([first, second])).outcome,
      "unresolved",
    );
    const one = artifact({
      disambiguators: [
        { kind: "source-version", tokens: ["V1"], evidence: ["evidence:v1"] },
      ],
    });
    const two = artifact({
      id: "artifact:two",
      disambiguators: [
        { kind: "source-version", tokens: ["V2"], evidence: ["evidence:v2"] },
      ],
    });
    const third = artifact({
      id: "artifact:three",
      titleTokens: ["Synthetic", "Clean", "Version", "V1"],
      traits: {
        content: "other",
        annotation: "unknown",
        grading: "unknown",
        evidence: ["evidence:unknown"],
      },
      disambiguators: [
        { kind: "edition", tokens: ["Third"], evidence: ["evidence:edition"] },
      ],
    });
    const input = request([one, two, third]);
    const plan = resolveArtifactNames(input);
    assert.equal(plan.outcome, "resolved");
    const thirdEntry = entries(plan).find(
      (entry) => entry.artifact.id === third.id,
    );
    assert.ok(
      thirdEntry?.kind === "resolved" &&
        thirdEntry.path.endsWith("_Edition_Third.pdf"),
    );
    assert.deepEqual(
      plan,
      resolveArtifactNames({
        ...input,
        artifacts: [...input.artifacts].reverse(),
      }),
    );
    const occupiedEntry = entries(plan).find(
      (entry) => entry.artifact.id === one.id,
    );
    assert.ok(occupiedEntry?.kind === "resolved");
    input.occupiedPaths = [{ path: occupiedEntry.path, kind: "file" }];
    assert.equal(resolveArtifactNames(input).outcome, "unresolved");
  });

  it("protects native bundle interiors and file ancestors across the whole intent set", () => {
    const first = artifact({
      destination: {
        category: "project",
        directory: "40 Projects and Labs/10 Projects/30 Working",
        evidence: ["evidence:work"],
      },
      representation: {
        kind: "native-bundle",
        role: "editable",
        extension: "pages",
        evidence: ["evidence:bundle"],
      },
    });
    const path = resolvedPath(resolveArtifactNames(request([first])));
    const second = artifact({
      id: "artifact:inside",
      destination: {
        category: "project",
        directory: path,
        evidence: ["evidence:work"],
      },
    });
    assert.equal(
      resolveArtifactNames(request([first, second])).outcome,
      "unresolved",
    );
    const occupied = request([second]);
    occupied.occupiedPaths = [{ path, kind: "native-bundle" }];
    assert.equal(resolveArtifactNames(occupied).outcome, "unresolved");
  });

  it("preserves explicit source sequence formatting and never strips importer prefixes as identity", () => {
    const input = request([
      artifact({
        sequence: {
          kind: "source",
          token: "1",
          format: "preserve",
          authority: "source-title",
          evidence: ["evidence:sequence"],
        },
        sourceTokens: ["00123"],
      }),
    ]);
    assert.ok(
      resolvedPath(resolveArtifactNames(input)).includes(
        "_1_Synthetic_Source_00123_Clean.pdf",
      ),
    );
    assert.equal(
      unnumberedSourcePath("01 Lectures/99 Sheet.pdf"),
      "Lectures/Sheet.pdf",
    );
    assert.equal(
      unnumberedSourcePath("100 Lectures/1000 Sheet.pdf"),
      "100 Lectures/1000 Sheet.pdf",
    );
  });

  it("keeps legacy curated grammar and dedicated textbook chapter grammar version-bound", () => {
    assert.equal(
      isCuratedFileName("MH2100_Lecture_03_Graph_Theory.pdf", "MH2100"),
      true,
    );
    assert.equal(isCuratedFileName("MH2100_Test_123.pdf", "MH2100"), false);
    assert.equal(
      isCuratedFileName("MH2100_Test_2025-2027.pdf", "MH2100"),
      false,
    );
    assert.equal(isCuratedFileName("MH2100_tutorial_1.pdf", "MH2100"), false);
    assert.equal(
      isChapterFileName(
        "MH2100_Tao_I_Chapter_05_The_Real_Numbers.pdf",
        "MH2100",
      ),
      true,
    );
  });

  it("refuses unsupported versions, duplicate identities, malformed traits and lexical JSON ambiguity", () => {
    const valid = request();
    assert.equal(
      resolveArtifactNames({ ...valid, schemaVersion: 2 }).outcome,
      "refused",
    );
    assert.equal(
      resolveArtifactNames({
        ...valid,
        policy: { ...valid.policy, collisionComparison: "locale" },
      }).outcome,
      "refused",
    );
    assert.equal(
      resolveArtifactNames(request([artifact(), artifact()])).outcome,
      "refused",
    );
    assert.equal(
      resolveArtifactNames({
        ...valid,
        artifacts: [
          {
            ...artifact(),
            traits: { ...artifact().traits, annotation: "clean+annotated" },
          },
        ],
      }).outcome,
      "refused",
    );
    const encoded = JSON.stringify(valid);
    assert.equal(
      planNamingJson(
        Buffer.from(
          encoded.replace(
            '"schemaVersion":1',
            '"schemaVersion":1,"schemaVersion":1',
          ),
        ),
      ).outcome,
      "refused",
    );
    assert.equal(planNamingJson(Buffer.from([0xff])).outcome, "refused");
    assert.equal(
      resolveArtifactNames(
        request([
          artifact({
            qualifiers: [
              { tokens: ["Annotated"], evidence: ["evidence:conflict"] },
            ],
          }),
        ]),
      ).outcome,
      "unresolved",
    );
  });

  it("rejects case and compatibility variants of contradictory trait qualifiers", () => {
    for (const token of [
      "Annotated",
      "ANNOTATED",
      "ＡＮＮＯＴＡＴＥＤ",
      "Graded",
      "Final",
    ])
      assert.equal(
        resolveArtifactNames(
          request([
            artifact({
              qualifiers: [
                { tokens: [token], evidence: ["evidence:qualifier"] },
              ],
            }),
          ]),
        ).outcome,
        "unresolved",
      );
  });

  it("preserves uncased scripts, titlecase letters and lowercase source versions", () => {
    for (const title of ["中文", "ǅuro", "ʕA"])
      assert.equal(
        resolveArtifactNames(request([artifact({ titleTokens: [title] })]))
          .outcome,
        "resolved",
      );
    const first = artifact({
      disambiguators: [
        { kind: "source-version", tokens: ["v1"], evidence: ["evidence:v1"] },
      ],
    });
    const second = artifact({
      id: "artifact:two",
      disambiguators: [
        { kind: "source-version", tokens: ["v2"], evidence: ["evidence:v2"] },
      ],
    });
    const plan = resolveArtifactNames(request([first, second]));
    assert.equal(plan.outcome, "resolved");
    assert.ok(
      entries(plan).every(
        (entry) =>
          entry.kind === "resolved" && /_Version_v[12]\.pdf$/u.test(entry.path),
      ),
    );
  });

  it("reports unsupported Unicode and component limits without truncation or fallback", () => {
    assert.equal(
      resolveArtifactNames(
        request([artifact({ sourceTokens: [String.fromCodePoint(0x1c8a)] })]),
      ).outcome,
      "resolved",
    );
    const input = request();
    input.occupiedPaths = [
      { path: `20 Tutorials/${String.fromCodePoint(0x0378)}`, kind: "file" },
    ];
    assert.equal(resolveArtifactNames(input).outcome, "unresolved");
    assert.equal(
      resolveArtifactNames(
        request([artifact({ titleTokens: ["A".repeat(240)] })]),
      ).outcome,
      "unresolved",
    );
  });
});
