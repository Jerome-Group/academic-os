import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Bytes } from "../../src/checksum.js";

export const emmyPlanningSourceCommit =
  "9235befe03916b776ba40c6234d9e83716667b3f";
export const emmyPlanningManifestSha256 =
  "21ab6319f4bafecdf55d920cecdc72f1b8c1d7c313aa9102a4e89c54343c40a3";
const bundle = new URL(
  "../../../vendor/emmy-planning/9235befe/",
  import.meta.url,
);
const fixturePins = [
  {
    path: "academic-os-plan-fixtures.mjs",
    bytes: 3663,
    sha256: "1a5408b97b9ca870b8a641d09afef5d4edef29034b81f110ee0f4d499f8f48ca",
  },
  {
    path: "academic-os-planning-fixtures.mjs",
    bytes: 1466,
    sha256: "a0f4b768b60de9571c80bc12fde4b40c4aab06cca13f83a3f3cf1d43c454ae81",
  },
];

/** Tests alone default to this bundle; installed service configuration remains explicit. */
export async function emmyPlanningTestSources(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const releasePath = await realpath(
    environment.ACADEMIC_OS_TEST_EMMY_RELEASE ??
      fileURLToPath(new URL("runtime/", bundle)),
  );
  const fixturesPath = await realpath(
    environment.ACADEMIC_OS_TEST_EMMY_FIXTURES ??
      fileURLToPath(
        new URL(
          "../../../test/support/emmy-planning-fixtures/",
          import.meta.url,
        ),
      ),
  );
  await requirePin(
    join(releasePath, "planning-source-manifest.json"),
    2653,
    emmyPlanningManifestSha256,
  );
  for (const pin of fixturePins)
    await requirePin(
      join(fixturesPath, "verification", pin.path),
      pin.bytes,
      pin.sha256,
    );
  if (environment.ACADEMIC_OS_TEST_EMMY_RELEASE === undefined)
    await requirePin(
      fileURLToPath(new URL("LICENSE", bundle)),
      1069,
      "58755b8e71337177b1dfe00e0fe5d502ca8263743613816f6645c23767a6584e",
    );
  return {
    releasePath,
    fixturesPath,
    sourceCommit: emmyPlanningSourceCommit,
    manifestSha256: emmyPlanningManifestSha256,
  };
}

async function requirePin(
  path: string,
  bytes: number,
  sha256: string,
): Promise<void> {
  const contents = await readFile(path);
  if (contents.length !== bytes || sha256Bytes(contents) !== sha256)
    throw new Error(
      `Reviewed Emmy test dependency does not match its pin: ${path}`,
    );
}
