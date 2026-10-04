# Server rendering

The browser still owns the editable project. A server render job receives one immutable scene and its **original** media files; it does not publish the result. The editor downloads the private MP4 and may then place it into a normal video download or a PVO scene. The Worker owns session checks, temporary R2 objects, D1 job state, signed Container transfer URLs, and cleanup. The Queue consumer calls the FFmpeg Container. The Container has no R2 or D1 credentials.

## Current availability

With the current `wrangler.jsonc`, `GET /api/renders` reports `available: false` because the render Queue and Container are not declared and `RENDERING_ENABLED` is unset. The code is deliberately dormant until all bindings exist. The local beta uses a separate local FFmpeg adapter for end-to-end testing. Do not interpret a passing Worker dry-run or mocked Container test as a live Cloudflare render.

The Cloudflare service needs the existing D1, R2 and signed account session, plus a [Queue](https://developers.cloudflare.com/queues/get-started/) and a [Container](https://developers.cloudflare.com/containers/get-started/) on a Workers Paid account. Containers are billed for active compute and provisioned resources ([pricing](https://developers.cloudflare.com/containers/platform/pricing/)). Docker or an equivalent build tool must be running to build `server/render/Dockerfile` for deployment. No paid renderer resources have been created or deployed by this change. A read-only account check on 4 October 2026 confirmed no Queues and no `RENDERER` / `RENDER_QUEUE` Worker bindings; the Containers API rejected access because the account needs the Workers Paid plan. The production D1 database already records `0002_render_jobs.sql` and contains both render tables.

## API and bounds

The editor requires a verified account before export, then uses the same origin and PVO account cookie for all render operations. `GET /api/auth/session` reports whether the account session is available; rendering requests require it even when a project could otherwise fall back to browser rendering.

| Request | Purpose |
| --- | --- |
| `GET /api/renders` | Capability and source limits; safe while unavailable. |
| `POST /api/renders` | `{source, assets:[{id,bytes,contentType}]}` for one scene; returns an account-scoped job ID. Each clip/audio clip `url` is a declared asset ID, never a remote URL. Unsupported effects fail before upload. |
| `PUT /api/renders/:id/sources/:assetId` | Exact original file bytes. |
| `POST /api/renders/:id/start` | Queue the job after every source is uploaded. |
| `GET /api/renders/:id` | `uploading`, `queued`, `rendering`, `ready`, `failed`, or `cancelled`, plus progress and a result URL when ready. |
| `GET /api/renders/:id/result` | Cookie-protected MP4 download. |
| `DELETE /api/renders/:id` | Cancel and remove private media; the editor calls this after downloading the Blob too. |

The current remote limit is 50 MiB per original asset, 16 assets, 250 MiB total, and 120 seconds per scene. It permits two active jobs and 20 jobs per account per day. Visible text overlays (including downloaded fonts), baked video animation, non-default audio gains, gain curves and selected soundtrack synthesis use the browser renderer until there is a faithful FFmpeg implementation. Eligibility is checked before requests, and the Worker and renderer reject unsupported effects before stripping private authored data. PVO exports keep native text/fonts and visual motion in their package; their explicitly plain scene media may use FFmpeg when the audio mix is supported. Hidden text and interactive components retain only timing and layer IDs in the server job; captions, component fields, and code are neither stored nor burned into the MP4. Their timing still affects the scene duration. Any unsupported or unavailable server operation must fall back to the browser renderer; it must not silently omit an authored effect.

Original files and results live under private `renders/` keys in the existing R2 `MEDIA` bucket. The Container can only fetch or upload through short-lived HMAC-scoped Worker URLs. Status/result routes require the account session. Cancelled jobs are cleaned immediately where possible; the scheduled cleanup removes cancelled or expired jobs and media, and marks stalled renders failed. Jobs expire after 24 hours. Once source upload or rendering has begun, failures are shown to the creator for an explicit retry; the editor only falls back to browser rendering before a server job starts.

## Cloudflare wiring when ready to deploy

1. Verify `migrations/0002_render_jobs.sql` is applied to the target D1 database (it is already applied in current production) and create one Queue, for example `restyle-renders`. Verify the Cloudflare account has Containers enabled and build the FFmpeg image from `server/render/Dockerfile` on a machine with Docker running.
2. Add a `RENDERER` Durable Object binding for the exported `RenderContainer` class in `server/worker.js`, a Container image entry pointing to that Dockerfile, and a new SQLite class migration tag. The existing Wrangler file uses `migrations`; [Cloudflare says not to combine it with the newer `exports` declaration](https://developers.cloudflare.com/containers/get-started/). Choose a Container [instance size](https://developers.cloudflare.com/containers/platform/limits/) after measuring 1080p memory, disk and render time.
3. Bind the Queue as producer `RENDER_QUEUE` and as consumer of the same Worker, with `max_batch_size: 1` and `max_concurrency: 1` for the first deployment. A [Queue consumer has a 15-minute wall-clock limit](https://developers.cloudflare.com/queues/platform/limits/); the API's 120-second scene cap leaves room for startup, source transfer and encoding.
4. Deploy with `RENDERING_ENABLED` absent or false, confirm the Container is healthy in Cloudflare's Container dashboard and logs, then enable the flag and verify a real account-scoped upload, render, MP4 download and cancellation. Cloudflare [deploys Worker code and Container rollout separately](https://developers.cloudflare.com/containers/guides/deploy/), so keep the capability off until the image is healthy.

Do not put original footage or signed transfer URLs into logs. Before enabling a public service, exercise a real 1080p HLG source, a recorded camera clip, mixed/extracted audio, cancellation during upload and render, and the container's CPU/memory/disk limits. The local FFmpeg comparison shows more deterministic duration, but the production HDR path still needs that final visual check.
