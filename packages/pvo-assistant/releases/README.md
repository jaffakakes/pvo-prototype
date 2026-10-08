# Owned services and inactive releases

The public `index.js` / `index.d.ts` entry points define the strict data and pure catalog decisions shared by task journals and trusted hosting adapters. SQL, hashing, runtime execution and provider effects stay in `server/cloud-services/`.

## Ownership and immutable contents

A service has a stable `serviceId`, creator, project, description and lifecycle timestamps. The initial service ID is derived from the saved task's owner/project/task identity. Each publication attempt has a separate `resourceId` derived from that service and its task/operation identity. Retrying an uncertain attempt looks up the original release before another attempt can be admitted.

A release binds `agreementDigest`, `sourceDigest`, `packageDigest` and `reportDigest`, plus its owner/project/task/operation IDs, inactive expiry and `draftRevision` (a checked Container revision, or null when there was no draft target). Publication contains exactly `identity`, `artifact` and `report`; the artifact contains the agreement, multi-module package and three test digests. The server rehashes all canonical bytes. A changed owner or contents under the same identity conflicts.

Shape validation alone cannot approve a release. The trusted task host selects the immutable artifact and completed passed report from its own storage. Neither a browser request nor a model tool can supply publication bytes or assert that tests passed. Missing, failed or partial reports cannot enter hosting. There is one current checked-package contract; source-string publications are rejected.

## Saved catalog and provider lifecycle

The owner-scoped catalog records intent before publication: the service, release, runtime, operation names, audiences and read/write permissions. It retains metadata beyond task pruning. Artifact/report bytes are stored independently in immutable release rows inside the stable service object, separately from the temporary workspace and task artifact store.

Initial limits are eight non-deleted services per owner, eight new services per UTC day, 64 retained service identities and four releases per service. Exact intent replay works at the limit; deletion does not reset the daily budget. These are bounded initial product limits, not a billing guarantee. New releases begin pending and become inactive only after an actual provider observation. A missing observation is not proof that an in-flight publication cannot arrive. Cancellation retains a tombstone which blocks late publication.

Each new inactive publication receives its own expiry, at most 24 hours after its trusted intent is prepared. The journal freezes that value before dispatch. Exact retries and attachment verification use the saved expiry; the age or continuation of a goal cannot rewrite it. Expiry/cancellation removes artifact bytes. The owner catalog retains deleted metadata. Failed provider cleanup remains journaled and holds task retention until reconciled. Stop cannot turn a late release into an attached component.

## Private inactive checks

An inactive probe accepts only `{operation,input}`. Trusted code supplies the agreement's initial test state and current time on every probe; this slice has no durable live state or activation flag. Caller-supplied mode/state/time is rejected. This stateless diagnostic probe remains separate from the [durable creator Try route](../hosting/README.md). The public action route admits only an active service; activation controls remain later work.

Generated code runs through the same isolated package runtime as independent validation: fresh explicit modules, empty bindings, no outbound network, zero subrequests, 50 ms generated-code CPU, two-second invocation deadline and 64 KiB input/reply limits. Publication JSON is bounded to 2 MiB and the underlying package/field limits also apply. Each release permits 20 probe attempts. Some runtime-provided Node APIs exist; they grant no platform files, credentials or network access. Actual provider CPU enforcement is historical proof evidence, separate from the current local checked-package tests.

Successful hosting advances a component-building task to `attach`, or a Container editing/testing task to its saved draft result. Stable routing, durable actions, activation, compatible version selection and component attachment are implemented under the hosting/attachment contracts. Container publication additionally requires a current checked draft revision on first activation. Local workerd checks and static beta delivery do not mean the cloud product has been deployed.
