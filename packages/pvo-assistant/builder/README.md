# Saved builder and bounded workspace tools

These model-visible tool inputs and source projections sit above the [private workspace contract](../workspaces/README.md). They do not choose task ownership, execution grants, operation IDs, credentials, runtime configuration or release readiness.

| Tool               | Purpose                                                                               |
| ------------------ | ------------------------------------------------------------------------------------- |
| `workspace_list`   | List saved paths, byte sizes and the exact revision/digest                            |
| `workspace_read`   | Read at most 4,096 UTF-8 bytes from one saved file; offsets count Unicode code points |
| `workspace_write`  | Replace the bounded saved file set with a compare-and-swap revision                   |
| `workspace_start`  | Restore the exact saved revision/digest into its private computer                     |
| `workspace_check`  | Run fixed Node syntax checking on one saved file                                      |
| `workspace_test`   | Run one to eight saved Node test files                                                |
| `workspace_result` | Read an owned saved mutation receipt; missing means unknown                           |

The list/read views use saved source outside the computer. Files changed by untrusted commands do not become authoritative source. Reads check revisions, file paths, offsets and UTF-8 byte limits. Command feedback preserves actual exit codes and bounded output. A completed command may have failed its tests; no generated result can declare a service ready.

`server/assistant/builder/workspaceTools.js` advertises only tools with supplied adapters and validates returned data. `taskTools.js` binds those adapters to a trusted saved-task claim. Each read, write, start, check, test or result lookup reserves one task tool call and saves its actual response in the durable workspace-operation journal. Exact replay returns the saved response without charging or executing twice. Uncertain reads follow the same claim-revocation and lookup recovery as other calls; a lost read response cannot start a computer. Late results cannot advance a stopped task.

## Saved construction loop

The server planner first saves an immutable behavior agreement, including examples, before it can request source tools. Its closed decisions are `ask`, `research`, `agreement`, `tools` and `review`. The schema advertises only tools backed by configured adapters. Model output cannot choose platform commands, credentials, task ownership or deployment readiness.

`state.js` owns the pure stage and cursor rules. `server/assistant/builder/repository.js` stores the agreement, last validated decision, cursor and bounded recent feedback in task-owned SQLite. The inference journal and builder decision commit with the task checkpoint. The operation journal retains the complete bounded tool receipts; model context projects recent feedback and omits large previous write contents. Private builder data expires with task retention.

Inference and execution use separate task claims. Each saved batch contains up to four calls with platform-assigned stable IDs. Start and dependent commands run under the same claim. Actual nonzero exit status or interruption stops the batch; the next inference receives that evidence to repair the source. A batch's optional `review` request advances only after every call succeeds, avoiding an extra inference after the final test batch. Readiness still requires the independent trusted gate.

After claim loss, cleanup and receipt lookup finish before recovery. The builder consumes already completed effects once and abandons remaining calls against the old computer. Missing output stays unknown. A reconciled failed builder batch may resume when active-task capacity is available; Stop never resumes. A completed review checkpoint resumes without another model or tool call.

Model turns, tool calls, research reads, package reviews and computer sessions are accounted without a fixed goal-wide ceiling. The current notebook and recent model feedback stay bounded while settled receipts remain in owned journals. Answered questions archive durably, and every inference stage can select old evidence through the shared history reader. Routine whole-journal scans and resumable capacity waits remain in 1B.12/13. No Internet or dependencies are granted by a builder decision. The trusted service test gate is described in the [service contract](../services/README.md#independent-test-reports). Checked packages can advance through hosting and component preparation; runtime invocation and cloud product deployment remain later tasks.

## Controlled public research

`web_search` and `web_read` may run before or after the immutable agreement. These tools use the existing trusted public-web adapters, not the temporary computer. The schema only advertises them when the adapter is available. Each research batch has at most two requests. Additional decisions can request more research; there is no fixed total request count per goal. Requests have a 10-second deadline, also bounded by the current task claim. The public adapter permits HTTPS GETs, rejects credentials/private addresses, checks DNS and every redirect, omits cookies/authorization, limits redirects and downloaded bytes, and never runs page JavaScript.

Results retain actual source URLs and retrieval times. Page text is at most 16,000 UTF-8 bytes; the complete saved result is at most 48 KiB. Unreadable, challenged, oversized or invalid responses supply no evidence. A lost response is `unknown`, not an empty successful search. Source text is untrusted data and cannot authorize an account action or change the agreement.

`TaskResearch` saves the owned intent before a request, reserves one tool call, and saves its actual result before further inference. Exact request-ID replay returns the saved result and charges once; different input conflicts. On worker loss, an unfinished read settles as unknown and is not silently repeated. Stop cancels the request and blocks late evidence from advancing the builder. Private query/result content expires with the task. No workspace is started for research.

The package policy remains the current **empty dependency lock**: standard JavaScript/Web APIs only. There is no package-install tool and the computer remains offline. Introducing dependencies requires a scoped resolver with pinned versions/integrity and a demonstrated need; it does not follow from a model asking for Internet access.


## Independent review and repair

A review captures the exact requested owned snapshot and runs saved behavior cases outside generated code. The platform saves `reviewFeedback` beside builder state: the exact review request, either a completed trusted test report or a bounded artifact error, and the immutable agreement reference. A failed review returns to model repair within existing budgets. Feedback remains visible while source is repaired and clears when a new review is requested. The model cannot submit this feedback or replace the agreement. A passed report goes to the separate `host` task stage; it does not mark the component ready.


## Retrieving older evidence

Planning, construction and attachment share a read-only `history` decision. Its closed input selects `questions`, `operations`, `research`, `workspace` or `reviews`, a prior sequence cursor, a Unicode code-point offset and at most 4,000 UTF-8 bytes of working notes. The trusted coordinator supplies ownership and reads one saved row. Each reply contains at most 4,096 UTF-8 bytes of serialized evidence, the row's sequence and the next offset, or a null sequence when exhausted. Full journals stay intact; fragments are model context, not new action outcomes. Retrieval performs no provider action or tool dispatch and cannot approve a release.

The selected fragment and model-written working notes commit with the successful inference checkpoint, survive restart and remain in subsequent planning context. Notes are explicitly untrusted summaries; actual receipts and independent reports remain authoritative. The model can request successive fragments or later entries and revisit original data whenever its notes are insufficient. Stale claims and Stop cannot persist late selections. Questions without answers remain in the current notebook. History and notes remain private and are removed with safe terminal task-content retention.
