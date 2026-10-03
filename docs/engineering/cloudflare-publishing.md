# Cloudflare product hosting and publishing

The product deploys from `dist/` through [wrangler.jsonc](../../wrangler.jsonc) and [server/index.js](../../server/index.js). The editor remains at `/editor/`; `/` opens its camera home. The separate PVO documentation and demo are excluded from product output. Static assets are served directly; API/media requests and unpublished-page templates go through explicit Worker routes. A missing `/player/{id}` asset falls through to the Worker and is resolved from D1, without a general SPA fallback.

Create link publishes the completed export without a login or account. The browser receives a signed session cookie only when the creator explicitly chooses Create link. Local recording, export, download and native file sharing remain usable independently. `GET /api/publishing` returns `{available, hasSession, maxBytes}` and creates no session. Availability requires `PUBLISHING_ENABLED=true`, the R2 and D1 bindings, an exact HTTPS `PUBLIC_ORIGIN` matching the request, and `SESSION_SECRET`. No OAuth credentials are required.

## Live beta release notifications

`server/worker.js` exports the request handler and the SQLite-backed `ReleaseChannel` Durable Object. The `RELEASES` binding coordinates the beta channel through hibernating WebSockets at `/api/releases/connect`. Each connection receives the persisted release ID; successful announcements broadcast to existing connections. The editor reconnects with backoff after disconnection and when returning online or visible. There is no periodic release check or polling fallback. Browser-managed service-worker checks on navigation still apply.

`npm run deploy` builds the application, then runs `scripts/build/deploy.mjs`. The script provisions an announcement secret through Wrangler's additive `--secrets-file`, deploys, waits for Cloudflare's asset manifest to serve the expected `/editor/release.json`, requires hosted editing, frame-inspection and transcription capabilities from `/api/assistant/status`, exercises one bounded `/api/assistant/turn`, and only then calls `/api/releases/announce`. Release and announcement propagation use bounded retries; authorization failures still fail immediately. The endpoint requires the secret and rejects revisions that do not match deployed assets. The generated secret remains in ignored `.wrangler/release-secrets.json`; CI can supply `RELEASE_NOTIFY_TOKEN`. Never place it in browser code. Use this deployment command rather than a dashboard-only upload so connected clients receive the release event. A failed assistant preflight or announcement makes the command fail even if deployment succeeded. The preflight leaves the uploaded assets in place but does not broadcast the release; rerunning the deployment command safely verifies and re-announces it.

The release ID comes from the existing service-worker content hash. The editor checks for a worker update on a valid release event, downloads it, and retains the existing **New beta release** / **Update** flow. It saves the project before activation and does not interrupt recording. Sleeping or disconnected editors receive the latest release when reconnecting. The native-assistant cutover intentionally has no adapter for the retired `/api/assistant` route. A tab still running the pre-cutover editor can therefore receive an assistant failure until its user accepts **New beta release**; retained static assets do not retain removed server routes.

The local beta server uses `scripts/dev/releases.mjs` to provide the same protocol. When publishing staged output locally, copy assets first, HTML and `sw.js` next, and `editor/release.json` last; the file watcher broadcasts that final revision. Retain old hashed assets for open clients and back up generated output before replacement. Restart a running local server once when introducing the WebSocket route; this does not reload editor tabs.

`node --test tests/release-channel.test.mjs` checks authorization, deployed-asset validation, fan-out, deduplication, and persisted replay after a runtime restart. `npm run check:browser -- editor pwa` checks push delivery without polling, reconnect catch-up, explicit activation, recording protection, saved footage, offline startup, and storage-failure protection.

## Resources and launch configuration

The production Worker uses the private R2 Standard bucket `pvo-publications-media` and D1 database `pvo-publications`, bound as `MEDIA` and `DB`. The resources are provisioned in the Worker's account and recorded in Wrangler. Keep public bucket access through `r2.dev` disabled:

```jsonc
"r2_buckets": [
  { "binding": "MEDIA", "bucket_name": "pvo-publications-media" }
],
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "pvo-publications",
    "database_id": "068e7e39-9730-4a2d-827c-97c9b2e227f3",
    "migrations_dir": "migrations"
  }
]
```

Apply the current initial schema, `migrations/0001_publishing.sql`, with `npx wrangler d1 migrations apply DB --remote` before enabling uploads. It stores browser owners and sessions; it does not store an external identity provider or require an account callback. Resource provisioning and remote schema application are deployment setup, not actions performed by a build or the tests.

