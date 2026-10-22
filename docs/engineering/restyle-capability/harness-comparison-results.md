# Simpler harness comparison — 22 October 2026

The simpler source-action interface works, but this experiment does **not** establish a reliability improvement. Both versions finish all fourteen coding/repair tasks. Neither needs a model-output format repair. The candidate autonomously corrects one syntax error in its generated poll test; the baseline has no failed tool attempts. That exceeds the no-worse rule recorded before testing, so the current beta remains unchanged.

| Measured result | Current harness | Simpler candidate |
| --- | ---: | ---: |
| Completed tasks passing independent checks | 14/14 | 14/14 |
| Model-output format repairs | 0 | 0 |
| Failed tool attempts before recovery | 0 | 1 |
| AI calls | 42 | 43 |
| Median task time | 76.3 seconds | 74.7 seconds |
| Known estimated inference cost | $1.337682 | $1.253973 |
| Unknown-usage attempts | 0 | 0 |

Timing/cost differences are descriptive results from two repetitions, not statistically established savings. One self-corrected generated-test error does not prove the new interface caused worse coding. It does mean this sample fails the predeclared rollout threshold; no threshold or output was changed afterward.

## What changed

The model no longer supplies source revision/digest fields for reads, saves, execution or review. Restyle captures the trusted source snapshot before inference and binds validated intent to it afterward. A concurrent edit still rejects the stale action. Writes complete before dependent tests/review. Durable operation IDs, claims, restart recovery, independent checks, credentials, permissions and duplicate prevention remain authoritative. Research evidence IDs, agreement planning, model settings and supported capabilities are unchanged.

The measured candidate is `e6c20807ee0d04c10537491776bd62bac3c0bdd8`; baseline is `67c38621829ed503382f72fd2329fc1a8c73fd93`. After measurement, the pure input rules move from the server into the shared builder package to respect public package boundaries. Every function body is verified byte-for-byte unchanged. A separate existing AgentMail timeout-test fixture is corrected after reproducing its GitHub event-loop cancellation; no production timeout changes. Final source/browser verification is recorded below.

## Method and evidence

Five unchanged coding/repair tasks cover guestbook storage, capacity/cancellation, timed polls, trusted connected results and fixing deliberately broken code. Two fresh tasks cover atomic inventory withdrawal and expiring one-use invitations. Both arms use Kimi K3/high reasoning, identical provider settings, the same pinned network-disabled Node executor, and the same independent cases. The first repetition runs baseline first within each pair; the second runs candidate first. All 28 runs finish without developer intervention, edited output or unknown usage. All 390 recorded test containers report cleaned.

The [frozen plan and gate](../restyle-cloud-agent-roadmaps/08-simpler-harness.md) and [sanitized evidence](harness-comparison-evidence.json) retain exact hashes, per-run metrics and all final independent checks. Full requests, responses, intermediate failures and resource journals remain privately retained under the journal name in the evidence. The poll syntax error and its autonomous repair are preserved. The existing 105-run reliability study remains historical; these fourteen candidate results do not replace it or cover vision, native editing, new providers or broad autonomous account signup.

Reproduce with the baseline in a separate clean checkout:

```sh
node scripts/checks/restyle-capability/run.mjs builds --compare-with /absolute/path/to/baseline --repetitions 2 --label source-binding-ablation
```

Each run records its source, frozen files, matrix, provider attempts and resource cleanup before/after effects. Compare each arm separately; do not combine their successful runs into a single claimed candidate success rate.

## Final verification and disposition

Final Node 22 source check after the behavior-neutral ownership move passes 1,794 tests with four optional skips and zero failures/cancellations. Strict editor types, forty focused builder/transport checks and four focused Node 22 checks pass. Pending: build, actual saved guestbook/email browser journeys and final resource audit. PR116 remains draft, stacked on PR111. No integration merge, new real email, production deployment or branch deletion. Beta remains `restyle-editor-shell-60f4abbf9460f059`.
