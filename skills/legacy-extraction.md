# legacy-extraction (MIGRATION-SURVEYOR core skill)

Reads legacy system state and extracts structured snapshots; read-only, never mutates source
systems.

How this org actually runs it:
- Legacy references in this workspace are READ-ONLY: D:\AI\Agentic (machine/runtime inventory)
  and D:\FounderOS-Aidit De Maestros (legacy app code, e.g. app/lib/dispatch/*). Never write
  there; extraction is for migration surveying only.
- Produce structured snapshots (JSON where possible) of the legacy state: role definitions,
  dispatch workers, config shapes. Label each field's source path so the snapshot is traceable.
- A "stale_config_hazard" finding (e.g. legacy hermes_generic adapterType) is exactly the kind
  of thing this skill surfaces: read the legacy, compare to current, report the gap, do not fix.
- Read-only means the source system is never mutated, even to "clean up" obviously-stale records.