# Cloudflare product hosting and publishing

The product deploys from `dist/` through [wrangler.jsonc](../../wrangler.jsonc) and [server/index.js](../../server/index.js). The editor remains at `/editor/`; `/` opens its responsive home. Public [About](../../public/about.html), [Privacy](../../public/privacy.html) and [Terms](../../public/terms.html) pages are copied to the product root. The separate PVO documentation and demo are excluded. Static assets are served directly; API/media requests and published-player templates go through explicit Worker routes. A missing `/player/{id}` asset falls through to the Worker and is resolved from D1, without a general SPA fallback.

Recording and editing are available without an account. Export, download and Create link require a Restyle account. Both Google and email/password use the existing Stickr Supabase project. The editor retains its local project and export settings during sign-in. `GET /api/auth/session` reports availability, public project metadata and the current Restyle user without creating a session. The Restyle server no longer owns a Google OAuth client or a separate provider-linking API. See [accounts and storage](accounts-and-storage.md) for the exact fields and database model.

## Live beta release notifications

`server/worker.js` exports the request handler and the SQLite-backed `ReleaseChannel` Durable Object. The `RELEASES` binding coordinates the beta channel through hibernating WebSockets at `/api/releases/connect`. Each connection receives the persisted release ID; successful announcements broadcast to existing connections. The editor reconnects with backoff after disconnection and when returning online or visible. There is no periodic release check or polling fallback. Browser-managed service-worker checks on navigation still apply.

`npm run deploy` builds the application, then runs `scripts/build/deploy.mjs`. The script provisions an announcement secret through Wrangler's additive `--secrets-file`, deploys, waits for Cloudflare's asset manifest to serve the expected `/editor/release.json`, requires hosted editing, frame-inspection and transcription capabilities from `/api/assistant/status`, exercises one bounded `/api/assistant/turn`, and only then calls `/api/releases/announce`. Release and announcement propagation use bounded retries; authorization failures still fail immediately. The endpoint requires the secret and rejects revisions that do not match deployed assets. The generated secret remains in ignored `.wrangler/release-secrets.json`; CI can supply `RELEASE_NOTIFY_TOKEN`. Never place it in browser code. Use this deployment command rather than a dashboard-only upload so connected clients receive the release event. A failed assistant preflight or announcement makes the command fail even if deployment succeeded. The preflight leaves the uploaded assets in place but does not broadcast the release; rerunning the deployment command safely verifies and re-announces it.

The release ID comes from the existing service-worker content hash. The editor checks for a worker update on a valid release event, downloads it, and retains the existing **New beta release** / **Update** flow. It saves the project before activation and does not interrupt recording. Sleeping or disconnected editors receive the latest release when reconnecting. The native-assistant cutover intentionally has no adapter for the retired `/api/assistant` route. A tab still running the pre-cutover editor can therefore receive an assistant failure until its user accepts **New beta release**; retained static assets do not retain removed server routes.

The local beta server uses `scripts/dev/releases.mjs` to provide the same protocol. When publishing staged output locally, copy assets first, HTML and `sw.js` next, and `editor/release.json` last; the file watcher broadcasts that final revision. Retain old hashed assets for open clients and back up generated output before replacement. Restart a running local server once when introducing the WebSocket route; this does not reload editor tabs.

`node --test tests/release-channel.test.mjs` checks authorization, deployed-asset validation, fan-out, deduplication, and persisted replay after a runtime restart. `npm run check:browser -- editor pwa` checks push delivery without polling, reconnect catch-up, explicit activation, recording protection, saved footage, offline startup, and storage-failure protection.

## Resources and launch configuration

The configured Worker uses the private R2 Standard bucket `pvo-publications-media` and D1 database `pvo-publications-google`, bound as `MEDIA` and `DB`. The resources are provisioned in the Worker's account and recorded in Wrangler. Keep public bucket access through `r2.dev` disabled:

