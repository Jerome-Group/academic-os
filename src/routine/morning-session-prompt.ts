export const MORNING_SESSION_RESULT_FILENAME = "result.json";

// The prompt holds no rule the module folder already holds: the router and the seeded procedure are
// the pass's instructions, and what is cached here is only what a folder cannot tell a session —
// that nobody is awake, how far the derived-docs mandate reaches this morning, and where the wrapper
// reads the outcome back.
export function morningSessionPrompt(input: {
  module: string;
  resultPath: string;
}): string {
  return `You are the 06:00 morning routine's pass over ${input.module}, running unattended in that module's folder.

Nobody is awake to answer a question. Precedent is your only resolver: where the registers, \`CONTEXT.md\` and the module's own ADRs settle a decision, take it; where they leave it open or disagree, park the item with its evidence. A parked item is a good outcome, an invented one is not.

## Steps

1. Read \`AGENTS.md\` and take its **Curation** route. Run \`docs/10 Curation Procedure.md\` end to end. Done when every item the arrival walk found is either already decided in the Curation register or newly decided by this pass — curated, rederived, superseded or parked.
2. Apply the derived-docs mandate to what step 1 touched, and to nothing else: a \`CONTEXT.md\` term or a module ADR earns its place only from an ambiguity this morning's arrivals or decisions actually bit on. Load the domain-modeling discipline before writing either, and keep an ADR immutable — a change of mind is a new superseding ADR.
3. Write \`${input.resultPath}\` as JSON in the shape below. Write it last, and write it whatever happened: a pass that broke reports what broke in \`failures\`.

## The result file

\`\`\`json
{
  "curated": [{ "item": "", "destination": "" }],
  "rederived": [{ "item": "", "derived": [""] }],
  "superseded": [{ "item": "", "destination": "" }],
  "parked": [{ "item": "", "reason": "", "evidence": "" }],
  "docWrites": [{ "file": "", "summary": "" }],
  "failures": [{ "code": "", "message": "" }]
}
\`\`\`

Every key is present; an empty morning is six empty arrays. \`item\` is the source path the register identifies the item by, \`destination\` the placed copy's path, \`derived\` the artifact paths a rederivation integrated the content into, and \`evidence\` what a parked item shows the Owner so they can settle it. Every \`CONTEXT.md\` term and every module ADR this pass wrote appears in \`docWrites\`; the Owner reads that list to review a write nobody watched.

## Bounds

- The morning's Task-register pull has already run. Report what you found and leave the register and the live list as the pull left them.
- Leave every \`.tex\` for a teaching session to compile.
- Reach only this module's folder. Importer roots are read to be curated out of, and keep their own names and layout.
`;
}
