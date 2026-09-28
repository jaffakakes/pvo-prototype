# Mobile camera home, export and sharing

Accepted product behavior, implemented on 27 September 2026. Product deployment separation, mobile camera home, export/download/Share, published viewers and the Worker backend are implemented. The user has deferred login and sign-up decisions. Online links remain disabled; the current Google adapter is provisional, and production storage is not configured. See the [Cloudflare setup](cloudflare-publishing.md). Follow the existing [architecture](architecture.md), [coding standard](coding-standards.md) and [notification policy](notification-policy.md).

## Product behavior

On mobile, opening the site's home address opens the camera. The creator records or imports footage, then continues into editing. Restore saved draft data without replacing the camera home with an empty editor or discarding existing work; provide a way to continue editing that draft. Camera permission denial must leave import and recovery usable.

The product will become responsive, but a desktop-specific home is deferred for the user to define later. Preserve current usable behavior on larger screens for now; do not invent a desktop dashboard or change the active recording/editing screen when the viewport resizes. A shared `/player/{id}` link always opens that video on both mobile and desktop, regardless of home behavior.

Remove the demo and PVO documentation from this product's deployment and navigation. There is no `/demo/` or `/docs/` product page. The PVO documentation is a separate site; preserve its source and test fixtures in the repository, but do not copy them or the demo's media into this application's deployment.

People can record, edit, export and download locally without signing in. The user prefers creator accounts for managing online uploads but will decide login and sign-up later. The disabled backend currently uses a Google adapter; its provider and account experience are not final product decisions. When enabled, sign-in belongs only to creating or managing online links after the export/download flow. Viewers need no account. First-release links are unlisted: anyone who receives a link can watch and forward it. They are not private, authenticated viewing links.

The primary flow is **Camera → Create/edit → Export → Download → optional Share dialog**. Export prepares the chosen video or `.pvo` file and initiates its download. Then the app offers the Share dialog. Uploading is optional and starts only when the creator chooses Create link; sharing and authentication never block a local export.

Share operates on the exact completed export. A flat video stays flat; an interactive `.pvo` keeps its exported interactions and scenes. Do not render again, silently change formats or use later editor changes when sharing an already exported result. Never share a local `blob:` URL as a public link or imply that copying the editor address shares a draft.

## Routes

| Address | Behavior |
| --- | --- |
| `/` | Mobile camera home. Initially redirect into the existing `/editor/` application to preserve its installed-app scope and asset paths, while selecting the camera on home entry. Desktop home design is deferred. |
| `/editor/` | Existing application entry for the camera → edit → export → share flow. Preserve draft recovery and ongoing sessions. |
| `/player/{id}` | Opens one published video. Unknown or removed IDs show a clear unavailable page with an appropriate HTTP status. |
| `/player/` | Existing standalone player for opening a local `.pvo`; do not offer a public sharing link for an unpublished file. |
| `/demo/`, `/docs/` | Not deployed on this product; return a real not-found response. |
| `/api/*` | Authentication, publication management and upload operations. Never fall back to editor HTML. |
| `/media/{id}` | Same-origin read of the published export, with verified video or PVO content type. |

Generate opaque, cryptographically random publication IDs on the server, with at least 128 bits of randomness. Do not reuse editor scene IDs or encode video data in the URL. `/player/{id}` is the canonical link; query-string source URLs remain a compatibility feature, not the publishing API.

Moving the application itself to `/` can follow separately if a root-only address is desired. That requires an intentional service-worker and installed-app migration; it is unnecessary to make the mobile home address open the camera now. A home entry selects the camera without clearing recovered project data or interrupting an already active session.

## Export and Share flow

