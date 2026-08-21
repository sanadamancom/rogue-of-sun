# Hermes Decision Base publishing

When Hermes stops for `USER_DECISION_REQUIRED`, a ChatGPT project Chat using the GitHub connector needs read-only access to the exact Decision Base commit. Hermes therefore publishes that commit to a dedicated `decision-base/<decisionId>` branch on `origin` and includes its location in the Decision Packet.

This automatic push is allowed only for `USER_DECISION_REQUIRED`. It is never used for `CONTINUE`, `SESSION_BOUNDARY`, `BLOCKED`, normal development commits, or any other condition.

## Dedicated ref design

The published commit is the full `commit_sha` recorded in `.ai/control/pending-decision.json` when the decision status was written. Local `HEAD` may later move beyond that commit, for example because of control-layer commits, so pushing `HEAD` would not reliably expose the Decision Base. A new per-decision ref makes the exact commit reachable without moving the development branch, `main`, or `master`, and without force-pushing.

## Safety checks

The standalone publisher fails closed unless the repository exists and is a git repository; the pending file is valid, has the required status and matching decision ID, and contains a full lowercase 40-character SHA; the working tree is clean; `HEAD` is attached to a development branch other than `main` or `master`; the commit exists and is an ancestor of `HEAD`; and the configured remote is reachable. It derives an owner/repository slug from the remote URL, inspects the exact decision ref, and refuses to overwrite it if it points elsewhere. A new ref is pushed without force, then read back and required to match the requested SHA exactly. No check failure triggers a workaround, alternate ref, retry with force, or success report.

Publish failure leaves the decision pending and produces the same controlled stop as before, with an explicit failure notice. The pending decision, control state, and lock are not removed. For recovery, run:

```powershell
scripts\hermes-dev-control.ps1 -Command publish-decision-base -DecisionId <decisionId> -Json
```

This command reruns the same checks and is independent of whether the orchestrator is running. It does not answer the decision or restart orchestration.

On success, the Decision Packet identifies the repository slug, `decision-base/<decisionId>` branch, exact commit SHA, and clean working tree, followed by Claude's authored decision reason without modification. A human pastes the packet into a ChatGPT project Chat with the GitHub connector. That Chat is not bound by the options proposed by Claude or Hermes and may recommend an independent third option.
