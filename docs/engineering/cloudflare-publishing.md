# Cloudflare product hosting and publishing

The product deploys from `dist/` through [wrangler.jsonc](../../wrangler.jsonc) and [server/index.js](../../server/index.js). The editor remains at `/editor/`; `/` opens its camera home. The separate PVO documentation and demo are excluded from product output. Static assets are served directly; API/media requests and unpublished-page templates go through explicit Worker routes. A missing `/player/{id}` asset falls through to the Worker and is resolved from D1, without a general SPA fallback.

The checked-in configuration leaves `PUBLISHING_ENABLED=false`. The user has deferred login and sign-up decisions; the Google adapter below is provisional and must not be treated as an approved final account experience. Local recording, export, download and native file sharing remain usable. `/api/publishing` reports `available:false` until publishing is enabled, R2 and D1 are bound, the exact HTTPS `PUBLIC_ORIGIN` matches the request, and the current adapter's Google credentials plus a session secret are configured. No development login or password bypass is deployed.

## Live beta release notifications

`server/worker.js` exports the request handler and the SQLite-backed `ReleaseChannel` Durable Object. The `RELEASES` binding coordinates the beta channel through hibernating WebSockets at `/api/releases/connect`. Each connection receives the persisted release ID; successful announcements broadcast to existing connections. The editor reconnects with backoff after disconnection and when returning online or visible. There is no periodic release check or polling fallback. Browser-managed service-worker checks on navigation still apply.

`npm run deploy` builds the application, then runs `scripts/build/deploy.mjs`. The script provisions an announcement secret through Wrangler's additive `--secrets-file`, deploys, waits for Cloudflare's asset manifest to serve the expected `/editor/release.json`, requires hosted editing, frame-inspection and transcription capabilities from `/api/assistant/status`, exercises one bounded `/api/assistant/turn`, and only then calls `/api/releases/announce`. Release and announcement propagation use bounded retries; authorization failures still fail immediately. The endpoint requires the secret and rejects revisions that do not match deployed assets. The generated secret remains in ignored `.wrangler/release-secrets.json`; CI can supply `RELEASE_NOTIFY_TOKEN`. Never place it in browser code. Use this deployment command rather than a dashboard-only upload so connected clients receive the release event. A failed assistant preflight or announcement makes the command fail even if deployment succeeded. The preflight leaves the uploaded assets in place but does not broadcast the release; rerunning the deployment command safely verifies and re-announces it.

The release ID comes from the existing service-worker content hash. The editor checks for a worker update on a valid release event, downloads it, and retains the existing **New beta release** / **Update** flow. It saves the project before activation and does not interrupt recording. Sleeping or disconnected editors receive the latest release when reconnecting. The native-assistant cutover intentionally has no adapter for the retired `/api/assistant` route. A tab still running the pre-cutover editor can therefore receive an assistant failure until its user accepts **New beta release**; retained static assets do not retain removed server routes.

The local beta server uses `scripts/dev/releases.mjs` to provide the same protocol. When publishing staged output locally, copy assets first, HTML and `sw.js` next, and `editor/release.json` last; the file watcher broadcasts that final revision. Retain old hashed assets for open clients and back up generated output before replacement. Restart a running local server once when introducing the WebSocket route; this does not reload editor tabs.

`node --test tests/release-channel.test.mjs` checks authorization, deployed-asset validation, fan-out, deduplication, and persisted replay after a runtime restart. `npm run check:browser -- editor pwa` checks push delivery without polling, reconnect catch-up, explicit activation, recording protection, saved footage, offline startup, and storage-failure protection.

## Resources and launch configuration

Use one private R2 Standard bucket and one D1 database in the account that owns the Worker. Bind them as `MEDIA` and `DB`. Do not expose the bucket through `r2.dev`. Add the real resource values to Wrangler after provisioning:

```jsonc
"r2_buckets": [
  { "binding": "MEDIA", "bucket_name": "YOUR_PRIVATE_BUCKET" }
],
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "YOUR_DATABASE",
    "database_id": "YOUR_DATABASE_ID",
    "migrations_dir": "migrations"
  }
]
```

Apply `migrations/0001_publishing.sql` with `npx wrangler d1 migrations apply DB --remote` before enabling uploads. The configuration contains no invented resource IDs. Resource provisioning, subscription activation and a real authentication callback are deployment setup, not actions performed by a build or the tests.

Create a Google OAuth **Web application** client. Register this exact redirect URI for the configured production origin:

