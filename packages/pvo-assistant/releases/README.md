# Inactive service release contract

The public `index.js` / `index.d.ts` entry points define strict data exchanged by the task journal and trusted hosting adapter. They perform no provider effects. This is an inactive JavaScript release, not a public operation or a deployment-ready service package.

A release identity contains `resourceId`, `ownerId`, `projectId`, `taskId`, `operationId`, exact `sourceDigest` and `expiresAt`. Ownership comes from the saved task. The server derives the resource ID from owner/project/task/operation, hashes source bytes, and validates both again before publication. A changed source under the same identity is a conflict.

Publication contains exactly `identity` and `source`, with a 1 MiB total JSON limit. An observation contains exactly `identity` and `state`: `missing`, `available` or `deleted`. It must match the full recorded identity. Missing is not proof that an in-flight publish cannot arrive. Only a cancellation tombstone closes that identity against late publication. Transport failures have no observation state.

Private probes have 4 KiB input/output, 20 total attempts, a 15-second deadline, 50 ms generated-code CPU and zero subrequests. Generated code receives no credentials or platform bindings. Local workerd verifies the byte/quota/network boundaries; actual CPU enforcement requires the provider proof.

The current inactive expiry is the originating task's deadline. Cancellation removes source and retains the small identity tombstone. Later activation and public service storage belong to Roadmap 1D.