```jsonc
"r2_buckets": [
  { "binding": "MEDIA", "bucket_name": "pvo-publications-media" }
],
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "pvo-publications-google",
    "database_id": "46ed24c3-1bc3-487a-95cf-7b6b58c1db88",
    "migrations_dir": "migrations"
  }
]
```

Apply the checked-in D1 migrations with `npx wrangler d1 migrations apply DB --remote` before enabling sign-in or uploads. In particular, apply [migration 0004](../../migrations/0004_supabase_identities.sql) before deploying a Worker whose signed-in session route queries `supabase_identities`; otherwise account checks fail. Apply [migration 0005](../../migrations/0005_multipart_uploads.sql) before deploying multipart routes; it adds the R2 upload ID to upload attempts. The new Supabase identity schema has not been applied to production by this task. Do not treat the former Clerk migration history as proof of its presence. Migration 0005 has not been verified there. The [initial schema](../../migrations/0001_publishing.sql) stores users, hashed account sessions, publications and upload attempts. Resource provisioning and remote schema application are deployment setup, not actions performed by a build or the tests.

| Store | Data |
| --- | --- |
| Cloudflare D1 `users` | Restyle user ID, display label, creation time. Google supplies a name; email accounts start with the generic label “Creator”. |
| D1 `supabase_identities` | Supabase issuer and user subject mapped to one Restyle user; no email or password. |
| D1 `sessions` | Hash of a random Restyle session token, user ID and expiry. The raw token stays in an HttpOnly cookie. |
| D1 publishing tables | Publication metadata, ownership, upload attempts and quotas. |
| Private Cloudflare R2 | Bytes of published video/PVO exports. |
| Browser IndexedDB | Editable draft projects and source media on that device. |
| Supabase | Email identifiers, passwords, verification, password reset and its own session records. |

Supabase owns verified provider linking; Restyle maps only the resulting Supabase UUID. It never merges D1 accounts by comparing email strings. Both sign-in methods use the same `supabase_identities` table. Historical direct-Google and Clerk records are not read, transferred or deleted by this change.

The feature schemas [`0002_render_jobs.sql`](../../migrations/0002_render_jobs.sql) and [`0003_reply_boxes.sql`](../../migrations/0003_reply_boxes.sql) add private render jobs and account-owned reply boxes. A read-only check on 4 October 2026 confirmed both are already applied to the configured production database. Fresh deployments must apply all current migrations before the Worker serves reply routes or runs scheduled cleanup. Rendering remains unavailable until its additional Queue and Container resources are configured; see [server rendering](server-rendering.md).

Store `SESSION_SECRET` as a Worker secret with at least 32 bytes of entropy. Google provider credentials stay in the existing Stickr Supabase project's provider configuration; never ship them in Vite variables, source or static assets. Restyle needs no separate Google client ID/secret.

For Supabase, set `SUPABASE_URL` to the existing Stickr project's HTTPS origin and `SUPABASE_PUBLISHABLE_KEY` to its `sb_publishable_…` key in the deployment environment. Keep project configuration outside tracked source. No service-role or secret API key is needed. The Worker verifies ES256/RS256 signatures at `/auth/v1/.well-known/jwks.json`, exact issuer and authenticated audience/role, expiration, non-anonymous user and session UUIDs. It then calls `/auth/v1/user` with the same user token and public key to check the current confirmed email. Neither request follows redirects. Passwords travel directly from the browser to Supabase; Restyle does not store them. See [Supabase signing keys](https://supabase.com/docs/guides/auth/signing-keys) and [password authentication](https://supabase.com/docs/guides/auth/passwords).

The browser uses Supabase's SDK with PKCE and a Restyle-specific storage key. Register the exact callback URLs `/editor/?auth=confirm`, `/editor/?auth=recovery` and `/editor/?auth=google` for each enabled origin in Supabase's redirect allowlist, including `http://127.0.0.1:4173` for the beta. Keep existing Stickr native/Studio callbacks and provider settings. Email links must open in the browser that requested them. Existing provider sessions require explicit review before opening a Restyle account; password recovery opens the new-password form before sign-in. `GET /api/auth/session` exposes `supabaseAvailable`, `supabaseUrl` and `supabasePublishableKey` alongside the Google/account fields.

