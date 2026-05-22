import { load } from 'cheerio'
import { proxyAssetUrl, rewriteAssetProxyHtml } from './asset-proxy'
import type { ModuleRecord, ModuleRelease, ReleaseAsset } from './types'

type ApiReleaseAsset = ReleaseAsset & {
  originalDownloadUrl?: string
}

type CachedModuleRelease = ModuleRelease & {
  description?: string | null
  descriptionHTMLCacheKey?: string | null
}

type CachedModuleRecord = ModuleRecord & {
  readme?: string | null
}

type ApiModuleRelease = Omit<CachedModuleRelease, 'description'> & {
  releaseAssets?: ApiReleaseAsset[]
}

const PUBLIC_ENV = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>
}).env

function apiReleaseAsset (asset: ReleaseAsset): ApiReleaseAsset {
  const proxiedDownloadUrl = proxyAssetUrl(asset.downloadUrl)
  if (!proxiedDownloadUrl) return asset

  return {
    ...asset,
    originalDownloadUrl: asset.downloadUrl,
    downloadUrl: proxiedDownloadUrl
  }
}

function apiRelease (release: CachedModuleRelease): ApiModuleRelease {
  const { description, descriptionHTMLCacheKey, ...publicRelease } = release

  return {
    ...publicRelease,
    descriptionHTML: rewriteAssetProxyHtml(publicRelease.descriptionHTML) || publicRelease.descriptionHTML,
    releaseAssets: release.releaseAssets?.map(apiReleaseAsset)
  }
}

function publicEnv (name: string): string | null {
  const value = process.env[name] || PUBLIC_ENV?.[name]
  const trimmed = value?.trim()
  return trimmed || null
}

function escapeHtmlAttribute (value: string): string {
  return value.replace(/[&<>"']/g, character => {
    switch (character) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

function adsScriptHtml (client: string): string {
  const scriptUrl = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`

  return `<script data-readme-ad="true" async src="${scriptUrl}" crossorigin="anonymous"></script>`
}

function readmeAdHtml (): string | null {
  const client = publicEnv('PUBLIC_GOOGLE_ADS_CLIENT') || publicEnv('PUBLIC_ADSENSE_CLIENT')
  if (!client) return null

  const slot = publicEnv('PUBLIC_AD_SLOT_README') || publicEnv('PUBLIC_AD_SLOT_TOP')
  const scriptHtml = adsScriptHtml(client)
  if (!slot) return scriptHtml

  const escapedClient = escapeHtmlAttribute(client)
  const escapedSlot = escapeHtmlAttribute(slot)

  return [
    '<aside class="ad-slot ad-slot-readme" aria-label="Advertisement">',
    scriptHtml,
    '<ins class="adsbygoogle"',
    ' style="display:block"',
    ` data-ad-client="${escapedClient}"`,
    ` data-ad-slot="${escapedSlot}"`,
    ' data-ad-format="auto"',
    ' data-full-width-responsive="true"></ins>',
    '<script>(window.adsbygoogle = window.adsbygoogle || []).push({});</script>',
    '</aside>'
  ].join('')
}

function readmeHtmlWithAds (html: string | null | undefined): string | null | undefined {
  if (!html) return html

  const adHtml = readmeAdHtml()
  if (!adHtml) return html

  const $ = load(html, {}, false)
  if ($('.ad-slot-readme, script[data-readme-ad="true"]').length) return html

  const target = $('.markdown-heading, h1, h2, p, ul, ol, blockquote, pre, table').first()
  if (target.length) {
    target.after(adHtml)
  } else {
    $.root().prepend(adHtml)
  }

  return $.root().html() || html
}

function publicModuleFields (module: ModuleRecord): Record<string, unknown> {
  const {
    fingerprint,
    isModule,
    defaultBranchOid,
    readmeOid,
    readme,
    readmeHTML,
    readmeAssetVersion,
    latestRelease,
    latestBetaRelease,
    latestSnapshotRelease,
    ...publicModule
  } = module as CachedModuleRecord

  return publicModule
}

function latestReleaseTags (module: ModuleRecord): Record<string, unknown> {
  const { latestRelease, latestBetaRelease, latestSnapshotRelease } = module

  return {
    latestRelease: latestRelease?.tagName,
    latestBetaRelease: latestBetaRelease && latestBetaRelease.tagName !== latestRelease?.tagName
      ? latestBetaRelease.tagName
      : undefined,
    latestSnapshotRelease: latestSnapshotRelease &&
      latestSnapshotRelease.tagName !== latestRelease?.tagName &&
      latestSnapshotRelease.tagName !== latestBetaRelease?.tagName
      ? latestSnapshotRelease.tagName
      : undefined
  }
}

function apiCollaborators (module: ModuleRecord): Array<Record<string, string | null>> {
  return module.collaborators.map(author => ({
    login: author.login,
    name: author.name ?? null
  }))
}

function apiAdditionalAuthors (module: ModuleRecord): Array<Record<string, string | null>> | null {
  return module.additionalAuthors
    ? module.additionalAuthors.map(author => ({
        type: author.type ?? null,
        name: author.name ?? null,
        link: author.link ?? null
      }))
    : null
}

export function moduleJson (module: ModuleRecord): Record<string, unknown> {
  const readmeHTML = readmeHtmlWithAds(rewriteAssetProxyHtml(module.readmeHTML) || module.readmeHTML)

  return {
    ...publicModuleFields(module),
    readmeHTML,
    releases: module.releases.map(apiRelease),
    collaborators: apiCollaborators(module),
    additionalAuthors: apiAdditionalAuthors(module),
    ...latestReleaseTags(module),
    childGitHubReadme: readmeHTML
      ? {
          childMarkdownRemark: {
            html: readmeHTML
          }
        }
      : null
  }
}

export function modulesJson (modules: ModuleRecord[]): Array<Record<string, unknown>> {
  return modules.map(module => {
    const latestRelease = module.latestRelease
    const latestBetaRelease = module.latestBetaRelease
    const latestSnapshotRelease = module.latestSnapshotRelease

    return {
      ...publicModuleFields(module),
      collaborators: apiCollaborators(module),
      additionalAuthors: apiAdditionalAuthors(module),
      ...latestReleaseTags(module),
      releases: latestRelease ? [apiRelease(latestRelease)] : [],
      betaReleases: latestBetaRelease && latestBetaRelease.tagName !== latestRelease?.tagName
        ? [apiRelease(latestBetaRelease)]
        : undefined,
      snapshotReleases: latestSnapshotRelease &&
        latestSnapshotRelease.tagName !== latestRelease?.tagName &&
        latestSnapshotRelease.tagName !== latestBetaRelease?.tagName
        ? [apiRelease(latestSnapshotRelease)]
        : undefined
    }
  })
}
