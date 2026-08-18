// A seed-source template is named for the module file it becomes, with `.template` before the
// extension. This file owns that convention in both directions.
const templateInfix = /\.template(\.[^./]+)$/u;

export function seedSourceTemplatePath(destinationPath: string): string {
  return destinationPath.replace(/(\.[^./]+)$/u, ".template$1");
}

export function isSeedSourceTemplate(path: string): boolean {
  return templateInfix.test(path);
}

export function destinationPath(sourcePath: string): string {
  return sourcePath.replace(templateInfix, "$1");
}
