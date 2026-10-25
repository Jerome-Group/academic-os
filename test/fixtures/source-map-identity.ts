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
] as const;

export const orderedSourceMap = `units:\n  Week 02: &first ${identityUnit("first").replace("[first]", "[&name first]")}\n  2: ${identityUnit("second")}\n  '1': ${identityUnit("third")}\n  '01': ${identityUnit("fourth")}\n  Week 03: ${identityUnit("fifth")}\n  *name : ${identityUnit("sixth")}\n  Repeat: *first\n`;

export const orderedUnits = [
  ["Week 02", "first"],
  ["2", "second"],
  ["1", "third"],
  ["01", "fourth"],
  ["Week 03", "fifth"],
  ["first", "sixth"],
  ["Repeat", "first"],
] as const;
