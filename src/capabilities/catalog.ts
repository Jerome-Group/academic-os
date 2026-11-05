import { createPublicationTools } from "../controls-publication/tools.js";
import {
  createModuleActivityTools,
  moduleActivityActions,
} from "../module-activity/actions.js";
import { checkProfiles } from "./checks.js";

const buildPrerequisite =
  "built runtime from npm ci && npm run build; macOS compilation requires Xcode Command Line Tools (/usr/bin/xcrun clang)";

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
      buildPrerequisite,
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
  ...moduleActivityActions.map(
    (action): Capability => ({
      id: action.cli.join(" "),
      surface: "cli",
      invocation: `node dist/src/cli.js ${action.cli.join(" ")} --input <packet.json> --json`,
      prerequisites: [...action.prerequisites],
      reads: ["selected and portable exact Module control closure"],
      writes: [...action.effects],
      riskFlags: action.id.endsWith("close")
        ? ["writes-state", "generated-candidate-only"]
        : [],
      preview: null,
      implementation: "src/module-activity/actions.ts",
      tests: [
        "test/module-activity/module-activity.test.ts",
        "test/module-activity/journey.test.ts",
      ],
      status: "supported",
      health: "not-observed",
      result: `Strict ${action.input} to ${action.output}; actual CLI/MCP schema validated output; generated control evidence only.`,
    }),
  ),
  ...[
    "create-generated-candidate",
    "publish-generation",
    "inspect-candidate",
  ].map(
    (operation): Capability => ({
      id: `controls ${operation}`,
      surface: "cli",
      invocation: `node dist/src/cli.js controls ${operation} --json`,
      prerequisites: [
        "Node >=24",
        "npm ci && npm run build",
        "supported Darwin account, private local Application Support anchor and native addon",
        "generated candidate admission for publish and inspect",
      ],
      reads: [
        "exact supplied identity or complete publication bundle",
        "host-owned publication catalog and physical claims",
      ],
      writes:
        operation === "inspect-candidate"
          ? ["existing SQLite lock-coordination metadata only"]
          : [
              "private generated candidates, immutable generations, retained bytes, publication ledger and receipts",
            ],
      riskFlags: [
        operation === "inspect-candidate"
          ? "read-owned-generated-controls"
          : "writes-private-generated-controls",
      ],
      preview: null,
      implementation: "src/controls-publication/command.ts",
      tests: [
        "test/controls-publication/publication.test.ts",
        "test/controls-publication/capacity.test.ts",
        "test/controls-publication/native.test.ts",
        "test/controls-publication/durability.test.ts",
        "test/controls-publication/import-boundary.test.ts",
        "test/controls-publication/publication-journey.test.ts",
      ],
      status: "supported",
      health: "not-observed",
      result:
        "Generated candidates only. Complete module-data graph or explicit refusal/recovery. Other workflows, migration and conformance remain not-implemented. No arbitrary target admission.",
    }),
  ),
  {
    ...cli("module validate", [], [], null, [
      "test/controls/module-data.test.ts",
      "test/controls/native-data-validation.test.ts",
      "test/controls/module-inspect-cli.test.ts",
    ]),
    invocation:
      "node dist/src/cli.js module validate --root <candidate-module-root> --json",
    implementation: "src/commands/module-inspect-command.ts",
    prerequisites: [
      "Node >=24",
      "npm ci && npm run build",
      "complete isolated candidate module-data generation2",
    ],
    reads: [
      "safe candidate control bytes; selected byte hashes; closed module graph",
    ],
    result:
      "Validated module data or structured refusal. Publication, workflows, module conformance and migration readiness remain unimplemented; no writes.",
  },
  {
    id: "migration inventory",
    surface: "cli",
    invocation:
      "node dist/src/cli.js migration inventory --root <physical-root> --json [--log <private-new-file>]",
    prerequisites: [
      "Node >=24",
      buildPrerequisite,
      "macOS native adapter built with Xcode Command Line Tools",
      "physical quiescent readable root; no dataless entries or external hardlink aliases",
    ],
    reads: [
      "complete raw native membership; regular-file bytes; raw symlink targets; native ACL/xattr payloads and stat metadata",
    ],
    writes: [
      "optional explicit new private log outside source and repository; filesystem access times may advance",
    ],
    riskFlags: ["native-content-read"],
    preview: null,
    implementation: "src/commands/migration-inventory-command.ts",
    tests: [
      "test/migration/native-inventory.test.ts",
      "test/migration/native-inventory-cli.test.ts",
    ],
    status: "supported",
    health: "not-observed",
    result:
      "Versioned two-pass non-atomic observation; observed exits 0, incomplete/refused exits 2. No migration, admission or preservation equality claim. Other platforms explicitly unsupported.",
    options: {
      "--root":
        "Physical root; ancestor symlinks and cross-device entries refuse",
      "--log":
        "New absolute file in an existing private owner directory outside source/repository",
    },
  },
  {
    ...cli("config validate", [], [], null, [
      "test/config/configuration-boundary.test.ts",
      "test/config/configuration-cli.test.ts",
    ]),
    prerequisites: [
      "Node >=24",
      buildPrerequisite,
      "readable configuration file",
    ],
    reads: ["configuration bytes"],
    result:
      "Validated local, cohort or service shape and format version only; no path, credential or provider payload; validation failure exits 2.",
  },
  {
    id: "naming plan",
    surface: "cli",
    invocation:
      "node dist/src/cli.js naming plan --input <private-json> --json",
    prerequisites: [
      "Node >=24 with Unicode >=16 normalization",
      buildPrerequisite,
      "schema-valid accepted metadata and complete occupied set",
    ],
    reads: ["private naming request JSON"],
    writes: [],
    riskFlags: [],
    preview: null,
    implementation: "src/commands/naming-plan-command.ts",
    tests: [
      "test/naming/resolve-artifact-names.test.ts",
      "test/naming/naming-plan-cli.test.ts",
      "test/naming/unicode-data.test.ts",
    ],
    status: "supported",
    health: "not-observed",
    result:
      "Resolved, unresolved or refused proposal; unresolved/refused exit 2. Admission stays unavailable pending contract 8 activation; no writes.",
  },
  {
    ...cli("module inspect", [], [], null, [
      "test/controls/read-controls.test.ts",
      "test/controls/native-data-validation.test.ts",
      "test/controls/module-inspect-cli.test.ts",
      "test/config/configuration-boundary.test.ts",
      "test/config/configuration-cli.test.ts",
    ]),
    invocation:
      "node dist/src/cli.js module inspect --root <module-root> --json",
    prerequisites: [
      "Node >=24",
      buildPrerequisite,
      "physical module root or explicit configured target",
    ],
    reads: ["safe mounted control bytes; immutable canonical references"],
    result:
      "Detected legacy or canonical shape, exact selected byte hashes, typed data and explicit unsupported capabilities; identity-only reads remain partial; refusal exits 2; no writes.",
    options: {
      "--root": "Portable physical module root; exclusive with --config",
      "--config":
        "Private config; academic config also requires --semester and --module",
    },
  },
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
    [
      "private seed journal/staging",
      "private journal ownership storage with --apply",
      "mounted content with --apply",
    ],
    [
      "profile and definition; containment and exclusive publication",
      "local same-host private state with reliable SQLite filesystem locking",
    ],
    "omit --apply",
    [
      "test/cli/seed-cli.test.ts",
      "test/cli/research-project-cli.test.ts",
      "test/cli/journal-ownership-cli.test.ts",
      "test/mounted/journal-mutation-owner.test.ts",
    ],
  ),
  cli(
    "repair",
    [
      "private recovery journal",
      "private journal ownership storage with --apply",
      "Google Drive and mounted content with --apply",
    ],
    [
      "approved ID-bound plan; complete inventory; independent byte and Drive recoveries",
      "local same-host private state with reliable SQLite filesystem locking",
    ],
    "omit --apply",
    [
      "test/cli/repair-cli.test.ts",
      "test/repair/resume-repair.test.ts",
      "test/repair/repair-journal-ownership.test.ts",
    ],
  ),
  cli(
    "pinned refresh",
    ["private backups/journal", "mounted pinned content with --apply"],
    [
      "complete cohort coverage before Module apply",
      "active Research project before Research shared-control apply",
    ],
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
    [
      "test/cli/curation-migrate-cli.test.ts",
      "test/cli/curation-completion-cli.test.ts",
      "test/cli/curation-register-ownership-cli.test.ts",
    ],
  ),
  cli(
    "curation rederive",
    [
      "private curation journal with --apply",
      "mounted register content with --apply",
    ],
    [],
    "omit --apply",
    [
      "test/curation/plan-curation-rederivation.test.ts",
      "test/cli/curation-completion-cli.test.ts",
      "test/cli/curation-register-ownership-cli.test.ts",
    ],
  ),
  cli(
    "calendar setup",
    ["private calendar state", "Google Calendar with --apply"],
    ["Google Calendar write credentials"],
    "omit --apply",
  ),
  cli(
    "calendar refresh",
    ["private calendar mirror and retained recovery snapshots"],
    ["Google Calendar read credentials"],
    null,
    [
      "test/cli/calendar-refresh-cli.test.ts",
      "test/cli/calendar-refresh-binding-cli.test.ts",
    ],
  ),
  cli(
    "calendar propose",
    ["private proposal state"],
    [
      "proposal input; current calendar evidence; Google Calendar read credentials",
    ],
    null,
    [
      "test/cli/calendar-propose-cli.test.ts",
      "test/cli/calendar-occupancy-cli.test.ts",
      "test/cli/calendar-refresh-binding-cli.test.ts",
    ],
  ),
  cli(
    "calendar promote",
    [
      "Google Calendar events",
      "private proposal state/mirror and journal ownership storage",
    ],
    [
      "proposal ID; fresh conflict checks; Google Calendar read and write credentials",
      "local same-host private state with reliable SQLite filesystem locking for receipt append",
    ],
    null,
    [
      "test/cli/calendar-promote-cli.test.ts",
      "test/cli/calendar-occupancy-cli.test.ts",
      "test/calendar/promotion-journal-ownership.test.ts",
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
    [
      "mounted task register content",
      "private per-target refresh receipts",
      "private versioned Task recovery history",
    ],
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
      [],
      [
        "retired direct-write alias; use tasks apply-plan and a fresh tasks refresh token",
      ],
      null,
      [
        "test/cli/tasks-operate-cli.test.ts",
        "test/cli/research-tasks-cli.test.ts",
      ],
    ),
  ),
  {
    ...cli(
      "tasks apply-plan",
      [
        "Google Tasks",
        "mounted task register content",
        "private operation/lifecycle journals, recovery history and refresh receipts",
      ],
      [
        "immutable TaskExecutionPlan v1; fresh snapshot; canonical private state; Google Tasks read/write credentials",
      ],
      null,
      [
        "test/cli/tasks-apply-plan-cli.test.ts",
        "test/cli/tasks-recovery-cli.test.ts",
        "test/cli/research-tasks-cli.test.ts",
      ],
    ),
    invocation:
      "node dist/src/cli.js tasks apply-plan --config <private-config> --plan <private-plan.json> --json",
  },
  cli(
    "tasks publish-completion-catalog",
    ["private completion catalog and original source acquisition evidence"],
    [
      "configured private source file; pinned producer; exact environment/account/source identity; no provider calls",
    ],
    null,
    ["test/operations/configured-module-completion.test.ts"],
  ),
  cli(
    "tasks record-lifecycle",
    ["private owner lifecycle evidence"],
    ["exact terminal owner decision JSON; no provider mutation"],
    null,
    ["test/cli/tasks-apply-plan-cli.test.ts"],
  ),
  cli(
    "tasks recovery",
    [],
    ["configured private recovery history; no provider calls"],
    null,
    ["test/cli/tasks-recovery-cli.test.ts"],
  ),
  cli(
    "tasks restore",
    [
      "Google Tasks with --apply",
      "task register",
      "private recovery and lifecycle receipts",
    ],
    [
      "exact task-restore/1 plan; owner approval reference; fresh snapshot; native timing limitation acknowledged",
    ],
    "omit --apply",
    ["test/cli/tasks-recovery-cli.test.ts"],
  ),
  cli(
    "tasks status",
    [],
    ["private refresh receipts; no provider access"],
    null,
    ["test/cli/tasks-apply-plan-cli.test.ts"],
  ),
  cli(
    "textbooks catch-up",
    [
      "mounted shelf index content, permanent captured originals and exact owned probe metadata with --apply",
      "private canonical per-Shelf journal and same-host mutation ownership",
    ],
    [
      "configured canonical private state root outside Drive; reliable local SQLite locking",
      "actual append requires cc and native exclusive rename, exchange and directory sync on Darwin/Linux; preview and no-op need no compiler",
      "same-host coordination requires the same canonical state root; no distributed or cross-state-root locking",
    ],
    "omit --apply",
    [
      "test/cli/textbooks-catch-up-cli.test.ts",
      "test/cli/textbooks-preservation-cli.test.ts",
      "test/textbooks/open-file-shelf.test.ts",
      "test/textbooks/shelf-preservation-process.test.ts",
    ],
  ),
  cli("textbooks sweep", ["private shelf review sheet"], [], null, [
    "test/textbooks/plan-shelf-sweep.test.ts",
    "test/cli/textbooks-migrate-cli.test.ts",
  ]),
  cli(
    "textbooks migrate",
    [
      "mounted independent book renames, index proposals and permanent captured originals with --apply",
      "private canonical per-Shelf intent/outcome journal and mutation ownership",
    ],
    [
      "reviewed migration sheet",
      "configured canonical private state root outside Drive; reliable local SQLite locking",
      "actual append requires cc and native exclusive rename, exchange and directory sync on Darwin/Linux",
      "no atomic checksum-conditional movement or protection against arbitrary source/capture/root substitution; partial runs remain fenced",
    ],
    "omit --apply",
    [
      "test/textbooks/open-file-shelf.test.ts",
      "test/textbooks/shelf-preservation-process.test.ts",
      "test/cli/textbooks-preservation-cli.test.ts",
      "test/cli/textbooks-migrate-cli.test.ts",
    ],
  ),
  {
    ...cli(
      "textbooks reconcile",
      [],
      [
        "exact --run ID in the canonical private Shelf journal",
        "observe-only exact-pair readback; no automatic rollback, exchange retry, late-edit merge or capture cleanup",
        "configured-mount, power-loss and Drive-sync recovery require separate evidence",
      ],
      null,
      [
        "test/textbooks/shelf-preservation-process.test.ts",
        "test/cli/textbooks-preservation-cli.test.ts",
        "test/cli/textbooks-migrate-cli.test.ts",
      ],
    ),
    invocation:
      "node dist/src/cli.js textbooks reconcile --config <private-config> --run <run-id> --json",
  },
  {
    ...cli(
      "routine morning",
      [
        "mounted maintenance content",
        "private logs/journals",
        "GitHub weekly anchors, immutable reviews, verified resolution, reopening and state-only retirement",
        "protected repository pull requests and clean primary checkout rollout",
        "ordinary expired artifacts removed unless --retain-artifacts",
      ],
      [
        "fully resolved configured cohort selection; empty active Module lists are supported",
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
        "test/routine/weekly-publication-subprocess.test.ts",
        "test/routine/weekly-publication-admission.test.ts",
        "test/routine/gh-morning-issue.test.ts",
        "test/routine/repository-repair.test.ts",
        "test/routine/file-weekly-evidence.test.ts",
        "test/routine/gh-weekly-repository-history.test.ts",
      ],
    ),
    options: {
      "--retain-artifacts":
        "Exclusive private run directory and report; skips ordinary retention purge.",
      "--modules-only":
        "Refresh active Module task mirrors only; skip shared shelf writes and repository repair; publish only this weekly coverage scope; preserve repository observations.",
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
  {
    ...cli(
      "imports status",
      [],
      ["optional importer-owned receipt; absence is unavailable evidence"],
      null,
      [
        "test/cli/imports-status-cli.test.ts",
        "test/imports/run-import-status.test.ts",
      ],
    ),
    result:
      "Versioned JSON; 0 current, 1 attention, 2 invalid or unreadable evidence, including an empty active Module cohort. No credentials, provider calls or writes.",
  },
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
  {
    ...cli("learning materials", [], [], null, [
      "test/cli/learning-materials-cli.test.ts",
      "test/learning-materials/run-learning-materials.test.ts",
    ]),
    result:
      "Versioned JSON; 0 available, 1 gaps, 2 invalid or incomplete evidence, including an empty active Module cohort. No filesystem or provider writes.",
  },
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
  actions.push({
    id: "controls publication standalone",
    surface: "script",
    invocation:
      "npm run controls-publication:standalone -- <absolute-output-directory>",
    prerequisites: [
      "npm ci && npm run build",
      "unchanged built source bindings",
      "production native addon on supported Darwin",
    ],
    reads: [
      "built release manifest",
      "shared source and production native artifact",
    ],
    writes: ["standalone package under the explicit output directory"],
    riskFlags: ["writes-release-artifact"],
    preview: null,
    implementation: "scripts/build-control-publication-standalone.mjs",
    tests: [
      "test/controls-publication/standalone-package.test.ts",
      "test/controls-publication/publication-journey.test.ts",
    ],
    status: "supported",
    health: "not-observed",
    result:
      "Standalone CLI with the host release identity and production addon. Package creation loads no publication authority or Module target.",
  });
  for (const tool of createPublicationTools())
    actions.push({
      id: tool.name,
      surface: "mcp",
      invocation: `tools/call ${tool.name}`,
      prerequisites: [
        "supported Darwin host and private local account anchor",
        "generated candidate admission for publication and inspection",
      ],
      reads: [
        "schema-validated exact publication bytes",
        "owned catalog and current physical identities",
      ],
      writes:
        tool.name === "controls_inspect_candidate"
          ? ["existing SQLite lock-coordination metadata only"]
          : ["private generated candidate publication data and ledger"],
      riskFlags: ["generated-candidates-only"],
      preview: null,
      implementation: "src/controls-publication/tools.ts",
      tests: [
        "test/controls-publication/publication-journey.test.ts",
        "test/controls-publication/publication-schema.test.ts",
        "test/controls-publication/capacity.test.ts",
        "test/controls-publication/native.test.ts",
      ],
      status: "supported",
      health: "not-observed",
      result:
        "MCP content text contains the strict generated result schema; isError marks refusal or recovery. Complete graph and immutable evidence or explicit refusal/recovery. No historical or live target admission.",
    });
  for (const action of moduleActivityActions) {
    const tool = createModuleActivityTools().find(
      (tool) => tool.name === action.mcp,
    );
    if (!tool) throw new Error("Missing Module activity action handler.");
    actions.push({
      id: action.mcp,
      surface: "mcp",
      invocation: `tools/call ${action.mcp}`,
      prerequisites: [...action.prerequisites],
      reads: ["exact selected or retained Module control bytes"],
      writes: [...action.effects],
      riskFlags: action.id.endsWith("close")
        ? ["generated-candidates-only", "writes-state"]
        : [],
      preview: null,
      implementation: "src/module-activity/actions.ts",
      tests: [
        "test/module-activity/module-activity.test.ts",
        "test/module-activity/journey.test.ts",
      ],
      status: "supported",
      health: "not-observed",
      result: `${action.output} with actual outputSchema, validated structuredContent and explicit refusal or recovery.`,
    });
  }
  for (const operation of [
    "schema",
    "doctor",
    "present-references",
    "preservation",
    "regeneration-check",
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
        buildPrerequisite,
        ...(["schema", "doctor"].includes(operation)
          ? []
          : ["synthetic fixture or explicitly authorized Module"]),
        ...(["verify", "package-review"].includes(operation)
          ? [
              "latexmk and Poppler executables",
              "kpsewhich distribution resource discovery",
            ]
          : []),
      ],
      reads: ["schema", "doctor"].includes(operation)
        ? []
        : ["Module context, sources, manifest and release evidence"],
      writes: ["package-review"].includes(operation)
        ? [
            "explicit local destination; retained claim/partial evidence after interrupted publication",
            "isolated temporary compilation/rendering",
          ]
        : operation === "verify"
          ? [
              "isolated temporary compilation/rendering; optional exclusive retained build-evidence directory",
            ]
          : [],
      riskFlags: ["schema", "doctor"].includes(operation)
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
        "test/cheatsheet/measurement-evidence.test.ts",
        "test/cheatsheet/layout-evidence.test.ts",
        "test/cheatsheet/authoring-evidence.test.ts",
        "test/cheatsheet/references-revision.test.ts",
      ],
      status: "supported",
      health: "not-observed",
      result:
        "JSON; schema exposes inputs; semantic/mathematical review remains separate evidence.",
    });
  }
  actions.push({
    id: "naming_plan",
    surface: "mcp",
    invocation: "MCP tools/call naming_plan",
    prerequisites: [
      "configured Operations server",
      "schema-valid accepted naming JSON and complete occupied set",
    ],
    reads: ["request JSON supplied by caller"],
    writes: [],
    riskFlags: [],
    preview: null,
    implementation: "src/operations/naming-tools.ts",
    tests: ["test/naming/naming-mcp.test.ts"],
    status: "supported",
    health: "not-observed",
    result:
      "Same complete-set proposal as naming plan; unresolved/refused are isError results. Admission stays unavailable pending contract 8 activation.",
  });
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
            ? [
                "mounted task register, private freshness evidence and recovery history",
              ]
            : [
                "Google Tasks",
                "mounted task register",
                "private operation/lifecycle journals, recovery history and refresh receipts",
              ],
        riskFlags:
          operation === "read_register"
            ? ["writes-state", "mounted-write"]
            : [
                "writes-state",
                "external-write",
                "requires-target-authorization",
              ],
        preview: null,
        implementation: "src/operations/task-plan-tools.ts",
        tests: [
          "test/operations/task-tools.test.ts",
          "test/operations/research-task-tools.test.ts",
          "test/operations/task-plan-tools.test.ts",
          "test/cli/tasks-apply-plan-cli.test.ts",
          "test/cli/tasks-recovery-cli.test.ts",
        ],
        status: "supported",
        health: "not-observed",
        result:
          "MCP content containing JSON text and isError; transport errors remain distinct.",
      });
    }
  for (const name of ["tasks_apply_plan", "tasks_sync_capabilities"])
    actions.push({
      id: name,
      surface: "mcp",
      invocation: `MCP tools/call ${name}`,
      prerequisites: [
        "Operations protocol task-plan/1; exact target; fresh snapshot for mutation",
      ],
      reads:
        name === "tasks_apply_plan"
          ? ["Google Tasks", "private lifecycle/journal"]
          : [],
      writes:
        name === "tasks_apply_plan"
          ? [
              "Google Tasks",
              "mounted register",
              "private operation/lifecycle journals, recovery history and refresh receipts",
            ]
          : [],
      riskFlags:
        name === "tasks_apply_plan"
          ? ["external-write", "writes-state", "requires-target-authorization"]
          : [],
      preview: null,
      implementation: "src/operations/task-plan-tools.ts",
      tests: [
        "test/operations/task-plan-tools.test.ts",
        "test/tasks/task-execution.test.ts",
      ],
      status: "supported",
      health: "not-observed",
      result:
        "MCP content containing JSON text and isError; versioned exact-plan result. Conflicts never silently replan. Native timing unavailable until verified adapter.",
    });
  for (const name of [
    "tasks_completion_capabilities",
    "tasks_discover_completion",
    "tasks_prepare_completion",
  ]) {
    const observes = name !== "tasks_completion_capabilities";
    actions.push({
      id: name,
      surface: "mcp",
      invocation: `MCP tools/call ${name}`,
      prerequisites: [
        "configured Operations server",
        ...(observes
          ? [
              "configured private catalog; pinned producer; exact module/list/task; original current authority",
            ]
          : []),
      ],
      reads: observes
        ? ["Google Tasks", "configured private source catalog"]
        : [],
      writes: observes
        ? [
            "mounted register, private recovery snapshots and refresh receipt",
            ...(name === "tasks_prepare_completion"
              ? ["private immutable prepared packet and acquisition evidence"]
              : []),
          ]
        : [],
      riskFlags: observes
        ? ["writes-state", "requires-target-authorization"]
        : [],
      preview: null,
      implementation: "src/operations/module-completion-tools.ts",
      tests: [
        "test/operations/module-completion-tools.test.ts",
        "test/operations/configured-module-completion.test.ts",
      ],
      status: "supported",
      health: "not-observed",
      result:
        "MCP content containing JSON text and isError; status, code or retained original producer call; optional source integration availability; no task mutation.",
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
      prerequisites: [buildPrerequisite],
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
        buildPrerequisite,
        ...(profile === "full" ||
        profile === "templates" ||
        profile === "coverage"
          ? ["TeX Live and Poppler for rendered artifact checks"]
          : []),
        ...(["formal", "publication-formal", "full"].includes(profile)
          ? [
              "Java 21 via JAVA or PATH; pinned TLC download or TLA2TOOLS_JAR",
              "clean committed checkout; covered-source hashes match the checked-in formal binding",
            ]
          : []),
        ...(profile === "publication-formal"
          ? [
              "Darwin; Apple clang and current Node N-API headers; private local fixture evidence parent",
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
        ...(profile === "publication-formal"
          ? [".agents/skills/control-publication/run.mjs"]
          : []),
      ],
      status: "supported",
      health: "not-observed",
      result:
        profile === "publication-formal"
          ? "Bounded source-bound generated control publisher model, compiled fault schedules, exact byte readbacks and eight behavioral mutants with restored controls. Native account/kernel/syscall behavior remains a runtime premise. Local only; no live admission or whole-system proof."
          : profile === "formal"
            ? "Bounded seed filesystem and cooperating journal-owner models, compiled schedules and mutation controls; expected counterexamples are required. Same-host canonical-state assumptions apply. No guarantee against syscall swaps, uncontrolled writers or distributed ownership."
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
