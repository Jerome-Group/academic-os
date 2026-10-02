import { OperationalError } from "../operational-error.js";

export interface MorningSessionSettings {
  model: string;
  reasoningEffort: string;
}

const solEfforts = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);

export function validateMorningSessionOverride(
  input: MorningSessionSettings,
): MorningSessionSettings {
  if (input.model !== "gpt-6.1-sol" || !solEfforts.has(input.reasoningEffort)) {
    throw new OperationalError(
      "invalid-arguments",
      "Morning session overrides require gpt-6.1-sol and a supported reasoning effort (low, medium, high, xhigh, max, ultra).",
    );
  }
  return input;
}
