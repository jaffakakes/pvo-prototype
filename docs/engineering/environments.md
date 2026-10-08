# Development, preproduction and production

The repository uses a one-way promotion path. Production is never a feature-development branch.

```text
feature/*, fix/*, hotfix/*, chore/*, docs/*
                         │
                         ▼
                        dev
                         │
                         ▼
                      preprod
                         │
                         ▼
                       prod ──► Cloudflare production
```

## Branch responsibilities

| Branch | Purpose | Deployment |
| --- | --- | --- |
| `dev` | Default integration branch for completed feature and bug-fix pull requests. | None. Checks run on every pull request and push. |
| `preprod` | Release candidate used to verify the exact group of changes intended for production. | None. Checks run before promotion. |
| `prod` | Production history only. It accepts promotions from `preprod`. | A successful push starts the production Cloudflare workflow. |
| `main` | Legacy branch retained temporarily for history. Do not target it with new work. | None. |

Start each change from the latest `dev` branch and use one of the approved prefixes (`feature/`, `fix/`, `hotfix/`, `chore/`, `docs/`, or `codex/`). Open a pull request back to `dev`. Promote with a merge-commit `dev → preprod` pull request, verify the release candidate, then open a merge-commit `preprod → prod` pull request. The promotion policy rejects shortcuts into `preprod` or `prod`. Resolve a promotion conflict on a new work branch entering `dev`, then promote again.

When `dev` contains unrelated unfinished work, an isolated production fix may use `hotfix/*` from the current `prod` commit. Merge the same fix into `dev` first. The hotfix may enter `preprod` through a merge-commit pull request only while `preprod` still equals `prod`; then promote `preprod → prod` normally. Do not include unfinished `dev` work or commit directly on `preprod` or `prod`.

Protected branches require pull requests and the repository's `test` and `promotion` checks. They reject force pushes and deletion. No approving review is required while the repository has one maintainer; the pull request and passing checks remain mandatory.

## Ongoing beta backend

The separately authorized Restyle beta uses [its own deployment checklist](restyle-beta-backend.md), `wrangler.beta.jsonc` and `npm run deploy:beta:built`. That command validates the isolated Worker, origin, development sign-in, D1/R2 resources, private namespaces and dedicated Fly app before invoking Wrangler. `npm run deploy:beta:built -- --dry-run` compiles without uploading. Secrets are supplied from private local storage; they never belong in the configuration or Git.

This ongoing beta is separate from `preprod` promotion and the production workflow. It does not update `getrestyle.app`, reuse production accounts/media, merge integration branches or approve production. The existing loopback beta remains available while the HTTPS backend is prepared. Read current progress before using a deployment command or assuming that a deployment task is complete.

## Production deployment

[`deploy-production.yml`](../../.github/workflows/deploy-production.yml) repeats the locked build and verification commands before running `npm run deploy:built`, the deployment half of `npm run deploy`. It publishes the verified `dist/`, checks the served editor release, and announces the new release to connected editors without rebuilding a second time.

Before uploading, deployment preserves immutable `/editor/assets/` files needed by open editor sessions. It reads the live service worker's asset list and the retained-asset inventory, downloads missing files from the configured production origin, and publishes the union with the new build. It never replaces the fresh HTML, service worker or mutable player/package modules, and never adds old files to the new service worker's precache. A failed preservation request stops deployment before upload. The first inventory is bootstrapped from the live service worker and any assets already in the prepared output; subsequent releases carry the inventory forward.

The workflow uses the GitHub `prod` environment and needs two environment secrets:

```text
CLOUDFLARE_API_TOKEN
RELEASE_NOTIFY_TOKEN
```

Create the API token in Cloudflare with only the permissions required to deploy this Worker and its configured bindings, then add it to the GitHub `prod` environment. Generate one stable random release token and keep it as the `RELEASE_NOTIFY_TOKEN` environment secret so local or emergency deployments do not unknowingly rotate the announcement credential. Never commit either token or place one in a pull request. The Worker account ID and production origin remain in [`wrangler.jsonc`](../../wrangler.jsonc).

The `getrestyle.app` Custom Domain is already attached in Cloudflare to the `lingering-butterfly-9ba8` Worker in zone `b7f220e7a921e2a2f7a45f56d207fb7c`. Keep that attachment in Cloudflare: Wrangler intentionally has no `route` or `routes` key, so routine Worker deployments leave the existing domain connection in place. The explicit `workers_dev: true` keeps earlier viewing links available on the old hostname. Cloudflare [documents dashboard-managed routes](https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth) and confirms that, once a Custom Domain is configured, [deploying new Worker versions](https://developers.cloudflare.com/workers/authorization/workers/#routes-and-custom-domains) needs Worker Editor access without zone route-write access. Adding, moving, or removing the domain still requires separate Cloudflare zone permission. Verify both the apex and the old Worker hostname after deployment.

After the secret is configured, run **Deploy production** manually once if the initial `prod` branch creation occurred before the secret existed. Every later merge into `prod` deploys automatically.

Google sign-in requires the `DB` D1 database, exact HTTPS `PUBLIC_ORIGIN=https://getrestyle.app`, a Worker `SESSION_SECRET` of at least 32 characters, and Worker `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` secrets. The `getrestyle.app` Cloudflare zone is active and ownership is verified in Google Search Console with a DNS TXT record. The Google OAuth Web application client uses the exact redirect URI `https://getrestyle.app/api/auth/google/callback`, and the domain is authorized in OAuth Branding. The Branding homepage is the public [About page](../../public/about.html) at `https://getrestyle.app/about.html`, with [Privacy](../../public/privacy.html) at `https://getrestyle.app/privacy.html` and [Terms](../../public/terms.html) at `https://getrestyle.app/terms.html`. The homepage links both policy pages. Cloudflare routes `support@getrestyle.app` to the verified private contact inbox. Google sign-in requests only `openid profile`; it does not authorize Google Drive or ChatGPT access. The separate `RELEASE_NOTIFY_TOKEN` and `CLOUDFLARE_API_TOKEN` above belong to deployment, not user sign-in.

Creating a link additionally requires `PUBLISHING_ENABLED=true` and the private `MEDIA` R2 bucket. `GET /api/auth/session` reports account availability independently of `GET /api/publishing`; disabling publishing does not disable Google sign-in, editing, the player, the assistant, or release notifications. Video and PVO export require a signed-in account even when publishing is disabled. See the [publishing setup](cloudflare-publishing.md) for the provisioned resources, initial schema and account limits.

The checked-in poster and reply APIs use the existing private R2 bucket and D1 account ownership. Production already has the render and reply feature schemas applied; confirm migration history for another deployment target before release. Server FFmpeg rendering is a separate capability: it stays unavailable without a Queue, a Container binding and `RENDERING_ENABLED=true`. The current account has no render Queue and requires a Workers Paid plan for Containers. Publishing this code does not activate paid rendering; browser rendering remains available. See [server rendering](server-rendering.md).

## Rollback

Do not rewrite `prod`. Create a `fix/*` or `hotfix/*` branch that reverts the faulty change, then promote it through `dev`, `preprod`, and `prod`. This preserves an auditable production history and runs the same checks as every other release.
