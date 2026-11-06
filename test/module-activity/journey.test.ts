import { it } from "node:test";
import { runModuleActivityJourney } from "./journey.js";

it("drives v2 structural Module controls and generated activities through compiled CLI, HTTP MCP, recovery and extracted readers", {
  skip: process.platform !== "darwin",
  timeout: 180_000,
}, async (context) => {
  context.diagnostic(
    `Retained Module activity fixture ${await runModuleActivityJourney()}`,
  );
});
