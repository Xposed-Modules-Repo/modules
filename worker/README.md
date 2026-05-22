# Webhook Debounce Worker

This Worker verifies GitHub webhooks, stores dirty repositories in a Durable Object, waits for a quiet period, then triggers one Cloudflare Pages deploy hook.

## Deploy

```sh
npm run worker:deploy
```

Configure secrets:

```sh
npx wrangler secret put GITHUB_WEBHOOK_SECRET -c worker/wrangler.toml
npx wrangler secret put PAGES_DEPLOY_HOOK_URL -c worker/wrangler.toml
npx wrangler secret put DIRTY_REPOS_TOKEN -c worker/wrangler.toml
```

The Worker also exposes a private D1 REST-compatible query endpoint for build-time cache access. It uses the metadata, README, and release D1 bindings in `wrangler.toml` and accepts `Authorization: Bearer <token>`, where the token is `D1_CACHE_TOKEN` if configured, otherwise `DIRTY_REPOS_TOKEN`.

GitHub webhook URL:

```text
https://<worker-host>/webhook
```

Cloudflare Pages build environment:

```text
DIRTY_REPOS_ENDPOINT=https://<worker-host>/dirty?consume=1
DIRTY_REPOS_TOKEN=<same token as worker secret>
D1_CACHE_ENDPOINT=https://<worker-host>
D1_CACHE_METADATA_DATABASE_ID=65e5b2d4-c6c3-4c1f-8eb1-17dde6c8a41d
D1_CACHE_README_DATABASE_ID=d65705d6-c416-43b7-9cc7-f8a7971ce464
D1_CACHE_RELEASE_DATABASE_ID=998dbc82-4265-434d-a0ae-8b64cd708405
D1_CACHE_ACCOUNT_ID=8911df62bfddad67b7d7e84ae666bc87
```

When the build starts, the Astro pipeline reads the dirty list. If the local cache is available, it refreshes only those repositories; if the cache is missing, it falls back to a full GitHub inventory scan.
