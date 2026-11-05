export function repositoryPermissionProfile(
  access: "write" | "read",
  fixtureRoot?: string,
): { name: string; configuration: string } {
  const name =
    access === "write"
      ? "academic-os-repository"
      : "academic-os-repository-review";
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
