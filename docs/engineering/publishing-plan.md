# Mobile camera home, export and sharing

Current product behavior after the Google account and export contract. Product deployment separation, mobile camera home, export/download/Share, published viewers and the Worker backend are implemented. A Google account is required for export and publication; the same account owns links across devices. Published media stays in private R2 storage, with account ownership in D1. See the [Cloudflare setup](cloudflare-publishing.md). Follow the existing [architecture](architecture.md), [coding standard](coding-standards.md) and [notification policy](notification-policy.md).

## Product behavior

On mobile, opening the site's home address opens the camera. The creator records or imports footage, then continues into editing. Restore saved draft data without replacing the camera home with an empty editor or discarding existing work; provide a way to continue editing that draft. Camera permission denial must leave import and recovery usable.

At 1024px and above in landscape, home opens the create-project studio; narrower and portrait viewports keep the camera-first workspace. Resizing does not change the active recording/editing screen. A shared `/player/{id}` link always opens that video on both mobile and desktop, regardless of home behavior.

Remove the demo and PVO documentation from this product's deployment and navigation. There is no `/demo/` or `/docs/` product page. The PVO documentation is a separate site; preserve its source and test fixtures in the repository, but do not copy them or the demo's media into this application's deployment.

People can record and edit without signing in. Video and `.pvo` export, downloading a completed export, native file sharing, and creating or managing online links require a Google account. Google sign-in uses only `openid profile` and creates a seven-day account session. Signing in again with the same Google account restores management access to that account's publications on another device. Viewers need no account. Links are unlisted: anyone who receives a link can watch and forward it. They are not private viewing links.

The primary flow is **Camera → Create/edit → Google sign-in → Export → Download → optional Share dialog**. Export waits for a verified account, prepares the chosen video or `.pvo` file and initiates its download. Then the app offers the Share dialog. Uploading is optional and starts only when the creator chooses Create link; a publication failure does not invalidate a completed local export.

Share operates on the exact completed export. A flat video stays flat; an interactive `.pvo` keeps its exported interactions and scenes. Do not render again, silently change formats or use later editor changes when sharing an already exported result. Never share a local `blob:` URL as a public link or imply that copying the editor address shares a draft.

## Routes

| Address | Behavior |
| --- | --- |
| `/` | Redirects into the existing `/editor/` application to preserve its installed-app scope and asset paths; mobile home selects the camera and landscape desktop home opens the studio. |
| `/about.html`, `/privacy.html`, `/terms.html` | Static product information, privacy policy and terms on the canonical `https://getrestyle.app` origin. |
| `/editor/` | Existing application entry for the camera → edit → export → share flow. Preserve draft recovery and ongoing sessions. |
| `/player/{id}` | Opens one published video. Unknown or removed IDs show a clear unavailable page with an appropriate HTTP status. |
| `/player/` | Existing standalone player for opening a local `.pvo`; do not offer a public sharing link for an unpublished file. |
| `/demo/`, `/docs/` | Not deployed on this product; return a real not-found response. |
| `/api/auth/*`, `/api/publications*`, `/api/publishing` | Google account sessions, publication management and upload operations. Never fall back to editor HTML. |
| `/media/{id}` | Same-origin read of the published export, with verified video or PVO content type. |

Generate opaque, cryptographically random publication IDs on the server, with at least 128 bits of randomness. Do not reuse editor scene IDs or encode video data in the URL. `/player/{id}` is the canonical link; query-string source URLs remain a compatibility feature, not the publishing API.

Moving the application itself to `/` can follow separately if a root-only address is desired. That requires an intentional service-worker and installed-app migration; it is unnecessary to make the mobile home address open the camera now. A home entry selects the camera without clearing recovered project data or interrupting an already active session.

## Export and Share flow

