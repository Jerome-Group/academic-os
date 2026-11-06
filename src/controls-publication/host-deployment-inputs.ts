import { isAbsolute, join, normalize } from "node:path";
import { parseConfig } from "../config/parse-config.js";
import { canonicalBase64, digest, encodePublication, sha256 } from "./codec.js";
import { refuse } from "./failure.js";
import type { HostRegistrationInput } from "./generated/native-source-contract-1.js";
import type {
  PublicationNative,
  ValidatedAccountAnchor,
} from "./native-contract.js";
import { runtimeDirectory } from "./release.js";
import { validateHostRegistration } from "./schema.js";
import { nativeValue } from "./store.js";

export function locator(value: string): Uint8Array {
  if (!canonicalBase64(value))
    refuse("invalid-controls", "A deployment locator is not canonical base64.");
  const raw = Buffer.from(value, "base64");
  if (raw.length > 16384 || raw[0] !== 47 || raw.includes(0))
    refuse(
      "invalid-controls",
      "A deployment locator must be an absolute NUL-free raw path.",
    );
  return raw;
}

function relativeRoot(parent: string, value: string): string {
  if (
    isAbsolute(value) ||
    normalize(value) !== value ||
    value
      .split("/")
      .some((part) => part === "" || part === "." || part === "..") ||
    value.includes("\\")
  )
    refuse(
      "unsafe-namespace",
      "A registered configuration contains an unsupported relative root.",
    );
  return join(parent, value);
}

export function observeHostDeployment(input: {
  native: PublicationNative;
  anchor: ValidatedAccountAnchor;
  request: Pick<HostRegistrationInput, "configurations" | "repositories">;
}) {
  const { native, anchor, request } = input;
  if (
    new Set(request.configurations).size !== request.configurations.length ||
    new Set(request.repositories).size !== request.repositories.length
  )
    refuse(
      "invalid-controls",
      "Registered configuration and repository locators must be unique.",
    );
  const paths: Uint8Array[] = [Buffer.from(runtimeDirectory)];
  const configurations = request.configurations.map((path) => {
    const observed = nativeValue(
      native.readDeploymentFile({ anchor, locator: locator(path) }),
    );
    const config = parseConfig(observed.bytes);
    if (config.schemaVersion !== 1)
      refuse(
        "invalid-controls",
        "Host deployment requires explicit configuration schemaVersion 1.",
      );
    paths.push(Buffer.from(config.driveMount), Buffer.from(config.stateRoot));
    if ("semesters" in config) {
      for (const semester of Object.values(config.semesters)) {
        const root = relativeRoot(config.driveMount, semester.root);
        paths.push(Buffer.from(root));
        for (const module of semester.modules)
          paths.push(Buffer.from(join(root, module)));
      }
      if (config.research) {
        const root = relativeRoot(config.driveMount, config.research.root);
        paths.push(Buffer.from(root));
        for (const project of Object.values(config.research.projects))
          paths.push(Buffer.from(relativeRoot(root, project.folder)));
      }
    } else if ("semesterRoots" in config) {
      for (const root of Object.values(config.semesterRoots))
        paths.push(Buffer.from(relativeRoot(config.driveMount, root)));
      const root = config.semesterRoots[config.semester];
      if (!root)
        refuse(
          "invalid-controls",
          "Registered local configuration has no selected semester root.",
        );
      paths.push(
        Buffer.from(join(relativeRoot(config.driveMount, root), config.module)),
      );
    }
    if (config.textbooks)
      paths.push(
        Buffer.from(
          relativeRoot(config.driveMount, config.textbooks.shelfRoot),
        ),
      );
    const endpoint = observed.path.components.at(-1);
    if (!endpoint)
      refuse(
        "unsafe-namespace",
        "Registered configuration ancestry is absent.",
      );
    return {
      locatorBase64: path,
      object: endpoint.object,
      ancestryDigest: digest({
        locatorBase64: observed.path.locatorBase64,
        signature: observed.path.signature,
      }),
      byteLength: String(observed.bytes.byteLength),
      sha256: sha256(observed.bytes),
    };
  });
  paths.push(...request.repositories.map(locator));
  const distinct = [
    ...new Map(
      paths.map((path) => [Buffer.from(path).toString("base64"), path]),
    ).values(),
  ].sort((a, b) => Buffer.compare(a, b));
  if (distinct.length > 64)
    refuse(
      "invalid-controls",
      "Registered roots exceed the native exclusion bound of 64.",
    );
  const exclusions = nativeValue(
    native.observeExclusionRoots({
      anchor,
      requiredRepositoryAndSourcePaths: distinct,
    }),
  );
  const roots = nativeValue(native.describeExclusionRoots(anchor));
  const registration = {
    schema: "academic-os-host-deployment/1",
    hostAccountDigest: digest(anchor.host),
    configurations: [...request.configurations],
    repositories: [...request.repositories],
    configurationSetDigest: digest(configurations),
    exclusionSetDigest: digest(roots),
    coverage: "registered-deployments-only",
    configurationBindings: configurations,
    negativeRoots: roots.roots.map((root) => ({
      locatorBase64: root.locatorBase64,
      resolvedLocatorBase64: root.resolvedLocatorBase64,
      signatureDigest: digest(root.signature),
      absent: root.absent,
      ancestry: [...root.ancestry],
    })),
    cloudChildrenDigest: digest(roots.cloudChildren),
  };
  if (!validateHostRegistration(registration))
    refuse(
      "invalid-controls",
      "Observed deployment registration exceeds its closed shape or bounds.",
    );
  if (encodePublication(registration).byteLength > 1048576)
    refuse(
      "invalid-controls",
      "Host deployment registration exceeds 1 MiB before installation effects.",
    );
  return {
    registration,
    exclusions,
    configurations,
    roots,
    inputBindingDigest: digest({ registration, configurations, roots }),
  };
}
