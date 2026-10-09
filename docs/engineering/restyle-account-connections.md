# Restyle account connections — Roadmap 2B

[Roadmap 2](restyle-cloud-agent-roadmaps/02-research-and-connections.md#2b-connect-one-external-account-securely) · [Progress](restyle-cloud-agent-progress.md) · [Research contract](restyle-research-contract.md)

## In plain language

An account connection is a locked key cabinet. The creator gives Restyle limited access through a private form. Restyle keeps the key on the server. The AI sees which connection exists and what Restyle permits it to do. It never receives the key.

A saved task can request a connection, wait for setup, and continue from the same question. Existing answers, code and completed work stay saved. Disconnecting removes Restyle's stored key and blocks later calls. Deleting the token at the provider is a separate control available in the provider's settings.

This is separate from the temporary workshop and the hosted Container. Neither receives the credential. Connecting an account alone does not give generated Container code access: the additional release-bound approval and external-effect lifecycle are described in [Roadmap 2C’s connected Container contract](restyle-connected-services.md).

## First installed provider

**GitHub, one named repository per connection.** The completed 2B operations below are read-only. 2C adds separately approved Container recipes, including an optional issue-creation grant; see the [connected Container contract](restyle-connected-services.md). Proposed because the creator already has a GitHub account and a repository with accessible test support; not because any example requires it. Provider preference was asked on 8 October; GitHub is the selected default while allowing the creator to choose another service. The current project repository is public, so reading it does not prove permission to private repositories. A live authenticated `/user` check is still mandatory, and private-repository access must only be claimed if separately exercised.

| Operation | Fixed provider request | Returned data |
| --- | --- | --- |
| Setup / check | `GET https://api.github.com/user`, then the two reads below | Account identity and verified repository access; raw provider bodies and headers are discarded |
| `github_repository_read` | `GET /repos/{saved owner}/{saved repository}` | Repository name, private flag and open issue/PR count |
| `github_issues_list` | `GET /repos/{saved owner}/{saved repository}/issues?state=all&per_page=20&page={page}` | Up to twenty issue summaries, excluding pull requests, and a possible-more flag |

These two 2B operations cannot create issues, comments, code changes, merges, deployments or messages, and cannot inspect Actions. The separate 2C interface allows only its installed method/path policy. `repository:read` and `issues:read` are Restyle's enforced operation permissions, established by successful probes against that exact repository. They are not an introspection report of every permission on the submitted token. Public repository reads alone do not establish broader private access. A renamed repository must be reconnected with its current name; redirects are refused.

The private form accepts only a fine-grained GitHub token. Select one repository, Issues read permission and an expiry on GitHub. Metadata read permission is included there. Restyle's restriction still applies if a creator mistakenly supplies a broader fine-grained token; it cannot prove that the provider token has no additional permissions.

Checked official references on 8 October 2026: [GitHub token setup](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens), [authenticated user](https://docs.github.com/en/rest/users/users#get-the-authenticated-user), [repository issues](https://docs.github.com/en/rest/issues/issues#list-repository-issues), [required fine-grained permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens). The adapter pins API version `2026-03-10`. Documentation establishes the protocol, not completion of a real account test.

## Ownership and storage

- Shared closed contracts: [connections package](../../packages/pvo-assistant/connections/index.js). Model metadata excludes secrets. The optional typed account question distinguishes private setup from an ordinary text question.
- Account owner: the existing authenticated `AssistantTasks` Durable Object. [Routes](../../server/connections/routes.js) select it from the account session, enforce same-origin mutations, HTTPS outside loopback and bounded input. Task IDs and connection IDs do not authorize another creator. `X-Restyle-Owner` must also match the current authenticated account, preventing a stale editor from saving its key into a newly signed-in account.
- [Catalog](../../server/connections/catalog.js): credential-free names, installed operations, status and revisions, four records per page.
- [Protected store](../../server/connections/store.js): account identity, saved repository scope, check/expiry times and an encrypted token. The wrapping key is the distinct Worker secret `ACCOUNT_CONNECTION_KEY`, exactly 32 random bytes encoded as 64 lowercase hex characters. Never commit it, print it, put it in a URL, or derive it from a model/task. Provision it through the host's secret manager. Losing or replacing this key requires reconnection; no legacy keyring or plaintext fallback is implemented.
- [Credential adapter](../../server/connections/credentials.js): AES-GCM with a random nonce and owner/connection/revision bound as authenticated context. An envelope cannot be moved between owners, records or revisions. Disconnect and known invalidation erase the ciphertext; revocation metadata remains so IDs and permissions cannot silently be reused.
- [Manager](../../server/connections/management.js): lifecycle, current scope and revision checks before and after asynchronous provider calls. An in-flight read cannot return a successful result after local disconnect or replacement. Already-dispatched provider reads cannot be recalled.
- [GitHub adapter](../../server/connections/providers/github.js): attaches Authorization only to the fixed HTTPS GitHub destination. The 2B operations are GET requests; [2C recipes](restyle-connected-services.md) add validated methods under installed policy. No arbitrary origin, private header control or redirects. Bounded JSON is projected into a small result, and a reflected submitted token is rejected. Provider errors and headers never enter model context or client diagnostics.

## Saved task setup

When the configured server supplies private setup, the builder can return `connect_account` with the installed provider, repository and request-specific purpose. This becomes an ordinary durable question with typed connection setup metadata. A private form or existing matching connection answers it through the authenticated connection manager. The trusted answer stores `connectionId`, preserving the existing task, step, answer history, usage and operation receipts. Successful setup does not start a new task or rerun publication.

The public text-answer route cannot forge a successful connection answer. A creator can explicitly choose **Continue without this connection**; that saves a choice to reconsider the plan, not account access or success. Missing server setup is displayed as unavailable. A provider without an installed setup adapter remains unavailable even if documentation suggests an API exists.

## Limits and deployment boundaries

There are at most 32 retained connections per account, four per list page, a 4 KiB private request limit, a ten-second deadline per provider call and a 256 KiB provider response limit. Issue pages contain at most twenty provider records and accept pages 1–1000. These are individual operation/storage bounds, not an overall agent-turn ceiling. GitHub rate-limit responses preserve the connection and ask the creator to retry later. Known token expiry or rejected access marks it as needing reconnection and removes the saved token.

No paid resources or permanent hosting are required for the local acceptance. The main beta currently serves static files; it has no configured account/task API. Delivering its UI does not deploy private connection storage. Production remains explicitly prohibited.

## Verification checkpoint — 8 October 2026

Full **1,642 tests**, strict editor types, source syntax/dependency/formatting checks and actual desktop/phone/reload/settings lifecycle checks pass. New coverage includes account switching, in-flight disconnect/reconnect fencing, durable account access after task cleanup, response/deadline/credential reflection limits and full-size task replies. Source **`9068ce0` is committed and pushed**. Combined beta **`14e33f0`** passes build, strict types and **49 focused checks**; actual served files and activated service worker verify **`restyle-editor-shell-9ba9e267c3671ed5`**. Older assets are retained and no editing session was forcibly reloaded. See [progress](restyle-cloud-agent-progress.md) for commands, backups and portable continuation details.

**All six 2B tasks are complete.** The creator entered a short-lived fine-grained token through the private form. The real GitHub acceptance passed at **2026-10-08T05:37:18.506Z**:

- Authenticated GitHub account `jaffakakes`; read public `jaffakakes/pvo-prototype` through the two installed operations. The issue endpoint returned zero current issue summaries; controlled tests cover nonempty response projection.
- The connection answer and same task survived a Worker restart. Actual editor/browser reload and subsequent task resumption are covered by the separate controlled acceptance.
- Advanced only the isolated server clock past GitHub's actual token deadline; expiry removed the saved key and required reconnection. Reconnected with the privately retained test credential, then disconnected and verified later calls were denied.
- Another authenticated creator could not invoke the connection. The local stored key and exact test storage were removed, and the owned form/Vite/Worker processes were stopped. The creator can also delete the short-lived provider token in GitHub settings; local disconnect does not claim provider-side token deletion.

The real provider driver started before later expected-account-header, deadline and transport hardening. This is composite evidence: actual provider/authentication/lifecycle proof plus the final source's full controlled regression and browser checks. It is not labelled as a live run of the exact final commit. The safe receipt and cleanup are summarized in committed progress, so another agent does not need private logs or a repeated token test to continue.

That completed 2B proof claims no live model-quality, private-repository access, provider write or generated-Container account invocation. **The next task at that checkpoint was 2C.01**, give a generated service an approved connection reference and operation while keeping enforcement and credentials in trusted platform code.

## Roadmap 3 email extension

[Background work](restyle-background-work.md) adds a separate installed Resend setup shape: creator-selected `from` and `recipient`, with private API key and optional callback signing secret encrypted through the same account vault. Only approved checked Container recipes can send bounded plain-text email. Ordinary Try stays offline. Generic connection invocation remains the installed GitHub reads; Resend is not an arbitrary API proxy. A full-access Resend key is needed for sending and reading delivery evidence.

## Roadmap 5 identity extension

[Agent identity and account setup](restyle-cloud-agent-roadmaps/05-agent-identity-and-onboarding.md) extends this same owner and vault with one AgentMail inbox and optional AgentPhone number. The closed scope is `{ provider, resourceId }`. Their saved account grants expose an address, status and identity permission with no generic provider operations; ordinary model account questions still advertise only the currently installed GitHub/Resend setup. The dedicated human-only [identity route](../../server/agent-identity/routes.js) handles bootstrap, code verification/resend and private existing-account selection. The [identity manager](../../server/agent-identity/management.js) persists intent, revisions and consent before dispatch, encrypts one-time bootstrap keys and then installs a verified credential in the existing vault. Bootstrap ciphertext is erased once that transfer completes.

The temporary workshop never owns these accounts. New setup uses the signed-in creator's verified Restyle email and a server-generated unique resource name. The form only asks for provider terms/cost approval, followed by any ownership code. No manual email/name entry or separate dashboard signup is required for this bootstrap. The agent's working inbox receives later service verification; Restyle gains no access to the creator's personal mailbox. Human email/code stays outside model inputs. Phone setup explicitly confirms the documented US$3 monthly number cost. Existing-key imports choose an active resource from a bounded private provider page and cannot replace a saved identity with a different resource. Check retries use retained keys after temporary outages. Disconnect removes Restyle access even if the wrapping key is unavailable; it does not close the provider account or stop number billing. Unknown signup/verification outcomes are not silently repeated. One-time keys are captured before subsequent provider probes, but an actually lost provider reply still requires honest recovery.

### Signed account email for identity bootstrap

In the existing Clerk **Development** instance, Sessions → Customize session token uses these two signed claims:

```json
{
  "restyle_email": "{{user.primary_email_address}}",
  "restyle_email_verified": "{{user.email_verified}}"
}
```

The [private account-proof adapter](../../editor/src/infrastructure/auth/accountSessionToken.ts) checks the current Restyle cookie owner, obtains a fresh ordinary Clerk session token and passes it only in the identity-start Authorization header. The server uses its existing issuer/signature/origin/session/freshness validation, requires a nonempty email and literal verified boolean, then checks the Clerk issuer/subject mapping against that exact cookie owner. Matching email text never merges accounts. The public start body is exactly `{ provider, expectedRevision, consent, monthlyNumberCents }`; client-selected email/name fields are rejected. The private lifecycle receives only the trusted derived contact/name and saves its original attempt before dispatch. Resend/recovery keeps that original contact even if the primary account email changes later. Owner/session changes and cancelled or late sign-in loads cannot dispatch setup.

The development dashboard's rendered claim preview confirms a string email and boolean `true`. This is not an extra Clerk secret, JWT template, personal-mail permission, schema migration or new login path. Missing/unverified claims require email sign-in recovery before new setup; there is no manual-email fallback. Existing saved identities/import/check/disconnect remain under their current owner/revision lifecycle. To reproduce beta on another account instance, configure these exact session claims before new identity bootstrap; production configuration is untouched.

These identity connections do not yet perform downstream signup or give a Container arbitrary email/phone access. Private saved code-verification infrastructure is now controlled-tested in [the task-bound workflow](../../server/account-onboarding/verification.js); its proof journal is encrypted and has no public inbox/model tool. A real named signup consumer, magic-link/session handling, account signup/key acquisition and checked Container attachment remain the unchecked 5B–5E gates. Controlled tests do not establish live account or message delivery.
