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

The server planner first saves an immutable behavior agreement, including examples, before it can request source tools. Its closed decisions are `ask`, `agreement`, `tools` and `review`. The schema advertises only tools backed by configured adapters. Model output cannot choose platform commands, credentials, task ownership or deployment readiness.

`state.js` owns the pure stage and cursor rules. `server/assistant/builder/repository.js` stores the agreement, last validated decision, cursor and bounded recent feedback in task-owned SQLite. The inference journal and builder decision commit with the task checkpoint. The operation journal retains the complete bounded tool receipts; model context projects recent feedback and omits large previous write contents. Private builder data expires with task retention.

Inference and execution use separate task claims. Each saved batch contains up to four calls with platform-assigned stable IDs. Start and dependent commands run under the same claim. Actual nonzero exit status or interruption stops the batch; the next inference receives that evidence to repair the source. A batch's optional `review` request advances only after every call succeeds, allowing a final test batch without a seventh inference. Readiness still requires the independent trusted gate.

After claim loss, cleanup and receipt lookup finish before recovery. The builder consumes already completed effects once and abandons remaining calls against the old computer. Missing output stays unknown. A reconciled failed builder batch may resume within the existing three-retry and active-task limits; Stop never resumes. A completed review checkpoint resumes without another model or tool call.

The task caps remain six model turns, 24 tool calls and four computer sessions. No Internet or dependencies are granted by a builder decision. The trusted service test gate remains 1C.07/1C.08, and publishing/attachment remain later tasks. The connected local builder does not yet make a deployable service available in the app.