1. The creator chooses Export and the desired format/quality. Capture a stable project snapshot and validate the required clips and, for interactive export, scene destinations. Show rendering progress. Current rendering runs in real time; an interactive export may take the combined duration of its scenes.
2. Retain the completed file with its Blob, filename, MIME type, format and snapshot identity. Start its download immediately, preserving the existing export behavior. The app can report that the file is ready and a download was requested; [a download attribute does not establish that the browser saved the file](https://developer.mozilla.org/en-US/docs/Web/API/HTMLAnchorElement/download). Keep a Download again action available.
3. Offer a dismissible Share dialog after export, with Create link, Share file when supported, Download again and Done. Closing it leaves the export successful and uploads nothing. Allow reopening it from the completed export state without another render.
4. Share file uses the completed file directly, without an upload. Check browser support for that exact file type; `.pvo` must not be assumed shareable. Invoke native sharing from a new button press because the [Web Share API requires user activation and supported share data](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share). Do not automatically launch the device share sheet after asynchronous rendering.
5. Create link explains that anyone with the link can watch, collects a title and requests sign-in if required. Preserve the prepared export through that flow, including redirects. Upload that completed file with progress; the server verifies ownership, quota, size and format before marking it available.
6. Only after successful publication, show Copy link, Share link and Open video. Opening the link on another phone must work with the creator's computer turned off. Cancelling or failing online sharing must not turn a successful export into an export failure.
7. Provide a small Shared videos management surface for listing, copying links and deleting the creator's publications. It is not a desktop home or cloud-editable project library.

A publication is an immutable exported snapshot. Copy link reuses that publication's link. Changed work requires a new export before creating a new link; existing links continue showing their original snapshot until deleted. Do not upload again just because the creator shares the same published export a second time.

Failed uploads retain the local draft and completed export, offer Retry, and never expose a half-uploaded link. Retrying the same upload attempt is idempotent. Keep the completed file available for Download again and reopening Share; closing the dialog must not revoke its URL. Release resources on replacement/reset when no active share operation still owns them, and release listeners when their UI unmounts. Progress and results belong in the Share panel, without routine success toasts; any global failure event must follow the typed notification catalogue.

The published viewer selects native MP4/WebM playback or the existing interactive `.pvo` player from the server-verified publication format. Sharing a flat export does not recover interactions omitted by that export choice.

## Cloudflare responsibilities

| Component | Responsibility |
| --- | --- |
| Workers Static Assets | Camera/editor application, player modules, fonts and WASM. No demo or documentation-site output. |
| Worker | Explicit route handling, verified creator sessions, publication ownership, quotas, uploads, media reads and share-page metadata. |
| R2 Standard, private bucket | Published export files and optional validated thumbnail images. Access through the Worker; no storage credentials in browser code. |
| D1 | Creator identities, publication records, upload attempts and quota reservations. Store media in R2, not database rows. |

A database supports the requested multi-user product: owner-scoped lists, deletion and atomic quota reservations. Keep identity-provider integration narrow; use an established provider-backed sign-in flow and verified server sessions. Provider selection and callback configuration are launch setup decisions, not reasons to block local editing. Do not invent a password system.

Use same-origin streaming uploads through the Worker for the bounded first release. This keeps R2 access behind a binding and avoids exposing upload credentials. Do not buffer full videos in Worker memory. Larger or resumable uploads can later use short-lived, object-scoped [R2 upload URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) with staging and completion checks.

Give API, media and publication-page routes explicit Worker precedence over static fallbacks. Continue serving actual static files directly; avoid a broad SPA fallback that turns missing videos or API failures into the editor shell.

### Publication lifecycle and API

- `POST /api/publications` reserves a pending ID and upload attempt after authentication, rate and quota checks. An idempotency key prevents duplicate publications when a response is lost.
- `PUT /api/publications/{id}/content` accepts the owner's bounded export stream. Validate allowed MP4/WebM containers or the PVO header, manifest and asset ranges with bounded reads. Never evaluate uploaded code on the server. MIME type alone is insufficient validation.
- Each accepted upload writes a fresh attempt-specific object key. After storage and validation succeed, a conditional D1 update changes the publication from pending to ready and records that object's key. R2 and D1 do not share a transaction: reconcile lost responses and clean up unreferenced objects. Retries must never overwrite a written object or replace the object referenced by a ready publication. Failed or abandoned attempts expire and their objects and quota reservations are cleaned up.
- `GET /api/publications` lists the signed-in creator's publications. `DELETE /api/publications/{id}` checks ownership, marks the publication unavailable, then removes its stored objects with retryable cleanup.
- `GET /player/{id}` renders the viewer shell with escaped title, canonical link and optional thumbnail metadata so messaging apps can preview it. Serve player scripts and styles through absolute asset paths. Use `noindex` for unlisted pages as a discoverability hint, not access control.
- `GET /media/{id}` checks availability and streams the R2 body with verified content type and length. Support byte-range requests for native MP4/WebM playback and seeking. Pending, deleted or invalid IDs never resolve to application HTML or arbitrary R2 keys.

Suggested records: creator identity; publication ID, owner, title, storage key, export format, verified MIME type, byte size, creation time and status; upload attempt ID, expiry and reserved bytes. Scope every mutation and creator listing by the verified session, not an owner ID supplied by the browser. Protect authenticated writes against CSRF and retain the player's sandbox and credential-free request adapter.

For the first release, revalidate publication availability on new page/media requests and avoid long-lived public caching of revocable content. Deleting a link prevents new retrievals; it cannot retract a package already downloaded by a viewer.

## Size, cost and storage boundaries

Start with a configurable **50 MiB maximum uploaded export**, plus per-creator and total storage quotas; verify the limit against actual mobile exports before release. Enforce byte limits on the server and reserve quota before upload. Include abandoned uploads and thumbnails in accounting. Show the completed file's size and online limit in Share before upload. Exceeding an online sharing quota must not prevent rendering or downloading locally.

The current player fetches the entire `.pvo` before playback. R2 storage alone does not provide progressive playback or adaptive streaming. Keep visible loading and retry states; large-video streaming is a separate player/SDK project.

As checked on 27 September 2026, [static asset requests and asset storage are free](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/). [R2 Standard includes 10 GB-month storage, 1 million Class A operations and 10 million Class B operations per month free; internet egress is free](https://developers.cloudflare.com/r2/pricing/). Worker execution and database use have separate limits and pricing. This is a low-cost architecture, not an unlimited free video service. Track storage and request usage and enforce the selected publishing quotas.

Local drafts remain in browser IndexedDB. Publishing stores a viewing snapshot, not a cloud backup of editable source footage and project history. Changing paths on the same origin preserves browser storage; moving from the tunnel to a different hostname does not transfer drafts. Keep the old origin available during migration. Current `.pvo` download is not an editable-project backup that the editor can re-import; a portable editable-project format is separate work.

## Source ownership

The [static build](../../scripts/build/share-site.mjs) copies product entry files from `editor/deployment/` and excludes demo/docs output. [Published player startup](../../player/publication/entry.js) selects playback from verified metadata; [share controls](../../player/publication/sharing.js) use the canonical publication URL. [Package loading](../../player/media/project.js) preserves same-origin fetches and reads a complete Blob. The [export workflow](../../editor/src/features/export/exportWorkflow.ts) retains a completed artifact for download and optional sharing. [Worker routes](../../server/index.js) own the publishing backend.

- Keep routing/deployment changes in `scripts/build/` and a checked-in Wrangler configuration. Give the product a deployment output that excludes `docs/site/`, `share/index.html` and demo-only media/metadata assets. Preserve the separate PVO documentation build and shared runtime packages. Remove product navigation links and return 404 for removed demo/docs paths rather than falling back to the app. Make packaging reproducible from source; do not fix generated `dist/` by hand.
- Have the export workflow return a completed artifact with a Blob, filename, MIME type, format and snapshot identity. Download and Share consume that same artifact; publishing never triggers a second render or reads later project state. Keep effects in feature adapters, with explicit immutable input data rather than new store dependencies in domain code.
- Put publication rules and state transitions in `editor/src/domain/publishing/`, presentation/orchestration in `editor/src/features/publishing/`, and HTTP effects in an infrastructure adapter.
- Add a cohesive `server/` area for Worker routes, domain rules, storage and identity adapters. The entry point only dispatches routes. Record its ownership in the architecture when implemented.
- Use shared SDK public contracts. Preserve package format compatibility and the boundary between editor and player internals. Add bounded container inspection through the SDK's public API if needed rather than duplicating binary-format rules in the Worker.

## Delivery order and acceptance

1. **Product deployment and mobile home:** exclude demo and docs output and navigation, then make mobile home enter the camera while preserving restored work. Verify camera permissions/import, continuation into editing, retained drafts, removed-page 404s, runtime assets, offline app startup and New beta release behavior. Leave desktop-specific home design for later and do not switch screens on resize.
2. **Export then Share:** retain the completed artifact, start download, then offer the optional dialog. Verify MP4/WebM and interactive PVO exports, Download again, dialog dismissal/reopening, supported and unsupported native file sharing, cancellation, later edits and resource cleanup. No upload or sign-in occurs merely because Export completed; keep Create link unavailable until its backend exists.
3. **Online links:** add Worker deployment, R2/D1 bindings, creator ownership, quotas, publication lifecycle, both viewer formats and link metadata. Verify ownership isolation, byte limits, invalid content, interrupted/repeated uploads, cleanup and unavailable links. Test flat and branching exports from an unauthenticated second browser/device with the creator's local server stopped. Test authentication without losing the completed export, edits after export, successful downloads followed by failed sharing, and deletion of links.
4. **Production rollout:** configure the actual public hostname, authentication callback and Cloudflare resources; deploy through Wrangler or connected CI. The static ZIP alone cannot provide the new API. Test against the deployed URL, not just local emulation. Preserve existing beta output before rebuilding, copy assets before HTML/service worker while retaining old hashed assets, and deliver app changes through New beta release without forcing a reload.

Run the relevant Node tests and editor type checks, meaningful browser and Worker integration tests, and the production build when implementing app changes. Source implementation is covered by those checks; end-to-end production sign-in and public upload checks remain launch requirements after external resources are configured.

Out of the first release: a new desktop home, cloud draft sync, collaborative editing, private/password-protected viewing, analytics dashboards and adaptive streaming. Demo and PVO documentation hosting belong to separate deployments, not a later product-home feature.
