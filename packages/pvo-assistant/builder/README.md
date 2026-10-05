# Bounded workspace tools

These model-visible tool inputs and source projections sit above the [private workspace contract](../workspaces/README.md). They do not choose task ownership, execution grants, operation IDs, credentials, runtime configuration or release readiness.

| Tool | Purpose |
| --- | --- |
| `workspace_list` | List saved paths, byte sizes and the exact revision/digest |
| `workspace_read` | Read at most 4,096 UTF-8 bytes from one saved file; offsets count Unicode code points |
| `workspace_write` | Replace the bounded saved file set with a compare-and-swap revision |
| `workspace_start` | Restore the exact saved revision/digest into its private computer |
| `workspace_check` | Run fixed Node syntax checking on one saved file |
| `workspace_test` | Run one to eight saved Node test files |
| `workspace_result` | Read an owned saved mutation receipt; missing means unknown |

The list/read views use saved source outside the computer. Files changed by untrusted commands do not become authoritative source. Reads check revisions, file paths, offsets and UTF-8 byte limits. Command feedback preserves actual exit codes and bounded output. A completed command may have failed its tests; no generated result can declare a service ready.

`server/assistant/builder/workspaceTools.js` advertises only tools with supplied adapters and validates returned data. `taskTools.js` binds those adapters to a trusted saved-task claim. Each read, write, start, check, test or result lookup reserves one task tool call and saves its actual response in the durable workspace-operation journal. Exact replay returns the saved response without charging or executing twice. Uncertain reads follow the same claim-revocation and lookup recovery as other calls; a lost read response cannot start a computer. Late results cannot advance a stopped task.

The tool definitions are ready for the saved builder. The current planner still emits only ask/build decisions: **1C.05 must connect model decisions to these tools, save the behavior agreement before source generation, and use saved feedback for repair**. The trusted service test gate remains 1C.07/1C.08. Tool availability alone does not enable a general generated service in the app.
