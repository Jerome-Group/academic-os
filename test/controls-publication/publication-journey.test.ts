import { it } from "node:test";
import { runPublicationJourney } from "./journey.js";

it("publishes CLI A and MCP B, reads standalone current B and pinned A, and replays A without republishing", {
  skip: process.platform !== "darwin",
  timeout: 60_000,
}, async (context) => {
  const evidence = await runPublicationJourney();
  context.diagnostic(`Retained publication fixture ${evidence}`);
});
