export function identityUnit(label: string): string {
  return `{ topics: [${label}], lectures: [${label}.md], textbook: [], tutorials: [{ block: ${label}, exercises: ${label}-exercises, sources: [{ file: ${label}-tutorial.md, locator: ${label}-locator, role: ${label}-role, missing: [${label}-missing] }] }] }`;
}

export const collidingSourceMaps = [
  `units: { 1: ${identityUnit("first")}, '1': ${identityUnit("second")} }`,
  `units: { '1': ${identityUnit("first")}, 1: ${identityUnit("second")} }`,
  `%YAML 1.1\n---\nunits: { <<: { 1: ${identityUnit("first")} }, '1': ${identityUnit("second")} }`,
  `%YAML 1.1\n---\nunits: { <<: [{ '1': ${identityUnit("first")} }, { 1: ${identityUnit("second")} }] }`,
  `%YAML 1.1\n---\nunits: { <<: { null: ${identityUnit("first")}, 1: ${identityUnit("second")} }, null: ${identityUnit("third")}, '1': ${identityUnit("fourth")} }`,
  `%YAML 1.1\n---\nunits: { <<: { null: ${identityUnit("first")}, 'null': ${identityUnit("second")} }, null: ${identityUnit("third")} }`,
  `units: { &number 1: ${identityUnit("first")}, '1': ${identityUnit("second")} }`,
  `units: { First: { topics: [&number 1], lectures: [], textbook: [], tutorials: [] }, *number : ${identityUnit("first")}, '1': ${identityUnit("second")} }`,
  `%YAML 1.1\n---\nunits: { !!str <<: { 1: ${identityUnit("first")} }, '1': ${identityUnit("second")} }`,
  `%YAML 1.1\n---\nunits: { '1': ${identityUnit("second")}, !!str <<: { 1: ${identityUnit("first")} } }`,
  `%YAML 1.1\n---\nunits: { !!str <<: { 1: malformed }, '1': ${identityUnit("second")} }`,
  `%YAML 1.1\n---\nunits: { !!str <<: { null: ${identityUnit("first")}, 1: ${identityUnit("second")} }, null: ${identityUnit("third")}, '1': ${identityUnit("fourth")} }`,
  `%YAML 1.1\n---\nunits: { !!str <<: { null: ${identityUnit("first")}, 'null': ${identityUnit("second")} }, null: ${identityUnit("third")} }`,
  `%YAML 1.1\n---\nunits: { null: ${identityUnit("third")}, !!str <<: { null: ${identityUnit("first")}, 'null': ${identityUnit("second")} } }`,
  `%YAML 1.1\n---\nunits: { !!str <<: [{ null: ${identityUnit("first")} }, { 'null': ${identityUnit("second")} }] }`,
  `%YAML 1.1\n---\nunits: { !!str <<: [{ 'null': ${identityUnit("second")} }, { null: ${identityUnit("first")} }] }`,
] as const;

export const orderedSourceMap = `units:\n  Stage B: &first ${identityUnit("first").replace("[first]", "[&name first]")}\n  2: ${identityUnit("second")}\n  '1': ${identityUnit("third")}\n  '01': ${identityUnit("fourth")}\n  Stage C: ${identityUnit("fifth")}\n  *name : ${identityUnit("sixth")}\n  Repeat: *first\n`;

export const orderedUnits = [
  ["Stage B", "first"],
  ["2", "second"],
  ["1", "third"],
  ["01", "fourth"],
  ["Stage C", "fifth"],
  ["first", "sixth"],
  ["Repeat", "first"],
] as const;

export const nativeObjectUnits = [
  [String(new Date("2026-01-01")), "alpha"],
  ["*day", "beta"],
] as const;

const completeUnit = (label: string, week: number) =>
  `{ topics: [${label}], historical_reference: [${label}-history.md], teaching_weeks: [${week}], tutorials: [{ block: ${label}-block, exercises: ${label}-exercises, sources: [{ file: ${label}-tutorial.md, locator: ${label}-locator, role: ${label}-role, missing: [${label}-missing] }] }], lectures: [${label}.md], supplementary_materials: [${label}-supplement.md], textbook: [${label}-textbook.md], practice_tests: [${label}-practice.md], past_papers: [${label}-past.md] }`;

export const nativeObjectSourceMap = `%YAML 1.1\n---\nunits:\n  <<:\n    &day !!timestamp 2026-01-01: ${completeUnit("alpha", 1)}\n  *day : ${completeUnit("beta", 2)}\n`;

export const completeCategories = [
  ["historical_reference", "history"],
  ["tutorials", "tutorial"],
  ["lectures", ""],
  ["supplementary_materials", "supplement"],
  ["textbook", "textbook"],
  ["practice_tests", "practice"],
  ["past_papers", "past"],
] as const;

export const nativeObjectPaths = nativeObjectUnits.flatMap(([, label]) =>
  completeCategories.map(([, suffix]) =>
    suffix === "" ? `${label}.md` : `${label}-${suffix}.md`,
  ),
);

export const nativeObjectCandidates = nativeObjectUnits.flatMap(
  ([unit, label]) =>
    completeCategories.map(([role, suffix]) => ({
      unit,
      topics: [label],
      path: suffix === "" ? `${label}.md` : `${label}-${suffix}.md`,
      locator: role === "tutorials" ? `${label}-locator` : "whole file",
      role: role === "tutorials" ? `${label}-role` : role,
      missing: role === "tutorials" ? [`${label}-missing`] : [],
    })),
);

export const nativeObjectLearningUnits = nativeObjectUnits.map(
  ([unit, label], index) => {
    const reference = (category: string, suffix: string) => [
      {
        category,
        file: suffix === "" ? `${label}.md` : `${label}-${suffix}.md`,
        availability: "available",
      },
    ];
    return {
      unit,
      topics: [label],
      teachingWeeks: [index + 1],
      lectures: reference("lectures", ""),
      textbook: reference("textbook", "textbook"),
      tutorials: [
        {
          kind: "block",
          block: `${label}-block`,
          exercises: `${label}-exercises`,
          sources: [
            {
              ...reference("tutorials", "tutorial")[0],
              locator: `${label}-locator`,
              role: `${label}-role`,
              declaredMissing: [`${label}-missing`],
            },
          ],
        },
      ],
      supplementaryMaterials: reference(
        "supplementary_materials",
        "supplement",
      ),
      pastPapers: reference("past_papers", "past"),
      practiceTests: reference("practice_tests", "practice"),
      historicalReference: reference("historical_reference", "history"),
      status: "gaps",
    };
  },
);
