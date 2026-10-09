# Roadmap 5: agent identity and account setup

[Roadmaps](../restyle-cloud-agent-roadmap.md) · [Progress](../restyle-cloud-agent-progress.md) · [Account connections](../restyle-account-connections.md)

## What the creator wants

Ask Restyle for a finished feature. The agent researches the services it needs, uses its own email and phone identity to set up supported accounts, saves their credentials privately, connects the checked Container and tests the result. Existing connections are reused on later tasks. The creator takes over only at a concrete step requiring their decision or presence.

On 9 October 2026 the creator selected **AgentMail and AgentPhone** and authorized implementation in beta. This resumes the previously paused account-linked agent email work. Roadmaps 1–4 and their historical evidence stay complete. Production is prohibited.

## Reuse the current architecture

- The temporary VM remains the agent's workshop. It can stop without losing accounts or credentials.
- The Container remains the checked Node.js service used by viewers. PVO Logic stays restricted.
- The existing creator-owned AssistantTasks object owns the lasting identity and saved setup attempts beside its existing tasks and connection vault. Do not add another owner catalog or a permanent VM per creator.
- The existing encrypted account connection store owns usable credentials. Bootstrap keys and verification handles must also be encrypted under the same server wrapping key before durable storage. The model, workshop, exported PVO and ordinary logs receive no keys, codes or sign-in links.
- A creator has one lasting email identity and optional phone identity initially. Reuse them across their tasks; additional personas require a later explicit product decision.
- Email messages and SMS are untrusted input. A verification code must match a saved setup attempt, expected sender and time window; a message cannot authorize a new account, recipient, purchase or credential destination.

## Ordered checklist

- [x] **5A.01** Define owner-bound persistent identity, public metadata, setup intent and recovery contracts; document costs and resource ownership.
- [x] **5A.02** Implement AgentMail and AgentPhone bootstrap/import through fixed trusted APIs, encrypted saved credentials, restart recovery and duplicate/concurrent setup protection. Preserve one-time credentials before reporting success.
- [x] **5A.03** Add private setup and status inside existing Connected accounts, including one-time human verification, existing-account recovery and explicit phone cost consent; fence account changes and late results.
- [ ] **5B.01** Connect email/SMS verification to saved account setup attempts. Match sender, recipient, operation and expiry; keep secrets outside model context and resume the same saved task.
- [ ] **5C.01** Add saved third-party account setup with persistent intent, verified provider identity and approved access. Support existing-account reuse, browser/API execution, API-key capture directly to the vault, expired sessions, required human actions and uncertain outcomes.
- [ ] **5D.01** Let research and building choose this setup path and attach its resulting approved connections to checked Containers. Exercise different requests and preserve current test/publication gates.
- [ ] **5E.01** Prove real email and phone identities and one permitted third-party signup/key acquisition through a finished Container, including interruption, reuse, owner isolation and delivery checks. Report the exact supported services; do not claim universal signup.
- [ ] **5E.02** Deliver and verify the actual beta release, save portable evidence and GitHub handoff, account for retained resources and stop temporary compute without disabling resources needed for creator review.

## Provider facts checked on 9 October 2026

