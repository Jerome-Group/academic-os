export const commands = [
  { name: 'help', description: 'List commands and JSON contracts.', options: [], feature: 'orientation' },
  { name: 'doctor', description: 'Check runtime, public references, bindings, private integrity, and restored suspension.', options: [], feature: 'orientation' },
  { name: 'catalog', description: 'Read public projects, source claims, capabilities, tools, and probes.', options: [], feature: 'orientation' },
  { name: 'responsibility', description: 'Retain an immutable goal, context, exact target, criteria, authority, feature, and lifecycle definition.', options: [{ name: 'file', required: true }], feature: 'routing' },
  { name: 'reconcile', description: 'Import evidence, inspect current local state, retain findings/repairs, and propose bounded next work.', options: [{ name: 'id' }, { name: 'import' }, { name: 'as-of', required: true }], feature: 'evidence' },
  { name: 'dispatch', description: 'Resolve an explicit saved destination from fresh discovery, recover private bindings, and return read-only native dispatch advice.', options: [{ name: 'id' }, { name: 'project' }, { name: 'resolve' }, { name: 'discovery' }, { name: 'as-of', required: true }, { name: 'context-needed', flag: true }], feature: 'routing' },
  { name: 'cloud', description: 'Run bounded cooperative cloud jobs with durable checkpoints, priority admission and pending health escalation.', options: [{ name: 'file', required: true }], feature: 'cloud' },
  { name: 'fleet', description: 'Retain scoped fleet health, parent read admission, alert delivery and explicit bounded history archival in the responsibility journal.', options: [{ name: 'file', required: true }], feature: 'fleet' },
  { name: 'signin', description: 'Choose a scoped sign-in recovery handoff without accepting or retaining secrets.', options: [{ name: 'file', required: true }], feature: 'fleet' },
  { name: 'token-review', description: 'Assess bounded supplied usage captures and complete cost per verified success without telemetry or execution.', options: [{ name: 'file', required: true }], feature: 'evidence' },
  { name: 'calendar', description: 'Assess declared current calendar intent, exact saved fields, inventory, allocations and retained attempts without execution.', options: [{ name: 'file', required: true }], feature: 'evidence' },
  { name: 'calendar-register', description: 'Collect read-only Calendar/Tasks snapshots, assess exact-ID proposals, validate handoffs, or export scoped cloud planning catalogs, acquire Academic OS API plans and inspect reports without applying them.', options: [{ name: 'file', required: true }], feature: 'evidence' },
  { name: 'briefing', description: 'Load an explicitly pinned local release or canonical public guidance, check a declared draft, and retain exact advisory Markdown.', options: [{ name: 'file' }], feature: 'evidence' },
  { name: 'guidance-pin', description: 'Activate, inspect or deactivate an exact approved installed local guidance release without changing canonical caches.', options: [{ name: 'file', required: true }], feature: 'evidence' },
  { name: 'probe', description: 'Publish a proposed Dot onboarding packet with eight probes.', options: [{ name: 'id' }, { name: 'nonce', required: true }], feature: 'routing' },
  { name: 'maintain', description: 'Compare or regenerate public references without changing review records.', options: [{ name: 'check', flag: true }, { name: 'write', flag: true }], feature: 'upkeep' },
  { name: 'backup', description: 'Verify and atomically archive a pinned private record/evidence manifest and bindings.', options: [{ name: 'to', required: true }], feature: 'upkeep' },
  { name: 'restore', description: 'Verify an archive and restore into a new suspended private home.', options: [{ name: 'from', required: true }, { name: 'into', required: true }], feature: 'upkeep' }
];

export const briefingGuidance = {
  schemaVersion: 1,
  checkerVersion: 1,
  path: 'docs/briefing-guidance.json',
  paths: ['docs/operating-brief.md', 'docs/briefing.md', '.agents/skills/sign-in/SKILL.md']
};

