export const researchProjectControlPaths = {
  profile: "00 Project Admin/00 Project Profile.md",
  definition: "00 Project Admin/10 Project Definition.yaml",
  sourceRegister: "00 Project Admin/20 Source Register.yaml",
  taskRegister: "00 Project Admin/30 Task Register.yaml",
  researchMap: "00 Project Admin/40 Research Map.yaml",
  deliverableRegister: "00 Project Admin/50 Deliverable Register.yaml",
  contributionAndAiUse: "00 Project Admin/60 Contribution and AI Use.md",
  claims: "70 Research/CLAIMS.md",
  questions: "70 Research/QUESTIONS.md",
  agents: "AGENTS.md",
  claude: "CLAUDE.md",
  context: "CONTEXT.md",
  structureAndNaming: "docs/00 Structure and Naming.md",
  sourcesAndProvenance: "docs/10 Sources and Provenance.md",
  researchProcedure: "docs/20 Research Procedure.md",
  deliverablesProcedure: "docs/30 Deliverables Procedure.md",
} as const;

export type ResearchProjectControls = Partial<
  Record<keyof typeof researchProjectControlPaths, string>
>;