**AgentMail:** [Agent onboarding](https://docs.agentmail.to/agent-onboarding) and [signup API](https://docs.agentmail.to/api-reference/agent/sign-up) allow first-time signup using a human email. Signup returns an organization, inbox and one-time key. Human OTP verification unlocks full permissions. Repeating signup with the same human email rotates the key, so a completed bootstrap must never be casually repeated. Existing-account imports are a legitimate setup path, not a legacy format. Credentials stay in US API scope initially; no arbitrary regional endpoint can receive them.

**AgentPhone:** [official agent API guide](https://agentphone.ai/skills.md) describes signup then human-email OTP verification. Verification creates account, number, starter agent and one-time key. Existing human accounts may require a private dashboard-key connection. [Pricing](https://agentphone.ai/pricing) lists US/Canada local numbers at US$3/month, SMS US$0.02/segment plus applicable carrier charges, and voice from US$0.13/minute. Starter credit is not a perpetual free number. iMessage is a separate paid line and is outside this initial identity work. No purchase, paid line, card, automatic recharge or outbound call is authorized merely by implementation approval.

**Account setup:** [AgentID](https://docs.agentmail.to/agentid-sign-in) supports a catalog of participating apps. Connecting returns a credential-like single-use sign-in link, not the app's ordinary API key. A real browser/session or app-specific API still has to finish signup and capture the service key. Some services require agreements, payment, human identity or CAPTCHA. Preserve the concrete required-action state rather than inventing completion. No credential is sent to an unverified URL from an email or generated code.

## Resource intent before creation

No new provider account, inbox, phone number or third-party credential has been created by this implementation batch. The private beta form will record the creator's selected provider, identity, consent and exact attempt before dispatch. Record resulting resource IDs and cleanup/retention privately. Keep approved identities/connections across VM or browser shutdown. Local disconnect removes access; it does not claim provider account deletion or stopped number billing. Phone release is separately consequential because its number cannot normally be recovered.

## Acceptance evidence

Unchecked until observed. Controlled provider tests are not live provider acceptance. Documentation, implementation, GitHub push, beta availability and production are separate states. See current progress for the next concrete action.

**5A.01–02 verified:** current closed identity contract saves the approved setup kind, time and monthly number cost before dispatch. Creator-owned SQLite stores encrypted bootstrap material and transfers verified keys into the existing account vault. Concurrent signup dispatches once; restart, uncertain verification, one-time-key recovery after inspection failure, code resend without AgentMail key rotation, private existing-resource discovery, resource ownership, credential erasure and ordinary-model/generic-key-route exclusion have controlled coverage. All 21 affected tests and strict editor types pass. First whole-source run passes 1,720 tests with one optional Docker skip; the final identity changes have the focused checks above. Real accounts and downstream signup remain unverified and unchecked under 5E.01.

**Current discovery bound:** an existing-key form lists the first provider page, at most 50 active identities, and explicitly reports whether more exist. No arbitrary endpoint or raw account payload is returned. A saved identity cannot be replaced with a different inbox/number. Initial creator setup uses one identity per provider. Pagination beyond this first page needs a follow-up if a creator's selected resource is not there.

**5A.03 verified:** actual authenticated beta shows Agent identity under More → Connected accounts. Mail signup, existing-account selection and phone monthly-cost confirmation are reachable; private code/key forms clear secrets before saving or unmounting. Scope epochs, abort lifetimes and authenticated expected-owner headers fence late results. A 390-pixel phone view has no identity-panel horizontal overflow, 16-pixel inputs and 44-pixel actions. Normal New beta release → Update activates the final unique-name form in a separate review tab, leaving the human editor and private setup form untouched. Final complete source check passes 1,722 tests, zero failures and one optional Docker skip; strict types/build pass. The extra recovery regression proves an outage can recover using the saved vault key without another signup/import.

**Beta delivery:** isolated Worker `882cd697-f75a-43ba-82ab-9e535ded1814`, editor revision `restyle-editor-shell-c1021d5642ba0912`. Exact HTTPS and local4173 HTML/service-worker/release bytes match. Older hashed assets and all original outputs are preserved; source generated output is restored. Production version inventory is unchanged. Real identities are awaiting creator setup/ownership verification and 5E.01; no downstream signup or Container identity operation is claimed.

**GitHub checkpoint:** source/docs `c603686` pushed on `codex/restyle-agent-identity`, [draft PR #111](https://github.com/jaffakakes/pvo-prototype/pull/111) stacked against prerequisite PR #110. Both stay unmerged. The continuation branch contains all prerequisite beta source, so another machine can fetch/checkout it; secrets remain outside Git.

## Exact continuation after private setup

Start **5B.01** beside the existing task/connection owner, not inside the identity lifecycle manager. Save one owner/task/service setup attempt before dispatch, with its selected identity connection/revision, operation ID, expected sender, exact recipient and expiry. Codes, verification links, browser session cookies and acquired keys stay encrypted outside task/model logs. Read only the saved resource through the fixed provider API; unrelated, stale or ambiguous messages cannot satisfy an attempt. Task cancellation, connection replacement and owner changes fence consumption and late results. A code is handed only to the trusted named signup operation, not returned as a general-purpose inbox/model tool.

Then **5C.01** needs a verified execution path for the current requested service: a participating AgentID app still returns a single-use sign-in credential, and a trusted browser/app API must finish signup and capture its ordinary API key. Select the first real supported service from the creator's request and current evidence; do not make the earlier Resend example a universal requirement. Inspect actual key permissions after identity connection (`app_connect` is separate). Define human agreement/payment/CAPTCHA steps truthfully. Browser execution must be disposable, with saved encrypted session state and fixed credential destinations; no permanent creator VM or keys in the development workshop. Implement a concrete supported path with independent failure/restart tests before calling generic account signup available. Current source has no browser-execution binding or account-onboarding consumer yet.

## Private verification infrastructure checkpoint

**5B.01 remains unchecked:** nine controlled cases prove the new [verification workflow](../../../server/account-onboarding/verification.js), [matching rules](../../../server/account-onboarding/verificationRules.js), [private provider reads](../../../server/account-onboarding/messages.js) and [encrypted journal](../../../server/account-onboarding/verificationStore.js). It is attached to the existing task owner's cancellation, credential-change and expiry maintenance. A trusted consumer receives a literal code once; its uncertain response is retained for named-service lookup rather than re-submission. Restart/new claims continue the same saved task and operation. Baseline, sender, sole recipient, subject, time, inbound SMS and ambiguity checks pass; disconnecting a completed email identity preserves a separate later phone verification; codes never enter task/model history. Read metadata first and fetch only matching email bodies. Partial provider pages fail conservatively.

No production route accepts a verification policy or provides general inbox access. Only fixture signup consumers exist. The actual 5C named-service runner, verification waiting presentation, magic-link/session handling, uncertain-result lookup and normal builder/Container use are still required. Therefore this tested infrastructure is not automatic third-party signup or live provider acceptance. Full source/types/build checks and delivery for this batch are recorded in current progress.
