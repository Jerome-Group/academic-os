import { it } from "node:test";
import { runPublicationJourney } from "./journey.js";

it("replays history beyond 64 MiB, publishes CLI A and MCP B, reads standalone current B and pinned A, and replays A without republishing", {
  skip: process.platform !== "darwin",
  timeout: 300_000,
}, async (context) => {
  const evidence = await runPublicationJourney(undefined, {
    largeHistory: true,
  });
  context.diagnostic(`Retained publication fixture ${evidence}`);
});