Store `SESSION_SECRET` with `npx wrangler secret put SESSION_SECRET`. Generate a random secret with at least 32 bytes of entropy. Never place it in Vite variables, the repository, a static ZIP, or a chat message. Keep `PUBLIC_ORIGIN` equal to the canonical HTTPS origin without a path, set `PUBLISHING_ENABLED=true`, and deploy.

`POST /api/publishing/session` creates a random browser owner and a 180-day session or reuses a valid existing session. The server signs the HttpOnly, Secure, SameSite cookie and records its session in D1; the browser cannot choose its owner ID. Session creation and publication writes require the exact configured Origin. Reading availability or opening the editor does not create an owner or session. The same browser can list and delete its published exports without a sign-in popup.

Ownership belongs to that browser session, not a cross-device account. Clearing cookies or reaching the session expiry loses access to its management and deletion controls. Existing public links continue working; a new session cannot recover the previous owner's publications. Per-owner quotas therefore limit one browser owner, not a verified person; the total storage quota remains a separate deployment-wide limit.

## Stored exports and limits

`POST /api/publications` reserves storage in one D1 statement with a per-owner idempotency key. Defaults are 50 MiB per export, 500 MiB reserved/stored per browser owner, 5 GiB total, and 20 newly created links per browser owner per rolling day. Server configuration may reduce these limits; the individual upload maximum never exceeds 50 MiB. Pending and deleting records count toward quota until their storage is removed.

`PUT /api/publications/{id}/content` holds an upload lease, writes a new random object key, and enforces the exact reserved size while streaming through a `FixedLengthStream`. Both sides of the stream settle before failed storage is cleaned up. Verification reads bounded metadata from R2: exported MP4/WebM containers, or a PVO header/manifest/asset index of at most 256 KiB and 512 assets. Container inspection is not codec transcoding or full video decoding. PVO metadata validation uses the SDK's public `inspectPvoProject` API; media is never copied into Worker memory. Existing local PVO compatibility and its larger format limits are unchanged.

A conditional D1 write marks the immutable object ready. A repeated completed request returns the same publication; it never replaces its bytes. Concurrent uploads receive a retryable conflict. A failed upload keeps its pending reservation for retry, and every retry gets a fresh object key. A commit whose response is lost is reconciled before deleting any object.

Owner-scoped listing returns ready links only. Deletion makes new viewer/media requests unavailable immediately, then removes stored objects and releases quota. An active upload is allowed to settle or expire before its attempt is cleaned up. The hourly scheduled handler expires abandoned reservations, retries deletion and scans old unreferenced R2 objects with a persisted cursor. Keep the checked-in cron trigger enabled when publishing is enabled. The handler is a no-op when bindings are absent.

`/media/{id}` streams only ready publications, including byte-range responses for native video seeking. Page and media responses are not publicly cached, so new requests recheck removal. Anyone possessing an unlisted link can watch or forward it. Deletion cannot revoke bytes someone already downloaded. PVO playback still downloads the full package before it starts; moving files to R2 does not add adaptive streaming. Published exports are not editable cloud backups.

## Verification and rollout

Run `node --test tests/publishing-server*.test.mjs` for signed browser-session and origin checks, bounded SDK inspection, and integration tests using real local Miniflare D1/R2/Worker execution. Tests use an isolated HTTPS test origin and local storage, not remote publishing resources. `npm run check` also discovers these tests. The shared SDK suite checks legacy MP4/MOV and current PVO compatibility.

Run `npm run build`, then a Wrangler dry run, before deploying. A static dashboard ZIP cannot provide the publishing API. After configuring the resources and secret, verify Create link from the retained export dialog without sign-in, both video/PVO uploads, a viewer in a separate browser without a publishing session, seeking, idempotent retry, owner isolation and deletion against the deployed hostname. Verify that availability reads create no session and explicit link creation does. Local tests do not establish that production storage bindings or the deployed session configuration work.

R2 storage/operations, D1 and dynamic Worker requests have separate allowances. Static files bypass Worker execution where possible. Monitor usage and retain quotas; this is bounded hosting, not unlimited free video storage. See [Worker limits](https://developers.cloudflare.com/workers/platform/limits/) and [R2 bindings](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).
