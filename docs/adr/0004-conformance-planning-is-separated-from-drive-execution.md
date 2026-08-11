# Conformance planning is separated from Drive execution

The Markdown contract remains normative and gives every auditable clause a stable rule ID. A pure
conformance module consumes the contract, module definition, inventory and prior observation, then
returns findings, proposed operations and a new observation without writing anything. Inventory
adapters sit before that seam; only a separately invoked, plan-bound executor may apply approved
operations. This keeps filesystem and Drive authority out of deterministic checks, makes synthetic
tests representative, and prevents future LLM orchestration from choosing raw mutation targets.
Keeping planning and execution together was rejected because a classifier would then hold more
authority than it needs and its tests could reach the production Drive surface.

## Consequences

The inventory and executor need explicit interfaces and a plan format, so the first implementation
has more structure than a direct filesystem script. In return, conformance tests use synthetic
inventories, audits cannot mutate, and future executors can reject stale or unapproved plans.

## Revisit when

The system no longer touches external academic contents, or the storage provider offers a genuine
transaction that can bind observation, planning, approval and execution atomically.
