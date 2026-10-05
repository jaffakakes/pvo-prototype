# Roadmap 4: maintain and expand what was built

[Roadmap overview](../restyle-cloud-agent-roadmap.md) · [Architecture](../restyle-cloud-agent-architecture.md)

**Outcome:** a creator can ask Restyle to change or fix an existing connected component. The agent understands what is already deployed and can make a tested update.

**Depends on:** Roadmap 1's source records, releases, service controls, and basic recovery. Roadmaps 2 and 3 are needed for any connected accounts or background jobs affected by an update.

Core ownership, spending limits, pause/delete controls, and release recovery already belong in Roadmap 1. This roadmap improves the experience and expands what the system can build.

## 4A. Let the agent inspect and repair an existing feature

- [ ] Give it a scoped view of the deployed source, component connection, release history, sanitized errors, job status, and connection availability.
- [ ] Identify the failing stage before changing code: component input, gateway validation, backend rule, external account, provider, or result display.
- [ ] Reuse the existing project and service identity. A repair should not create a duplicate guest list, account connection, or service unless the requested change requires it.
- [ ] Reproduce the failure with safe test data in a workspace.
- [ ] Change the smallest relevant part and add a meaningful regression check.
- [ ] Report the verified outcome and any remaining external dependency.

**Finished when:** a broken connection and a backend rule bug produce different correct repairs. The agent preserves existing records and does not repeat completed viewer actions.

Use the current [Try diagnostics design](../try-debugger-plan.md) and [notification policy](../notification-policy.md) when presenting evidence and unresolved failures.

## 4B. Update a working service without breaking shared components

- [ ] Build a new inactive release from retained source and the requested change.
- [ ] Identify every recorded active component connection and export that points to the service. Forwarded or downloaded copies may still use those addresses even when Restyle cannot count the viewers. Test the update against the recorded agreements.
- [ ] Check that the new code can use the current saved records. Define a specific data-change task if that cannot be guaranteed; do not silently rewrite or discard records.
- [ ] Keep the active release unchanged while tests run.
- [ ] Switch only the verified service/component connection as one recorded release action. Preserve the prior release for recovery while it remains safe to run against current records.
- [ ] Test a failed update and restore service availability without replaying external writes.
- [ ] Explain what editor Undo can restore and which live changes require a separate reversal.

**Finished when:** the creator asks to change the RSVP capacity rule, the update works for the intended shared component, and a deliberately broken replacement leaves the prior release working.

These are deployed code releases using one current platform/PVO contract. Do not implement old manifest shapes, legacy parsers, or automatic compatibility adapters as part of update handling.

## 4C. Improve service management

- [ ] Show which projects and published components use each service and which account connections they need.
- [ ] Add useful views of remaining quotas, approximate cost, recent results, and failures.
- [ ] Surface expiring credentials and limits through the existing status surfaces. Keep unresolved problems visible after dismissing a notice.
- [ ] Let creators inspect retained data and choose the allowed cleanup action.
- [ ] Explain the effects of pause and deletion on new submissions, accepted jobs, and stored records before applying the selected operation.
- [ ] Verify periodic cleanup removes only abandoned resources and expired records covered by the agreed retention rule.
- [ ] Add operational checks that detect a service whose published component still points to a missing release.

**Finished when:** a creator can determine why a feature stopped, restore its connection, control its cost, and retire it without guessing what remains active.

## 4D. Expand capabilities when a real request needs them

Implement these as separate follow-on tasks. Each needs a concrete demonstration.

| Capability | Evidence that it is needed | Proof before calling it ready |
| --- | --- | --- |
| Richer live controls | A real task needs returned lists, availability slots, or editable server data. | The data-driven control behaves the same in Try, export, and the standalone player. |
| Additional runtimes | A required library or process cannot run in the initial service environment. | The same ownership, limits, deployment, pause/delete, and recovery contract works on the new runtime. |
| Calling or connected-device actions | A chosen workflow requires an actual phone or device operation. | A real authorized connection performs the action and reports its available evidence truthfully. |
| More provider integrations | Research finds a service with usable access and a creator needs it. | The connection passes setup, test/live, revocation, and failure checks. |
| Better automatic repair | Repeated failures have a safe, bounded fix. | The repair restores service and preserves existing records without repeating completed actions. |

A browser automation capability may help with some services, but account access and actual supported actions still need verification. The agent should ask for a connection or agree a manual step when it cannot establish a reliable execution path.

## Complete this roadmap

Demonstrate one real repair, one successful update, one failed update with safe recovery, one paused/deleted service, and one additional capability justified by a concrete request.

Run the focused behavior checks and affected browser paths, then complete the same beta verification and release workflow used for earlier roadmaps. Stop expanding once the chosen roadmap outcome is met; future capability requests become their own focused tasks.
