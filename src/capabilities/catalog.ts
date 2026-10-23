import { checkProfiles } from "./checks.js";

export interface Capability {
  id: string;
  surface: "cli" | "cheatsheet" | "mcp" | "script" | "quality";
  invocation: string;
  prerequisites: string[];
  reads: string[];
  writes: string[];
  riskFlags: string[];
  preview: string | null;
  implementation: string;
  tests: string[];
  status: "supported";
  health: "not-observed";
  result: string;
  options?: Record<string, string>;
}

function cli(
  id: string,
  writes: string[],
  prerequisites: string[] = [],
  preview: string | null = null,
  tests: string[] = [],
): Capability {
  const stem = id.replaceAll(" ", "-");
  const operation =
    id.startsWith("tasks ") &&
    ["create", "change", "complete", "cancel"].includes(id.split(" ")[1] ?? "")
      ? "tasks-operate"
      : stem;
  return {
    id,
    surface: "cli",
    invocation: `node dist/src/cli.js ${id} --config <private-config> --json`,
    prerequisites: [
      "Node >=24",
      "npm ci && npm run build",
      "valid private target configuration",
      ...prerequisites,
    ],
    reads: [
      "configured target controls/state",
      ...(prerequisites.some((p) => p.includes("Google"))
        ? ["configured Google service"]
        : []),
    ],
    writes,
    riskFlags: [
      ...(writes.length ? ["writes-state"] : []),
      ...(writes.some((w) => w.includes("removed")) ? ["retention-purge"] : []),
      ...(writes.some((w) => w.includes("Google") || w.includes("GitHub"))
        ? ["external-write", "requires-target-authorization"]
        : []),
      ...(writes.some((w) => w.includes("content"))
        ? ["academic-content", "requires-target-authorization"]
        : []),
    ],
    preview,
    implementation: `src/commands/${operation}-command.ts`,
    tests: tests.length ? tests : [`test/cli/${operation}-cli.test.ts`],
    status: "supported",
    health: "not-observed",
    result:
      "JSON with --json; legacy action-specific outcome and exit codes; operational errors exit 2. See implementation and mapped tests.",
  };
}

