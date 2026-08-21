# Hermes control-layer lifecycle state machine

This document names the lifecycle states already implied by the Hermes control layer. It does not add fields or change either JSON schema. `.ai/control/state.json` is the orchestrator state record; `.ai/status.json` is the per-session protocol record written by Claude and consumed by Hermes.

## State representation

| Lifecycle state | Current representation |
|---|---|
| `IDLE` | Inferred by `/ros-status`: there is no live lock, no `.ai/control/pending-decision.json`, and no in-progress answer transaction (`answering.lock`). No distinct value is currently written. A stale `state.json` does not override these live conditions. |
| `RUNNING` | `.ai/control/state.json.status = "running"` and a lock whose PID and process start time identify a live orchestrator. |
| `SESSION_BOUNDARY` | Both `.ai/status.json.status` and then `.ai/control/state.json.status` are `"SESSION_BOUNDARY"`. |
| `USER_DECISION_REQUIRED` | Both status files use `"USER_DECISION_REQUIRED"`; `pending-decision.json` records the unanswered decision. |
| `BLOCKED` | Both status files use `"BLOCKED"`. |
| `ORPHANED_WORKER` | `.ai/control/state.json.status = "orphaned_worker"`. There is no corresponding session-protocol value. |
| `FAILED` | `.ai/control/state.json.status = "failed"`. There is no corresponding session-protocol value. |
| `STOPPED_BY_REQUEST` | `.ai/control/state.json.status = "stopped_by_request"`. There is no corresponding session-protocol value. |
| `DONE` | The documented terminal outcome once Hermes has no more work queued. It is not a distinct machine-written value today, so `/ros-status` can report it only from the absence of queued work plus terminal context; this is a naming/representation gap. It must not invent a new JSON value. |

`DONE` and `IDLE` therefore overlap in machine-observable conditions: both can have no live lock, pending decision, or answer transaction. `DONE` describes the outcome; `IDLE` describes current control activity.

## Transitions

Line references describe the current scripts at the time of this document.

| From | Event | To | Current enforcement |
|---|---|---|---|
| `IDLE` | start | `RUNNING` | `scripts/hermes-dev-control.ps1:93-102,157-158` launches and records the lock; `scripts/hermes-orchestrate.ps1:278` writes `running`. |
| `USER_DECISION_REQUIRED` | normal start bypass | rejected; remains `USER_DECISION_REQUIRED` | `scripts/hermes-dev-control.ps1:93-95` fails before launching when `pending-decision.json` exists. This required guard is already enforced. |
| `RUNNING` | session completes with `CONTINUE` | `RUNNING` | `scripts/hermes-orchestrate.ps1:390-400,479` validates, records, and starts the next session while under the cap. `CONTINUE` is a protocol event, not a named lifecycle state. |
| `RUNNING` | session completes with `SESSION_BOUNDARY` | `SESSION_BOUNDARY`, then `RUNNING` on restart | `scripts/hermes-orchestrate.ps1:390-400,476-479`; the boundary is recorded before automatic continuation. |
| `RUNNING` | session completes with `USER_DECISION_REQUIRED` | `USER_DECISION_REQUIRED` | `scripts/hermes-orchestrate.ps1:408-461,466-468` records/publishes the pending decision and stops. |
| `RUNNING` | session completes with `BLOCKED` | `BLOCKED` | `scripts/hermes-orchestrate.ps1:462-468` notifies and stops. |
| `RUNNING` | cooperative stop between sessions | `STOPPED_BY_REQUEST` | `scripts/hermes-orchestrate.ps1:282-288`; request creation is `scripts/hermes-dev-control.ps1:78-81`. |
| `RUNNING` | crash or exit with no status and no detected worker | `FAILED` | `scripts/hermes-orchestrate.ps1:354-381` fails closed. |
| `RUNNING` | orphan detected after exit with no status | `ORPHANED_WORKER` | `scripts/hermes-orchestrate.ps1:354-378` detects, waits without killing, records, and exits. |
| `RUNNING` | timeout or non-zero child exit | `FAILED` | `scripts/hermes-orchestrate.ps1:342-351` routes failure through `Stop-HermesWithError` (`17-24`). |
| `SESSION_BOUNDARY` | restart | `RUNNING` | Automatic restart: `scripts/hermes-orchestrate.ps1:476-479`; a later manual start uses `scripts/hermes-dev-control.ps1:93-102`. |
| `USER_DECISION_REQUIRED` | answer | `RUNNING` | `scripts/hermes-dev-control.ps1:103-154` validates the pending decision, starts the orchestrator, then removes the pending file and records the lock. |
| `BLOCKED` | restart after the blocker is resolved | `RUNNING` | Manual start path: `scripts/hermes-dev-control.ps1:93-102`. No machine check proves the blocker was resolved: unenforced — gap. |
| `ORPHANED_WORKER` | restart after review | `RUNNING` | Manual start path checks lock and clean tree (`scripts/hermes-dev-control.ps1:93-102`), but does not require an explicit orphan-review acknowledgement: unenforced — gap. |
| `FAILED` | restart | `RUNNING` | `scripts/hermes-dev-control.ps1:93-102`; safety is limited to live-lock, pending-decision, and clean-tree checks. |
| `STOPPED_BY_REQUEST` | restart | `RUNNING` | `scripts/hermes-dev-control.ps1:93-102` removes a stale stop request before launch. |
| `RUNNING` | no more work queued | `DONE` | unenforced — gap. No current protocol status or queue field explicitly records completion. |
| `DONE` | new start/new queued work | `RUNNING` | The ordinary start path can launch, but no distinct `DONE` value is consumed: representation gap. |

The answer path uses an exclusive `answering.lock`, but validation, process launch, pending-file removal, and lock publication are separate operations (`scripts/hermes-dev-control.ps1:118-152`). Likewise lock inspection and later mutation are not a single transaction. These known TOCTOU windows are documented gaps; this lifecycle documentation does not introduce a state-machine engine or broaden those operations.
