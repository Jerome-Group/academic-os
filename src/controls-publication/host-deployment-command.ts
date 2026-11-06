import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  installNativeSourcePolicy,
  openInstalledHostDeployment,
  registerHostDeployment,
  retryNativeSourcePolicy,
} from "./native-source-policy.js";
import {
  parseBytes,
  validateHostInstallInput,
  validateHostRegistrationInput,
} from "./schema.js";

export async function runHostDeploymentCommand(args: string[]): Promise<void> {
  const [action, option, value, ...extra] = args;
  if (
    extra.length ||
    !value ||
    (action === "retry-native-source-policy"
      ? option !== "--request"
      : option !== "--input" || !isAbsolute(value))
  )
    throw new Error(
      "Use register --input <absolute-json>, install-native-source-policy --input <absolute-json>, or retry-native-source-policy --request <request-id>.",
    );
  let result:
    | Awaited<ReturnType<typeof registerHostDeployment>>
    | Awaited<ReturnType<typeof installNativeSourcePolicy>>;
  if (action === "register")
    result = await registerHostDeployment(
      parseBytes(await readFile(value), validateHostRegistrationInput),
    );
  else if (
    action === "install-native-source-policy" ||
    action === "retry-native-source-policy"
  ) {
    const authority = await openInstalledHostDeployment();
    result =
      authority.kind !== "trusted-host-deployment"
        ? authority
        : action === "install-native-source-policy"
          ? await installNativeSourcePolicy({
              deployment: authority.deployment,
              request: parseBytes(
                await readFile(value),
                validateHostInstallInput,
              ),
            })
          : await retryNativeSourcePolicy({
              deployment: authority.deployment,
              requestId: value,
            });
  } else throw new Error("Unknown deliberate host deployment operation.");
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (
    "kind" in result &&
    (result.kind === "refused" || result.kind === "recovery-required")
  )
    process.exitCode = 2;
}