export const cliCapabilities: Capability[] = [
  cli(
    "audit",
    ["private audit observation history"],
    ["Drive API inventory additionally requires read credentials"],
    null,
    [
      "test/cli/audit-cli.test.ts",
      "test/cli/cohort-audit-cli.test.ts",
      "test/cli/research-project-cli.test.ts",
    ],
  ),
  cli(
    "seed",
    ["private seed journal/staging", "mounted content with --apply"],
    ["profile and definition; containment and exclusive publication"],
    "omit --apply",
    ["test/cli/seed-cli.test.ts", "test/cli/research-project-cli.test.ts"],
  ),
  cli(
    "repair",
    [
      "private recovery journal",
      "Google Drive and mounted content with --apply",
    ],
    [
      "approved ID-bound plan; complete inventory; independent byte and Drive recoveries",
    ],
    "omit --apply",
    ["test/cli/repair-cli.test.ts", "test/repair/resume-repair.test.ts"],
  ),
  cli(
    "pinned refresh",
    ["private backups/journal", "mounted pinned content with --apply"],
    [],
    "omit --apply",
  ),
  cli(
    "curation migrate",
    [
      "private curation journal with --apply",
      "mounted register content with --apply",
    ],
    [],
    "omit --apply",
  ),
  cli(
    "curation rederive",
    [
      "private curation journal with --apply",
      "mounted register content with --apply",
    ],
    [],
    "omit --apply",
    ["test/curation/plan-curation-rederivation.test.ts"],
  ),
  cli(
    "calendar setup",
    ["private calendar state", "Google Calendar with --apply"],
    ["Google Calendar write credentials"],
    "omit --apply",
  ),
  cli(
    "calendar refresh",
    ["private calendar mirror"],
    ["Google Calendar read credentials"],
  ),
  cli(
    "calendar propose",
    ["private proposal state"],
    [
      "proposal input; current calendar evidence; Google Calendar read credentials",
    ],
  ),
  cli(
    "calendar promote",
    ["Google Calendar events", "private proposal state/mirror"],
    [
      "proposal ID; fresh conflict checks; Google Calendar read and write credentials",
    ],
  ),
  cli(
    "tasks provision",
    ["private task state", "Google Tasks list with --apply"],
    ["exact Module or Research-project target; Google Tasks write credentials"],
    "omit --apply",
    [
      "test/cli/tasks-provision-cli.test.ts",
      "test/cli/research-tasks-cli.test.ts",
    ],
  ),
  cli(
    "tasks refresh",
    ["mounted task register content"],
    ["Google Tasks read credentials"],
    null,
    [
      "test/cli/tasks-refresh-cli.test.ts",
      "test/cli/research-tasks-cli.test.ts",
    ],
  ),
  ...["create", "change", "complete", "cancel"].map((action) =>
    cli(
      `tasks ${action}`,
      ["Google Tasks", "mounted task register content"],
      [
        "exact Module or Research-project target; Google Tasks write and read credentials",
      ],
      null,
      [
        "test/cli/tasks-operate-cli.test.ts",
        "test/cli/research-tasks-cli.test.ts",
      ],
    ),
  ),
  cli(
    "textbooks catch-up",
    ["mounted shelf index content with --apply"],
    [],
    "omit --apply",
  ),
  cli("textbooks sweep", ["private shelf review sheet"], [], null, [
    "test/textbooks/plan-shelf-sweep.test.ts",
  ]),
  cli(
    "textbooks migrate",
    ["mounted shelf content with --apply"],
    ["reviewed migration sheet"],
    "omit --apply",
    ["test/textbooks/execute-shelf-migration.test.ts"],
  ),
  {
    ...cli(
      "routine morning",
      [
        "mounted maintenance content",
        "private logs/journals",
        "GitHub managed issues",
        "protected repository pull requests and clean primary checkout rollout",
        "ordinary expired artifacts removed unless --retain-artifacts",
      ],
      [
        "Codex executable; gh; scheduled Google read credentials",
        "bundled rg on the session PATH; supported package metadata or flat installation",
        "canonical docs/agents/safe-drive-testing.md in the repository installation",
        "separately authorized live scope and verified backups",
      ],
      null,
      [
        "test/cli/routine-morning-cli.test.ts",
        "test/routine/codex-module-session.test.ts",
        "test/routine/codex-search-path.test.ts",
        "test/routine/cohort-prelude.test.ts",
        "test/routine/file-routine-artifacts.test.ts",
        "test/routine/maintenance-safety-evidence.test.ts",
        "test/routine/morning-session-prompt.test.ts",
        "test/routine/run-morning-routine.test.ts",
        "test/routine/weekly-review.test.ts",
        "test/routine/repository-repair.test.ts",
        "test/routine/file-weekly-evidence.test.ts",
        "test/routine/gh-weekly-repository-history.test.ts",
      ],
    ),
    options: {
      "--retain-artifacts":
        "Exclusive private run directory and report; skips ordinary retention purge.",
      "--modules-only":
        "Refresh active Module task mirrors only; skip shared shelf writes and repository repair; update only this weekly coverage scope.",
      "--model":
        "gpt-6.1-sol; pair with --reasoning-effort; scoped invocation.",
      "--reasoning-effort":
        "low|medium|high|xhigh|max|ultra; pair with --model.",
    },
  },
  {
    ...cli(
      "routine repository-repair",
      [
        "private retained check/repair evidence",
        "isolated repository checkout",
        "GitHub issues and protected pull requests",
        "clean primary repository rollout",
      ],
      [
        "configured Codex and gh executables",
        "clean main checkout; macOS Codex sandbox; available repository checks",
        "repo repair/merge authority; strict required checks and fresh independent review",
      ],
      "--check-only",
      [
        "test/routine/repository-repair.test.ts",
        "test/cli/routine-repository-repair-cli.test.ts",
      ],
    ),
    riskFlags: [
      "writes-state",
      "external-write",
      "requires-target-authorization",
      "protected-merge",
      "bounded-agent-dispatch",
      "sandbox-external-reads",
    ],
    reads: [
      "public repository source and pinned dependency baseline",
      "private repair checkpoint and check evidence",
      "GitHub issue/PR/check/protection evidence",
    ],
    result:
      "Versioned JSON; 0 healthy or verified merged/rolled out, 1 blocked/busy/unchanged unresolved, 2 invalid request. Evidence paths are private; model serving identity is unverified.",
    options: {
      "--check-only":
        "Run isolated sandboxed repository checks; zero model dispatch and GitHub mutations; retain private evidence.",
    },
  },
  {
    ...cli("routine repository-status", [], [], null, [
      "test/cli/routine-repository-status-cli.test.ts",
      "test/routine/repository-repair-state.test.ts",
    ]),
    reads: ["private repository repair checkpoint and verification receipts"],
    result:
      "Versioned JSON; 0 observed healthy or verified merge/rollout, 1 attention, 2 unobserved or invalid request. Read-only; no model, provider or GitHub calls.",
  },
  cli(
    "imports status",
    [],
    ["optional importer-owned receipt; absence is unavailable evidence"],
  ),
  {
    ...cli(
      "imports preflight",
      [],
      [
        "explicit NTULearn configuration and absolute checkout root",
        "existing safe private state root; no state is read or written",
      ],
    ),
    invocation:
      "node dist/src/cli.js imports preflight --config <private-config> --ntulearn-config <filename> --ntulearn-root <absolute-checkout> --json",
    reads: [
      "active cohort Module Definitions and mounted path metadata",
      "NTULearn courses JSON and destination path metadata",
    ],
    result:
      "Versioned JSON; 0 ready, 1 known route findings with complete evidence, 2 unobserved or invalid request. No credentials, provider calls or writes. Site-to-Module identity, live provider visibility and later sync safety remain unverified.",
    options: {
      "--ntulearn-config":
        "Required JSON filename; relative filenames resolve against --ntulearn-root.",
      "--ntulearn-root":
        "Required absolute checkout root; relative destinations resolve here. Checkout code is never executed.",
    },
  },
  cli("learning materials", []),
  {
    ...cli("offering readiness", []),
    reads: ["active Module controls, mounted inventory and importer receipts"],
    result:
      "Local-only readiness; 0 ready, 1 attention, 2 unobserved or invalid request. Live Google access, task freshness, destination preflight and learning mastery remain unverified. No filesystem or provider writes.",
    options: {
      "--max-age-hours":
        "Positive receipt freshness window in hours; defaults to 36. Applies only to import receipts.",
    },
  },
];

