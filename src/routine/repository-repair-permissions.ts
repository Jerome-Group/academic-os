import { randomUUID } from "node:crypto";

export function repositoryPermissionProfile(
  access: "write" | "read",
  fixtureRoot?: string,
): { name: string; configuration: string } {
  const name = `academic-os-repository-${access}-${randomUUID()}`;
  const filesystem = [
    '":tmpdir" = "read"',
    '":slash_tmp" = "read"',
    ...(access === "write" && fixtureRoot !== undefined
      ? [`${JSON.stringify(fixtureRoot)} = "write"`]
      : []),
  ];
  return {
    name,
    configuration: `permissions.${name}={ extends = "${access === "write" ? ":workspace" : ":read-only"}", filesystem = { ${filesystem.join(", ")} }, network = { enabled = false } }`,
  };
}
