import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import { build } from "esbuild";

const [output, ...extra] = process.argv.slice(2);
if (!output || !isAbsolute(output) || extra.length)
  throw new Error("Supply one absolute standalone output directory.");
const manifest = JSON.parse(
  await readFile("dist/src/controls-publication/release.json", "utf8"),
);
for (const binding of manifest.sourceBindings) {
  if (
    createHash("sha256")
      .update(await readFile(binding.path))
      .digest("hex") !== binding.sha256
  )
    throw new Error(
      "Publication source differs from its built release. Run npm run build.",
    );
}
if (process.platform === "darwin") {
  const native = createRequire(import.meta.url)(
    resolve("dist/src/controls-publication/native/publication-native.node"),
  );
  if (native.nativeBoundaryVersion !== 1 || native.buildKind !== "production")
    throw new Error(
      "Standalone packaging requires the production native artifact.",
    );
  if (
    createHash("sha256")
      .update(
        await readFile(
          "dist/src/controls-publication/native/publication-native.node",
        ),
      )
      .digest("hex") !== manifest.nativeDigest
  )
    throw new Error("Publication native artifact differs from its release.");
}
await mkdir(join(output, "native"), { recursive: true, mode: 0o700 });
await writeFile(join(output, "native/package.json"), '{"type":"module"}\n');
for (const [entryPoint, filename] of [
  ["src/controls-publication/standalone.ts", "publication.mjs"],
  ["src/controls-publication/host-deployment.ts", "host-deployment.mjs"],
])
  await build({
    entryPoints: [entryPoint],
    outfile: join(output, filename),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    sourcemap: false,
    legalComments: "inline",
    banner: {
      js: 'import { createRequire as publicationBundleCreateRequire } from "node:module"; const require = publicationBundleCreateRequire(import.meta.url);',
    },
    plugins: [
      {
        name: "publication-native-loader",
        setup(plugin) {
          plugin.onResolve({ filter: /\/native\/index\.js$/ }, (args) =>
            args.importer.includes("controls-publication")
              ? { path: "./native/index.js", external: true }
              : undefined,
          );
        },
      },
    ],
  });
for (const name of [
  "index.js",
  ...(process.platform === "darwin" ? ["publication-native.node"] : []),
])
  await copyFile(
    resolve("dist/src/controls-publication/native", name),
    join(output, "native", name),
  );
await copyFile(
  "dist/src/controls-publication/release.json",
  join(output, "release.json"),
);
await chmod(join(output, "publication.mjs"), 0o755);
await chmod(join(output, "host-deployment.mjs"), 0o755);