export function capabilityIndex(): object {
  const actions = [...cliCapabilities];
  for (const operation of [
    "schema",
    "prepare",
    "audit",
    "fit",
    "verify",
    "package-review",
  ]) {
    actions.push({
      id: `cheatsheet ${operation}`,
      surface: "cheatsheet",
      invocation: `node dist/src/cheatsheet/cli.js ${operation} (see schema for arguments)`,
      prerequisites: [
        "npm ci && npm run build",
        "synthetic fixture or explicitly authorized Module",
        ...(["verify", "package-review"].includes(operation)
          ? ["latexmk and Poppler executables"]
          : []),
      ],
      reads:
        operation === "schema"
          ? []
          : ["Module context, sources, manifest and release evidence"],
      writes: ["package-review"].includes(operation)
        ? [
            "explicit local destination; retained claim/partial evidence after interrupted publication",
            "isolated temporary compilation/rendering",
          ]
        : operation === "verify"
          ? ["isolated temporary compilation/rendering"]
          : [],
      riskFlags:
        operation === "schema"
          ? []
          : operation === "package-review"
            ? ["academic-content", "requires-destination-authorization"]
            : ["academic-content"],
      preview: null,
      implementation: "src/cheatsheet/cli.ts",
      tests: [
        "test/cheatsheet/authoring-package.test.ts",
        "test/cheatsheet/portable-release.test.ts",
        "test/cheatsheet/package-publication.test.ts",
        "test/cheatsheet/prepare.test.ts",
      ],
      status: "supported",
      health: "not-observed",
      result:
        "JSON; schema exposes inputs; semantic/mathematical review remains separate evidence.",
    });
  }
  for (const prefix of ["tasks", "research_tasks"])
    for (const operation of ["create", "change", "complete", "read_register"]) {
      actions.push({
        id: `${prefix}_${operation}`,
        surface: "mcp",
        invocation: `MCP tools/call ${prefix}_${operation}`,
        prerequisites: [
          "configured Operations server; Tailnet reachability; exact target",
        ],
        reads: ["configured target/task state", "Google Tasks provider"],
        writes:
          operation === "read_register"
            ? ["mounted task register and private freshness evidence"]
            : ["Google Tasks", "mounted task register"],
        riskFlags:
          operation === "read_register"
            ? ["writes-state", "mounted-write"]
            : [
                "writes-state",
                "external-write",
                "requires-target-authorization",
              ],
        preview: null,
        implementation: "src/operations/task-tools.ts",
        tests: [
          "test/operations/task-tools.test.ts",
          "test/operations/research-task-tools.test.ts",
        ],
        status: "supported",
        health: "not-observed",
        result:
          "MCP content containing JSON text and isError; transport errors remain distinct.",
      });
    }
  for (const name of [
    "calendar-refresh",
    "state-refresh",
    "morning-routine",
    "operations-server",
  ]) {
    actions.push({
      id: `schedule ${name}`,
      surface: "script",
      invocation: `node scripts/install-${name}-launchd.mjs --config <private-config> [--dry-run] | --remove`,
      prerequisites: [
        "macOS user session; built runtime; valid private configuration",
      ],
      reads: ["private configuration"],
      writes: ["user LaunchAgent; scheduled or resident process"],
      riskFlags: [
        "host-configuration",
        "schedules-future-writes",
        "requires-target-authorization",
      ],
      preview: "--dry-run",
      implementation: `scripts/install-${name}-launchd.mjs`,
      tests: [
        "test/launchd/install-launchd-job.test.ts",
        "test/launchd/plan-launchd-job.test.ts",
      ],
      status: "supported",
      health: "not-observed",
      result:
        "JSON dry-run preview; installation reports action-specific text.",
    });
  }
  actions.push({
    id: "operations serve",
    surface: "script",
    invocation:
      "node dist/src/operations/run-operations-server.js <private-config>",
    prerequisites: ["Tailnet address; private Tasks credentials/configuration"],
    reads: ["configuration; credentials"],
    writes: ["Tailnet-only listening socket; serves authorized task writes"],
    riskFlags: [
      "network-server",
      "external-write",
      "requires-target-authorization",
    ],
    preview: null,
    implementation: "src/operations/run-operations-server.ts",
    tests: [
      "test/operations/serve-operations.test.ts",
      "test/operations/tailnet-address.test.ts",
    ],
    status: "supported",
    health: "not-observed",
    result:
      "startup text; exit 64 for missing configuration, 1 for startup failure",
  });
  for (const [id, file] of [
    ["credentials authorize", "authorize-google-credentials.mjs"],
    ["calendar local setup", "setup-calendar-local.sh"],
  ])
    actions.push({
      id: id ?? "",
      surface: "script",
      invocation: `${file?.endsWith(".sh") ? "bash" : "node"} scripts/${file} (see owned script usage)`,
      prerequisites: [
        "interactive Owner authorization; reviewed OAuth scope/client; explicit private credential destination",
      ],
      reads: ["OAuth client configuration; interactive consent"],
      writes: ["private credentials and possibly host calendar configuration"],
      riskFlags: [
        "credential-provisioning",
        "interactive-consent",
        "requires-separate-authorization",
        "not-run-by-capability-checks",
      ],
      preview: null,
      implementation: `scripts/${file}`,
      tests: [],
      status: "supported",
      health: "not-observed",
      result:
        "Legacy interactive script; no synthetic coverage currently mapped. Never invoked by capability verification.",
    });
  for (const operation of ["index", "health", "check", "verify"])
    actions.push({
      id: `capabilities ${operation}`,
      surface: "cli",
      invocation: `node dist/src/cli.js capabilities ${operation} --json`,
      prerequisites: ["npm ci && npm run build"],
      reads: ["owned command metadata", "local tool or test evidence"],
      writes: ["check", "verify"].includes(operation)
        ? [
            "compiled repository artifacts; synthetic temporary fixtures; optional explicit private log",
          ]
        : ["optional explicit private log"],
      riskFlags: ["synthetic-only"],
      preview: null,
      implementation: "src/capabilities/command.ts",
      tests: [
        "test/capabilities/capabilities.test.ts",
        "test/capabilities/workflow-checks.test.ts",
        "test/cli/argument-safety.test.ts",
      ],
      status: "supported",
      health: "not-observed",
      result:
        "Versioned JSON; exit 0 success, 1 failed verification, 2 unavailable or invalid request. Child output is bounded hash/count evidence, never raw logs.",
    });
  for (const profile of Object.keys(checkProfiles))
    actions.push({
      id: `quality ${profile}`,
      surface: "quality",
      invocation: `node dist/src/cli.js capabilities check --profile ${profile} --json`,
      prerequisites: [
        "npm ci && npm run build",
        ...(profile === "full" ||
        profile === "templates" ||
        profile === "coverage"
          ? ["TeX Live and Poppler for rendered artifact checks"]
          : []),
        ...(["formal", "full"].includes(profile)
          ? [
              "Java 21 via JAVA or PATH; pinned TLC download or TLA2TOOLS_JAR",
              "clean committed checkout; Git history containing the seed ownership sync revision",
            ]
          : []),
      ],
      reads: ["repository source/tests/templates"],
      writes: [
        "dist; synthetic temporary fixtures and private verification evidence",
      ],
      riskFlags: ["synthetic-only"],
      preview: null,
      implementation: "src/capabilities/checks.ts",
      tests: [
        "test/capabilities/capabilities.test.ts",
        "test/capabilities/build-provenance.test.ts",
      ],
      status: "supported",
      health: "not-observed",
      result:
        profile === "formal"
          ? "Bounded seed ownership models, compiled schedules and real cleanup mutation controls; expected counterexamples are required. No syscall atomicity or concurrent-writer guarantee."
          : "Per-check exit, duration, bounded output count/hash; full includes all compiled tests, privacy checks and seed ownership verification.",
    });
  return {
    schemaVersion: 1,
    outcome: "indexed",
    discovery: "node dist/src/cli.js capabilities index --json",
    health: "node dist/src/cli.js capabilities health --json",
    verification:
      "node dist/src/cli.js capabilities check --profile <profile> --json",
    actions,
    invariants: [
      "catalogued availability is not live health",
      "local tool presence does not prove scheduled maintenance recovery",
      "live writes require exact target authorization",
      "synthetic verification does not establish mathematical or semantic correctness",
    ],
  };
}
