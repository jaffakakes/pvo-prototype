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

Start each change from the latest `dev` branch and use one of the approved prefixes (`feature/`, `fix/`, `hotfix/`, `chore/`, `docs/`, or `codex/`). Open a pull request back to `dev`. Promote with a merge-commit `dev → preprod` pull request, verify the release candidate, then open a merge-commit `preprod → prod` pull request. The promotion policy rejects shortcuts into `preprod` or `prod`. Resolve a promotion conflict on a new work branch entering `dev`, then promote again; do not create a one-off fix on `preprod` or `prod`.

Protected branches require pull requests and the repository's `test` and `promotion` checks. They reject force pushes and deletion. No approving review is required while the repository has one maintainer; the pull request and passing checks remain mandatory.

## Production deployment

[`deploy-production.yml`](../../.github/workflows/deploy-production.yml) repeats the locked build and verification commands before running `npm run deploy:built`, the deployment half of `npm run deploy`. It publishes the verified `dist/`, checks the served editor release, and announces the new release to connected editors without rebuilding a second time.

The workflow uses the GitHub `prod` environment and needs two environment secrets:

```text
CLOUDFLARE_API_TOKEN
RELEASE_NOTIFY_TOKEN
```

Create the API token in Cloudflare with only the permissions required to deploy this Worker and its configured bindings, then add it to the GitHub `prod` environment. Generate one stable random release token and keep it as the `RELEASE_NOTIFY_TOKEN` environment secret so local or emergency deployments do not unknowingly rotate the announcement credential. Never commit either token or place one in a pull request. The Worker account ID and production origin remain in [`wrangler.jsonc`](../../wrangler.jsonc).

After the secret is configured, run **Deploy production** manually once if the initial `prod` branch creation occurred before the secret existed. Every later merge into `prod` deploys automatically.

Publishing links remain disabled while `PUBLISHING_ENABLED=false`; this does not prevent deployment of the editor, player, Worker routes, Workers AI binding, or release channel.

## Rollback

Do not rewrite `prod`. Create a `fix/*` or `hotfix/*` branch that reverts the faulty change, then promote it through `dev`, `preprod`, and `prod`. This preserves an auditable production history and runs the same checks as every other release.