export const verification = {
  features: [
    { id: 'fleet', title: 'Fleet health and sign-in recovery', commands: ['fleet', 'signin'], scenarios: ['fleet-health', 'signin-recovery', 'morning-run'], properties: ['fleet-contract', 'morning-contract'] },
    { id: 'cloud', title: 'Cooperative cloud admission', commands: ['cloud'], scenarios: ['cloud-admission'], properties: ['cloud-admission', 'process-incarnation', 'legacy-baseline'] },
    { id: 'orientation', title: 'Orientation and private integrity', commands: ['help', 'doctor', 'catalog'], scenarios: ['orientation'], properties: [] },
    { id: 'routing', title: 'Responsibilities and proposals', commands: ['responsibility', 'dispatch', 'probe'], scenarios: ['persistent-context', 'binding-boundaries', 'native-effect-correlation', 'native-dispatch', 'probe-packet', 'definition-concurrency'], properties: ['exact-binding', 'branch-blocking', 'effect-stability', 'authority-scope', 'native-uncertainty', 'dispatch-recovery'] },
    { id: 'evidence', title: 'Reconciliation and correction', commands: ['reconcile', 'briefing', 'guidance-pin', 'calendar', 'calendar-register', 'token-review'], scenarios: ['self-check-repair', 'evidence-boundaries', 'live-cutoff', 'local-check', 'local-check-cleanup', 'trigger-evolution', 'briefing-guidance', 'briefing-draft', 'briefing-boundaries', 'calendar-acceptance', 'calendar-register', 'token-review'], properties: ['observation-gates', 'reported-assurance', 'failure-preservation', 'repair-closure', 'deterministic-replay', 'current-evidence', 'live-cutoff', 'process-group-cleanup', 'trigger-coverage', 'retirement-closure', 'calendar-acceptance', 'calendar-register'] },
    { id: 'upkeep', title: 'Upkeep and recovery', commands: ['maintain', 'backup', 'restore'], scenarios: ['archive-recovery', 'cloud-recovery', 'restored-current-context', 'publication-interruption', 'derived-boundaries', 'improvement-report'], properties: ['restore-suspension', 'import-prefix'] }
  ],
  properties: [
    { id: 'morning-contract', source: 'src/morning.mjs', functions: ['classifyMail', 'morningTransition', 'renderMorning', 'morningView', 'deliveryReadback'], statement: 'Versioned conservative mail judgments, fleet-backed fresh Singapore-day source acquisitions, complete reviewed-ID accounting, exact delivered-body gates, unread-preserved reversible outcomes and same-message edits retain scoped provenance without claiming native truth.' },
    { id: 'fleet-contract', source: 'src/fleet-state.mjs', functions: ['captureCondition', 'fleetHistory', 'fleetTransition', 'fleetState', 'fleetView'], statement: 'Current scheduled health requires exact occurrence provenance; structured actions coalesce paraphrases, fresh source acquisitions close pending recovery, and explicit upgrades preserve historical states and review views. Parent read, uncertainty, archive ancestry and delivery guards remain bounded.' },
    { id: 'process-incarnation', source: 'src/process-incarnation.mjs', functions: ['parseProcStat', 'parseProcStatus', 'parseProcMount', 'validIncarnation', 'compareIncarnations', 'ownerDecision'], statement: 'Validated kernel witnesses distinguish process incarnations while missing, incomparable or unrooted namespace evidence leaves owner absence unknown.' },
    { id: 'legacy-baseline', source: 'src/cloud-migration.mjs', functions: ['assessLegacyAttestation'], statement: 'Exact legacy checkpoint/report bindings, distinct attributable calls and declared review establish reported historical evidence only; fresh observed baseline and later restart remain separate live gates.' },
    { id: 'cloud-admission', source: 'src/cloud.mjs', functions: ['cloudTransition', 'capacityDecision', 'cloudState'], statement: 'Bounded cooperative transitions reserve priority capacity, coalesce stable identities, retain checkpoints, bound retries, defer unavailable capacity and deduplicate pending health escalation.' },
    { id: 'exact-binding', source: 'src/work.mjs', functions: ['routeTarget'], statement: 'Only own project/host bindings with exact target identity establish a local route.' },
    { id: 'branch-blocking', source: 'src/responsibilities.mjs', functions: ['reconcileState'], statement: 'Concurrent definition heads survive and block action proposals.' },
    { id: 'effect-stability', source: 'src/work.mjs', functions: ['effectKey'], statement: 'Same responsibility, target, effect and occurrence retain the same effect key across review time and definition edits.' },
    { id: 'authority-scope', source: 'src/work.mjs', functions: ['authorityStatus'], statement: 'Absent, wrong-scope or expired authority cannot authorize work proposals.' },
    { id: 'observation-gates', source: 'src/work.mjs', functions: ['observationStatus'], statement: 'Foreign, future, stale, partial or unavailable observations remain ineligible.' },
    { id: 'live-cutoff', source: 'src/work.mjs', functions: ['reviewAsOf'], statement: 'Live review cutoffs include requested time and actual completion while fixed historical replay keeps its supplied time.' },
    { id: 'process-group-cleanup', source: 'src/responsibilities.mjs', functions: ['terminateOwnedProcessGroup'], statement: 'Owned-group signalling distinguishes absent groups, denied cleanup and unexpected errors without claiming unknown cleanup succeeded.' },
    { id: 'reported-assurance', source: 'src/responsibilities.mjs', functions: ['reconcileState'], statement: 'Imported reports cannot satisfy observed-local criteria or authenticate independent review.' },
    { id: 'failure-preservation', source: 'src/responsibilities.mjs', functions: ['reconcileState'], statement: 'A later pass, weaker definition or earlier native completion cannot erase a retained failure or silence required attention.' },
    { id: 'repair-closure', source: 'src/work.mjs', functions: ['repairStatus'], statement: 'Closure requires the exact finding/failure, current expected subject and every original criterion recheck.' },
    { id: 'deterministic-replay', source: 'src/responsibilities.mjs', functions: ['reconcileState', 'replayReview'], statement: 'Identical sorted evidence manifests/time/rules produce identical reconciliation results under permutation.' },
    { id: 'current-evidence', source: 'src/responsibilities.mjs', functions: ['reconcileState'], statement: 'Newest actual local identity/bytes cannot borrow an older green result.' },
    { id: 'native-uncertainty', source: 'src/responsibilities.mjs', functions: ['reconcileState'], statement: 'Known pending, uncertain or uncorrelated native tasks require rediscovery; partial inventories cannot prove absence and unkeyed completion cannot prove an intended effect.' },
    { id: 'dispatch-recovery', source: 'src/dispatch.mjs', functions: ['dispatchDecision'], statement: 'Independent coordinator and destination identities, fresh project/source evidence, exact destination/remote-host scope, recorded settings and creator lineage gate bounded dispatch advice without erasing launch uncertainty or reused child bindings.' },
    { id: 'calendar-register', source: 'src/calendar-register.mjs', functions: ['assessCalendarRegister'], statement: 'Fresh exhaustive query coverage and exact native Task timing gate free intervals; snapshot-bound assignment and occurrence identity, ordered questions, scoped owner supersession, protected meals, capabilities, done evidence and uncertain effects gate current proposals without execution.' },
    { id: 'calendar-acceptance', source: 'src/calendar.mjs', functions: ['assessCalendar'], statement: 'Validated declared calendar envelopes require exact saved fields, current content bindings, complete inventory, readable Busy or mandatory Event timing, exact whole-source labels, compatible allocations and scoped retained history; unresolved clocks and effects cannot establish acceptance.' },
    { id: 'trigger-coverage', source: 'src/work.mjs', functions: ['triggerStatus'], statement: 'Missed runs require fresh complete post-window coverage; no-op and delivery gaps remain distinct.' },
    { id: 'retirement-closure', source: 'src/work.mjs', functions: ['retirementStatus'], statement: 'Unsuperseded enabled readbacks keep native disablement pending and retirement stops proposals.' },
    { id: 'import-prefix', source: 'src/records.mjs', functions: ['importOrder', 'validateReferences'], statement: 'Every imported publication prefix is dependency-complete and supersession stays within scope.' },
    { id: 'restore-suspension', source: 'src/work.mjs', functions: ['restoredState', 'currentObservations'], statement: 'Restored homes require current fresh exact target, authority, task and schedule observations in their new epoch; cloud targets remain reported and local targets require inspection.' }
  ]
};
