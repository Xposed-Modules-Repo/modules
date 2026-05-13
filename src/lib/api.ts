import { proxyAssetUrl, rewriteAssetProxyHtml } from './asset-proxy'
import type { ModuleRecord, ModuleRelease, ReleaseAsset } from './types'

type ApiReleaseAsset = ReleaseAsset & {
  originalDownloadUrl?: string
}

type CachedModuleRelease = ModuleRelease & {
  description?: string | null
}

type CachedModuleRecord = ModuleRecord & {
  readme?: string | null
}

type ApiModuleRelease = Omit<CachedModuleRelease, 'description'> & {
  releaseAssets?: ApiReleaseAsset[]
}

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
  const { description, ...publicRelease } = release

  return {
    ...publicRelease,
    descriptionHTML: rewriteAssetProxyHtml(publicRelease.descriptionHTML) || publicRelease.descriptionHTML,
    releaseAssets: release.releaseAssets?.map(apiReleaseAsset)
  }
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
  const readmeHTML = rewriteAssetProxyHtml(module.readmeHTML) || module.readmeHTML

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