The current schema is [`0004_supabase_identities.sql`](../../migrations/0004_supabase_identities.sql), which creates a separate `supabase_identities` table. Apply it and configure the selected project's public metadata before promoting the Worker. Old Clerk records are not read, migrated or deleted. Existing Clerk passwords do not become Supabase passwords. New Google and email sign-ins use only the verified Supabase user mapping. Existing direct-Google identities are not migrated by this change. No live database is changed by a local build.

The owned `getrestyle.app` Cloudflare zone is active and its Search Console **Domain property** has been verified with Google's DNS TXT record. Keep that TXT record to retain ownership verification. `getrestyle.app` is in Google Auth Platform Branding's authorized domains. After deployment, verify that the Worker serves the approved [homepage](https://getrestyle.app/about.html), [privacy policy](https://getrestyle.app/privacy.html) and [terms](https://getrestyle.app/terms.html) over HTTPS. These exact URLs are set in Branding, and the homepage links both policy pages. Cloudflare Email Routing forwards `support@getrestyle.app` to the verified private contact inbox. The former `workers.dev` address may continue to serve old public viewing links, but the new OAuth callback and public brand use `getrestyle.app`. See [Google's domain verification steps](https://support.google.com/cloud/answer/13804266?hl=en), [OAuth policy](https://developers.google.com/identity/protocols/oauth2/policies) and [Branding requirements](https://support.google.com/cloud/answer/13464321?hl=en).

`POST /api/auth/supabase/exchange` accepts a Supabase access token in the Bearer header and issues an HttpOnly, Secure, SameSite=Lax Restyle session after verification. Both Google and email sessions last 15 minutes. The Worker stores only the random token's hash. `POST /api/auth/logout` revokes it. Supabase browser sessions use a Restyle-specific storage key and logout also clears the local provider session. No Google provider token is requested for application API access. A revoked provider session can leave its last Restyle cookie valid for at most 15 minutes. Signing out does not delete published links.

## Stored exports and limits

`POST /api/publications` reserves a publication with an account-scoped idempotency key. There is no Restyle account or site storage quota. The existing limit of 20 newly created links per account per rolling day remains. A new session for the same Supabase user does not reset that limit. The maximum single file reported by `/api/publishing` is 625 GiB, determined by this Worker's 64 MiB maximum part size and R2's 10,000-part limit; actual browser and network capacity may be lower.

New interactive exports create a link as part of export. Files up to 50 MiB use `PUT /api/publications/{id}/content`, which holds an upload lease, writes a new random object key, and enforces the exact reserved size while streaming through a `FixedLengthStream`. Larger files call `POST /api/publications/{id}/multipart`, upload numbered parts with `PUT /api/publications/{id}/multipart/{number}`, then submit the returned ETags to `PUT /api/publications/{id}/multipart/complete`. Parts range from 8 to 64 MiB so each Worker request stays below the inbound request limit, and the final part may be smaller. A renewable lease protects the pending upload; deletion or scheduled cleanup aborts unfinished multipart attempts. Verification reads bounded metadata from R2: exported MP4/WebM containers, or a PVO header/manifest/asset index of at most 256 KiB and 512 assets. Container inspection is not codec transcoding or full video decoding. PVO metadata validation uses the SDK's public `inspectPvoProject` API; no whole PVO is copied into Worker memory.

After its media upload is ready, a publication may receive one immutable WebP or PNG cover through `PUT /api/publications/{id}/poster`. The authenticated upload is bounded to 5 MiB and uses a deterministic private `posters/` key. `/poster/{id}` checks that the publication remains ready before serving the cover. Published pages expose the cover to the viewer and link-preview metadata; publication deletion removes it, and orphan cleanup handles a deletion racing an upload. Posters must route through the Worker, like media.

A conditional D1 write marks the immutable object ready. A repeated completed request returns the same publication; it never replaces its bytes. Concurrent uploads receive a retryable conflict. A failed upload keeps its pending reservation for retry, and every retry gets a fresh object key. A commit whose response is lost is reconciled before deleting any object.

Account-scoped listing returns ready links only. Deletion makes new viewer/media requests unavailable immediately, then removes stored objects and releases quota. An active upload is allowed to settle or expire before its attempt is cleaned up. The hourly scheduled handler expires account sessions and abandoned reservations, retries deletion and scans old unreferenced R2 objects with a persisted cursor. Keep the checked-in cron trigger enabled when publishing is enabled. Cleanup for a missing binding is a no-op for that resource.

`/media/{id}` streams only ready publications, including byte-range responses for native video seeking. Page and media responses are not publicly cached, so new requests recheck removal. Anyone possessing an unlisted link can watch or forward it. Deletion cannot revoke bytes someone already downloaded. PVO playback still downloads the full package before it starts; moving files to R2 does not add adaptive streaming. Published exports are not editable cloud backups.

## Collect replies

In Form Action, **Collect replies** creates an account-owned reply box through `POST /api/reply-boxes` and stores its public submission URL in the Form. The generated PVO request sends an ordered array of field names, types and answers to `POST /api/reply-boxes/{id}/replies`. The viewer needs no account; the public endpoint accepts cross-origin JSON so downloaded `.pvo` files can submit from another player. **Try** simulates success and never writes to the inbox.

The creator reads boxes through `GET /api/reply-boxes`, reads one box through `GET /api/reply-boxes/{id}/replies`, and deletes it through `DELETE /api/reply-boxes/{id}`. Owner operations require the account session. Deleting a box removes its saved replies and rejects future submissions from every video copy using that URL. Viewer answers are untrusted text and are displayed as text. Each box expires 180 days after creation; scheduled cleanup removes the box and its replies. A box holds up to 1,000 replies, with 200 per rolling day and 30 per rolling minute. The server accepts one to five bounded answers and at most 20 active boxes per account. It stores only a keyed hash of a trusted viewer IP for the additional per-source limit, never the raw address.

The local beta server has a disk-backed loopback adapter for this API. It keeps reply boxes in private ignored data and identifies the owner by a signed local browser cookie. That local inbox cannot be recovered from a different browser or after its site data is cleared. It does not stand in for the deployed account-backed API.

## Local account adapter

The loopback beta keeps private account/session records under `PVO_LOCAL_DATA_DIR`. When an explicit private Supabase project configuration is present, `/api/auth/supabase/exchange` verifies the project issuer, signature, audience, role, expiration and confirmed current user before issuing a local account cookie. Local account sessions last 15 minutes. Both sign-in methods use the revocable `pvo-local-session` account cookie for rendering. Reply-box previews retain their separately documented local browser-cookie ownership.

Put `{ "url": "https://<project>.supabase.co", "publishableKey": "sb_publishable_…" }` in `<PVO_LOCAL_DATA_DIR>/supabase.json` with mode `0600`, or set both `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. Use the existing Stickr project's public metadata; never put a secret or service-role key here. Restart after changing this configuration. The same Supabase UUID maps to the same local account regardless of Google or email sign-in.

## Verification and rollout

`npm run check` checks syntax, declared dependency boundaries, adopted formatting and all Node tests. `npm run check:editor` checks TypeScript. Account coverage includes signed Supabase users, session revocation, exact origins, account isolation, read-only status and rejection of unconfirmed users. The former direct-Google and manual linking routes are absent. Run `npm run build` and `npm run check:browser -- editor auth-popup google-account-gate email-recovery` for desktop/phone signup, Google/email export resumption, PKCE callbacks, recovery, sign-out and cancellation. Browser fixtures exercise the real SDK with isolated Auth responses; they do not prove live consent or email delivery.

Before production, apply the current Supabase identity schema, supply the project's public metadata, allow the exact HTTPS production callbacks, and promote through dev → preprod → prod. Verify a real Google consent/token exchange and email login/recovery on the deployment origin, plus publication ownership and viewing. Production deployment and existing-user migration have not been performed by this task.