```text
https://lingering-butterfly-9ba8.jaffakakes28.workers.dev/api/auth/callback
```

Configure the consent screen and its allowed test users while the Google app is in testing. Set `GOOGLE_CLIENT_ID` as a Worker variable, and store `GOOGLE_CLIENT_SECRET` and `SESSION_SECRET` with `npx wrangler secret put NAME`. Generate a random session secret with at least 32 bytes of entropy; do not reuse a provider secret. Never place these secrets in Vite variables, the repository, a static ZIP, or a chat message. Keep `PUBLIC_ORIGIN` equal to the canonical HTTPS origin without a path. Finally set `PUBLISHING_ENABLED=true` and deploy.

Sign-in opens `/api/auth/login` in a separate window. It uses a short-lived signed HttpOnly state cookie, PKCE and an OIDC nonce; the callback exchanges the authorization code server-side and verifies Google's RS256 signature, issuer, audience, expiry, authorized party and nonce using `jose`. Identity uses Google's stable `sub`, not a browser-provided owner ID or an unverified email. The callback posts `{type:"restyle-auth",ok:true}` only to the exact editor origin and closes; its return link is a fallback. The existing editor tab retains the prepared export. Sessions use revocable D1 records and Secure/HttpOnly/SameSite cookies; authenticated writes also require an exact Origin match. See [Google's server flow](https://developers.google.com/identity/openid-connect/openid-connect).

## Stored exports and limits

`POST /api/publications` reserves storage in one D1 statement with a per-owner idempotency key. Defaults are 50 MiB per export, 500 MiB reserved/stored per creator, 5 GiB total, and 20 newly created links per creator per rolling day. Server configuration may reduce these limits; the individual upload maximum never exceeds 50 MiB. Pending and deleting records count toward quota until their storage is removed.

`PUT /api/publications/{id}/content` holds an upload lease, writes a new random object key, and enforces the exact reserved size while streaming through a `FixedLengthStream`. Both sides of the stream settle before failed storage is cleaned up. Verification reads bounded metadata from R2: exported MP4/WebM containers, or a PVO header/manifest/asset index of at most 256 KiB and 512 assets. Container inspection is not codec transcoding or full video decoding. PVO metadata validation uses the SDK's public `inspectPvoProject` API; media is never copied into Worker memory. Existing local PVO compatibility and its larger format limits are unchanged.

A conditional D1 write marks the immutable object ready. A repeated completed request returns the same publication; it never replaces its bytes. Concurrent uploads receive a retryable conflict. A failed upload keeps its pending reservation for retry, and every retry gets a fresh object key. A commit whose response is lost is reconciled before deleting any object.

Owner-scoped listing returns ready links only. Deletion makes new viewer/media requests unavailable immediately, then removes stored objects and releases quota. An active upload is allowed to settle or expire before its attempt is cleaned up. The hourly scheduled handler expires abandoned reservations, retries deletion and scans old unreferenced R2 objects with a persisted cursor. Keep the checked-in cron trigger enabled when publishing is enabled. The handler is a no-op when bindings are absent.

`/media/{id}` streams only ready publications, including byte-range responses for native video seeking. Page and media responses are not publicly cached, so new requests recheck removal. Anyone possessing an unlisted link can watch or forward it. Deletion cannot revoke bytes someone already downloaded. PVO playback still downloads the full package before it starts; moving files to R2 does not add adaptive streaming. Published exports are not editable cloud backups.

## Verification and rollout

Run `node --test tests/publishing-server*.test.mjs` for Google signature/session checks, bounded SDK inspection, and integration tests using real local Miniflare D1/R2/Worker execution. Tests use an isolated HTTPS test origin and test-only sessions, never a deployed login or remote storage. `npm run check` also discovers these tests. The shared SDK suite checks legacy MP4/MOV and current PVO compatibility.

Run `npm run build`, then a Wrangler dry run, before deploying. A static dashboard ZIP cannot provide the publishing API. After the real identity/resources are configured, verify sign-in from the retained export dialog, both video/PVO uploads, a viewer in a separate unauthenticated browser, seeking, idempotent retry, owner isolation and deletion against the deployed hostname. Local tests do not establish that the production Google client, callback or storage bindings work.

R2 storage/operations, D1 and dynamic Worker requests have separate allowances. Static files bypass Worker execution where possible. Monitor usage and retain quotas; this is bounded hosting, not unlimited free video storage. See [Worker limits](https://developers.cloudflare.com/workers/platform/limits/) and [R2 bindings](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).