1. The creator chooses Export and the desired format/quality. Check the live account session before preparing the export. If signed out, show Google sign-in in a popup while keeping the editor and export settings mounted; a blocked popup reports an error and leaves the project intact. Capture a stable project snapshot and validate the required clips and, for interactive export, scene destinations. Show rendering progress. Current rendering runs in real time; an interactive export may take the combined duration of its scenes.
2. Retain the completed file with its Blob, filename, MIME type, format and snapshot identity. Start its download immediately, preserving the existing export behavior. The app can report that the file is ready and a download was requested; [a download attribute does not establish that the browser saved the file](https://developer.mozilla.org/en-US/docs/Web/API/HTMLAnchorElement/download). Keep a Download again action available.
3. Offer a dismissible Share dialog after export, with Create link, Share file when supported, Download again and Done. Closing it leaves the export successful and uploads nothing. Allow reopening it from the completed export state without another render.
4. Share file uses the completed file directly, without an upload. Check browser support for that exact file type; `.pvo` must not be assumed shareable. Invoke native sharing from a new button press because the [Web Share API requires user activation and supported share data](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share). Do not automatically launch the device share sheet after asynchronous rendering.
5. Create link explains that anyone with the link can watch and collects a title. Check the live Google account session before uploading the retained completed file with progress; the server verifies account ownership, quota, size and format before marking it available. Opening Share or checking availability alone creates no account or upload.
6. Only after successful publication, show Copy link, Share link and Open video. Opening the link on another phone must work with the creator's computer turned off. Cancelling or failing online sharing must not turn a successful export into an export failure.
7. Provide a small Shared videos management surface for listing, copying links and deleting publications owned by the signed-in account. It is not a cloud-editable project library.

A publication is an immutable exported snapshot. Copy link reuses that publication's link. Changed work requires a new export before creating a new link; existing links continue showing their original snapshot until deleted. Do not upload again just because the creator shares the same published export a second time.

Failed uploads retain the local draft and completed export, offer Retry, and never expose a half-uploaded link. Retrying the same upload attempt is idempotent. Keep the completed file available for Download again and reopening Share; closing the dialog must not revoke its URL. Release resources on replacement/reset when no active share operation still owns them, and release listeners when their UI unmounts. Progress and results belong in the Share panel, without routine success toasts; any global failure event must follow the typed notification catalogue.

The published viewer selects native MP4/WebM playback or the existing interactive `.pvo` player from the server-verified publication format. Sharing a flat export does not recover interactions omitted by that export choice.

## Cloudflare responsibilities

| Component | Responsibility |
| --- | --- |
| Workers Static Assets | Camera/editor application, public About, Privacy and Terms pages, player modules, fonts and WASM. No demo or documentation-site output. |
| Worker | Google OAuth and verified account sessions, publication ownership, quotas, uploads, media reads and share-page metadata. |
| R2 Standard, private bucket | Published export files and optional validated thumbnail images. Access through the Worker; no storage credentials in browser code. |
| D1 | Users, Google provider identities, account sessions, publication records, upload attempts and quota reservations. Store media in R2, not database rows. |

D1 supports account-owned lists, deletion and atomic quota reservations. Google supplies an OIDC subject and display name; the server associates that subject with a random internal user ID. It stores only a hash of the random session token, and sends a signed HttpOnly, Secure, SameSite cookie. Google authorization tokens are not retained. Require the exact configured HTTPS origin for writes. Google sign-in availability depends on `DB`, an exact `PUBLIC_ORIGIN`, a 32-character-or-longer `SESSION_SECRET`, and `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`; publication availability also requires `PUBLISHING_ENABLED=true` and the private R2 binding.

Use same-origin streaming uploads through the Worker for the bounded first release. This keeps R2 access behind a binding and avoids exposing upload credentials. Do not buffer full videos in Worker memory. Larger or resumable uploads can later use short-lived, object-scoped [R2 upload URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) with staging and completion checks.

Give API, media and publication-page routes explicit Worker precedence over static fallbacks. Continue serving actual static files directly; avoid a broad SPA fallback that turns missing videos or API failures into the editor shell.

### Publication lifecycle and API

- `GET /api/auth/session` returns `{available, user: {id, name} | null}` without creating an account or session. `GET /api/auth/google/start` begins Google OAuth with state, nonce and PKCE; `GET /api/auth/google/callback` verifies the ID token and establishes the account session; `POST /api/auth/logout` ends it.
- `GET /api/publishing` returns `{available, hasSession, maxBytes}` without creating an account or session; `hasSession` reflects the current verified Restyle account.
- `POST /api/publications` reserves a pending ID and upload attempt after account, rate and quota checks. An idempotency key prevents duplicate publications when a response is lost.
- `PUT /api/publications/{id}/content` accepts the owner's bounded export stream. Validate allowed MP4/WebM containers or the PVO header, manifest and asset ranges with bounded reads. Never evaluate uploaded code on the server. MIME type alone is insufficient validation.
- Each accepted upload writes a fresh attempt-specific object key. After storage and validation succeed, a conditional D1 update changes the publication from pending to ready and records that object's key. R2 and D1 do not share a transaction: reconcile lost responses and clean up unreferenced objects. Retries must never overwrite a written object or replace the object referenced by a ready publication. Failed or abandoned attempts expire and their objects and quota reservations are cleaned up.
- `GET /api/publications` lists publications owned by the current account. `DELETE /api/publications/{id}` checks ownership, marks the publication unavailable, then removes its stored objects with retryable cleanup.
- `GET /player/{id}` renders the viewer shell with escaped title, canonical link and optional thumbnail metadata so messaging apps can preview it. Serve player scripts and styles through absolute asset paths. Use `noindex` for unlisted pages as a discoverability hint, not access control.
- `GET /media/{id}` checks availability and streams the R2 body with verified content type and length. Support byte-range requests for native MP4/WebM playback and seeking. Pending, deleted or invalid IDs never resolve to application HTML or arbitrary R2 keys.

Stored records: user ID and display name, Google provider subject, hashed account session token and expiry; publication ID, owner, title, storage key, export format, verified MIME type, byte size, creation time and status; upload attempt ID, expiry and reserved bytes. Scope every mutation and creator listing by the verified account session, never an owner ID supplied by the browser. Protect account and publication writes against CSRF and retain the player's sandbox and credential-free request adapter.

For the first release, revalidate publication availability on new page/media requests and avoid long-lived public caching of revocable content. Deleting a link prevents new retrievals; it cannot retract a package already downloaded by a viewer.

## Size, cost and storage boundaries

Start with a configurable **50 MiB maximum uploaded export**, plus 500 MiB per account, 5 GiB total storage and 20 newly created links per account per rolling day; verify the limit against actual mobile exports before release. Enforce byte limits on the server and reserve quota before upload. Include pending and deleting uploads in accounting until their storage is removed. Signing out and back into the same account does not reset its quota; the total storage cap remains global. Show the completed file's size and online limit in Share before upload. Exceeding an online sharing quota must not prevent rendering or downloading locally after sign-in.

The current player fetches the entire `.pvo` before playback. R2 storage alone does not provide progressive playback or adaptive streaming. Keep visible loading and retry states; large-video streaming is a separate player/SDK project.

As checked on 27 September 2026, [static asset requests and asset storage are free](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/). [R2 Standard includes 10 GB-month storage, 1 million Class A operations and 10 million Class B operations per month free; internet egress is free](https://developers.cloudflare.com/r2/pricing/). Worker execution and database use have separate limits and pricing. This is a low-cost architecture, not an unlimited free video service. Track storage and request usage and enforce the selected publishing quotas.

Local drafts remain in browser IndexedDB. Publishing stores a viewing snapshot, not a cloud backup of editable source footage and project history. Changing paths on the same origin preserves browser storage; moving from the tunnel to a different hostname does not transfer drafts. Keep the old origin available during migration. Current `.pvo` download is not an editable-project backup that the editor can re-import; a portable editable-project format is separate work.

## Source ownership

The [static build](../../scripts/build/share-site.mjs) copies product entry files from `editor/deployment/` and public account-information pages from [`public/`](../../public/), while excluding demo/docs output. [Published player startup](../../player/publication/entry.js) selects playback from verified metadata; [share controls](../../player/publication/sharing.js) use the canonical publication URL. [Package loading](../../player/media/project.js) preserves same-origin fetches and reads a complete Blob. The [export workflow](../../editor/src/features/export/exportWorkflow.ts) retains a completed artifact for download and optional sharing. [Worker routes](../../server/index.js) own the publishing backend.

- Keep routing/deployment changes in `scripts/build/` and a checked-in Wrangler configuration. Give the product a deployment output that excludes `docs/site/`, `share/index.html` and demo-only media/metadata assets. Preserve the separate PVO documentation build and shared runtime packages. Remove product navigation links and return 404 for removed demo/docs paths rather than falling back to the app. Make packaging reproducible from source; do not fix generated `dist/` by hand.
- Have the export workflow return a completed artifact with a Blob, filename, MIME type, format and snapshot identity. Download and Share consume that same artifact; publishing never triggers a second render or reads later project state. Keep effects in feature adapters, with explicit immutable input data rather than new store dependencies in domain code.
- Put publication rules and state transitions in `editor/src/domain/publishing/`, presentation/orchestration in `editor/src/features/publishing/`, and HTTP effects in an infrastructure adapter.
- Keep Worker routing, Google account sessions, publication rules and storage adapters in focused `server/` modules. The entry point only dispatches routes.
- Use shared SDK public contracts. Preserve package format compatibility and the boundary between editor and player internals. Add bounded container inspection through the SDK's public API if needed rather than duplicating binary-format rules in the Worker.

## Delivery order and acceptance

1. **Product deployment and responsive home:** exclude demo and docs output and navigation, then make mobile home enter the camera and landscape desktop home enter the create-project studio while preserving restored work. Verify camera permissions/import, continuation into editing, retained drafts, removed-page 404s, runtime assets, offline app startup and New beta release behavior. Do not switch screens on resize.
2. **Account-gated Export then Share:** verify that every video and PVO export waits for a live Google account session before rendering or downloading. The popup keeps the editor and export settings mounted; cancellation and blocked popups preserve work. Then retain the completed artifact, start download and offer the optional dialog. Verify Download again, dialog dismissal/reopening, supported and unsupported native file sharing, cancellation, later edits and resource cleanup. No upload is created merely because Export completed.
3. **Online links:** verify Worker deployment, R2/D1 bindings, account ownership, quotas, publication lifecycle, both viewer formats and link metadata. Test ownership isolation, byte limits, invalid content, interrupted/repeated uploads, cleanup and unavailable links. Test flat and branching exports from a second browser/device without an account; viewers should work, while management requires signing into the creator's Google account. Test account sign-in without losing the completed export, read-only availability, edits after export, successful downloads followed by failed sharing, and deletion of links.
4. **Production rollout:** the `getrestyle.app` Cloudflare zone is active; complete Google DNS ownership verification and OAuth Branding for that domain. Configure the exact `https://getrestyle.app/api/auth/google/callback` Web-client redirect, Worker credentials, session secret and Cloudflare resources. Review and serve `/about.html`, `/privacy.html` and `/terms.html` publicly on `https://getrestyle.app`, linking both policy pages from the homepage. The static ZIP alone cannot provide the account or publishing API. Test against the deployed URL, not just local emulation. Preserve existing beta output before rebuilding, copy assets before HTML/service worker while retaining old hashed assets, and deliver app changes through New beta release without forcing a reload.

Run the relevant Node tests and editor type checks, meaningful browser and Worker integration tests, and the production build when implementing app changes. Source implementation is covered by those checks; end-to-end Google sign-in and public upload checks must also pass against the deployed resources.

Out of the first release: cloud draft sync, collaborative editing, private/password-protected viewing, analytics dashboards and adaptive streaming. Demo and PVO documentation hosting belong to separate deployments.
