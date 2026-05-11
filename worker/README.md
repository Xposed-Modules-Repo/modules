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

GitHub webhook URL:

```text
https://<worker-host>/webhook
```

Cloudflare Pages build environment:

```text
DIRTY_REPOS_ENDPOINT=https://<worker-host>/dirty?consume=1
DIRTY_REPOS_TOKEN=<same token as worker secret>
```

When the build starts, the Astro pipeline reads the dirty list. If the local cache is available, it refreshes only those repositories; if the cache is missing, it falls back to a full GitHub inventory scan.
