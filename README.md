# Xposed Module Repository

Static site rewrite for https://modules.lsposed.org.

## Build

```sh
npm install
GRAPHQL_TOKEN=... npm run build
```

Cloudflare Pages:

```text
Build command: npm run build
Build output: dist
Node version: 22.12 or newer
```

Useful environment variables:

- `GRAPHQL_TOKEN` or `GITHUB_TOKEN`: token used for GitHub GraphQL and REST calls.
- `GITHUB_ORG`: source organization, defaults to `Xposed-Modules-Repo`.
- `REPO`: optional single dirty repo, for example `Xposed-Modules-Repo/com.example`.
- `DIRTY_REPOS`: optional comma-separated dirty repo names or full names.
- `MODULES_CACHE_DIR`: build cache directory, defaults to `node_modules/.astro/modules-cache`.
- `GITHUB_DETAIL_BATCH_SIZE`: number of repositories fetched per GraphQL detail query, defaults to `10`.
- `GITHUB_REQUEST_DELAY_MS`: delay between GitHub requests, defaults to `750`.
- `USE_GITHUB_MARKDOWN_API=false`: skip GitHub Markdown API and use local fallback rendering.
- `CMARK_GFM_BIN`: optional path to a local `cmark-gfm` binary.
- `DIRTY_REPOS_ENDPOINT`: optional Worker endpoint that returns queued dirty repositories.
- `DIRTY_REPOS_TOKEN`: bearer token for `DIRTY_REPOS_ENDPOINT`.
- `PUBLIC_GOOGLE_ADS_CLIENT` or `PUBLIC_ADSENSE_CLIENT`: Google AdSense client id.
- `PUBLIC_AD_SLOT_TOP`, `PUBLIC_AD_SLOT_SIDEBAR`, `PUBLIC_AD_SLOT_BOTTOM`: optional ad slot ids.
- `USE_SAMPLE_DATA=true`: local verification mode that builds without GitHub API calls.

## Webhook Debounce Worker

The deployable Cloudflare Worker lives in `worker/`. It verifies GitHub webhooks, debounces simultaneous activity with a Durable Object alarm, triggers one Cloudflare Pages deploy hook, and exposes the dirty-repo list to the next static build.
