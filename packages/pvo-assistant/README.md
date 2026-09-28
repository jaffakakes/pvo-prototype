# PVO assistant contract

`index.js` and `index.d.ts` expose the shared JSON request and response boundary for the editor and assistant service. `parseAssistantRequest` and `parseAssistantResponse` reject unknown fields and throw `TypeError` for invalid values. They preserve exact source strings, with a 20,000 UTF-8 byte limit per section. `assistantResponseSchema` describes the model's structured output; parsing still enforces byte limits and nonblank text.

The optional request context contains the current scene ID, its finite nonnegative duration, and up to 100 playable scene IDs and names. IDs must be unique and include the current scene. Scene IDs are limited to 128 characters and labels to 120. No media or full project data belongs in this contract.

`policy.js` accepts compiler output and checks component identity, playback routes and unchanged request actions. Consumers must compile the exact source before applying these checks. Neither module performs model inference, network requests, editor mutations or rendering. The editor validates context again before review and Keep.

Optional `editingMode` is `no-code` or `advanced`; an omitted value uses no-code logic limits. `no-code-policy.js` checks only new/changed behavior: local Continue/time/scene routes are allowed, and existing advanced rules must remain unchanged. It does not constrain appearances or wording. The editor rechecks the current preference at review and Keep. Optional response `requiresAdvancedLogic: true` represents a logic-only refusal, never an applicable partial proposal; its source should remain unchanged. Neither this mode nor Advanced expands the existing network policy.

See the [orb assistant guide](../../docs/engineering/orb-assistant.md) for the full wire contract and workflow.
