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
- `GITHUB_DETAIL_BATCH_SIZE`: number of repositories fetched per GraphQL detail query, defaults to `20`.
- `GITHUB_DETAIL_RELEASE_LIMIT`: release nodes fetched in each GraphQL detail query, defaults to `5`. Repositories with more releases are completed via REST.
- `GITHUB_DETAIL_RELEASE_ASSET_LIMIT`: release asset nodes fetched in each GraphQL detail query, defaults to `20`. Releases with more assets are completed via REST.
- `GITHUB_REST_RELEASE_PAGE_SIZE`, `GITHUB_REST_RELEASE_MAX_PAGES`: cap REST release fallback pagination, defaulting to `100` releases/page and `5` pages.
- `GITHUB_REQUEST_DELAY_MS`: delay between GitHub requests, defaults to `750`.
- `USE_GITHUB_README_HTML_API=false`: skip GitHub's rendered README HTML API and render README markdown locally or via the Markdown API fallback.
- `USE_GITHUB_MARKDOWN_API=false`: skip GitHub Markdown API and use local fallback rendering.
- `CMARK_GFM_BIN`: optional path to a local `cmark-gfm` binary.
- `D1_CACHE_METADATA_DATABASE_ID`, `D1_CACHE_README_DATABASE_ID`, `D1_CACHE_RELEASE_DATABASE_ID`, `D1_CACHE_ACCOUNT_ID`, `D1_CACHE_API_TOKEN`: optional persistent build cache backed by Cloudflare D1. It stores module metadata as queryable JSON in one database, and gzip-compressed rendered README/release HTML in separate databases. `D1_CACHE_DATABASE_ID` is only a default fallback. Module records are keyed by repository and include the fingerprint, README HTML is overwritten per repository, and release HTML is keyed by repository plus GitHub release id. After a successful detail fetch, stale README/release rows for that repository are deleted. If D1 is missing, over quota, or returns an error, builds fall back to local cache/GitHub and continue.
- `D1_CACHE_ENDPOINT`: optional D1 REST-compatible endpoint. Set this to the webhook Worker origin to use its runtime D1 binding during static builds instead of a Cloudflare account API token.
- `D1_CACHE_PREFIX`: optional D1 key prefix, defaults to `modules-cache:v1`.
- `D1_CACHE_TTL_SECONDS`: cache TTL, defaults to 30 days.
- `D1_CACHE_MAX_ENTRY_BYTES`: max per-row cache payload size written to D1, defaults to `1500000` to stay below D1's 2 MB row limit.
- `D1_CACHE_MAX_TOTAL_BYTES`: soft cache budget, defaults to `367001600` bytes (350 MiB). Cleanup removes expired entries first, then oldest entries.
- `D1_CACHE_READS=false` or `D1_CACHE_WRITES=false`: disable one side of the D1 cache without changing other configuration.
- `DIRTY_REPOS_ENDPOINT`: optional Worker endpoint that returns queued dirty repositories.
- `DIRTY_REPOS_TOKEN`: bearer token for `DIRTY_REPOS_ENDPOINT`.
- `PUBLIC_GOOGLE_ADS_CLIENT` or `PUBLIC_ADSENSE_CLIENT`: Google AdSense client id.
- `PUBLIC_AD_SLOT_TOP`, `PUBLIC_AD_SLOT_SIDEBAR`, `PUBLIC_AD_SLOT_BOTTOM`: optional ad slot ids.
- `PUBLIC_AD_SLOT_README`: optional manual ad slot id injected into module JSON README HTML; falls back to `PUBLIC_AD_SLOT_TOP`. If no slot is set, the JSON README includes the AdSense Auto ads script when a client id is configured.
- `USE_SAMPLE_DATA=true`: local verification mode that builds without GitHub API calls.

## Webhook Debounce Worker

The deployable Cloudflare Worker lives in `worker/`. It verifies GitHub webhooks, debounces simultaneous activity with a Durable Object alarm, triggers one Cloudflare Pages deploy hook, and exposes the dirty-repo list to the next static build.
