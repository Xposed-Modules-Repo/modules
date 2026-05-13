import { proxyAssetUrl, rewriteAssetProxyHtml } from './asset-proxy'
import type { ModuleRecord, ModuleRelease, ReleaseAsset } from './types'

type ApiReleaseAsset = ReleaseAsset & {
  originalDownloadUrl?: string
}

type ApiModuleRelease = ModuleRelease & {
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

function apiRelease (release: ModuleRelease): ApiModuleRelease {
  return {
    ...release,
    description: undefined,
    descriptionHTML: rewriteAssetProxyHtml(release.descriptionHTML) || release.descriptionHTML,
    releaseAssets: release.releaseAssets?.map(apiReleaseAsset)
  }
}

export function moduleJson (module: ModuleRecord): Record<string, unknown> {
  const {
    fingerprint,
    isModule,
    defaultBranchOid,
    readmeOid,
    latestRelease,
    latestBetaRelease,
    latestSnapshotRelease,
    ...publicModule
  } = module
  const readmeHTML = rewriteAssetProxyHtml(module.readmeHTML) || module.readmeHTML

  return {
    ...publicModule,
    readme: undefined,
    readmeHTML,
    releases: module.releases.map(apiRelease),
    collaborators: module.collaborators.map(author => ({
      login: author.login,
      name: author.name ?? null
    })),
    additionalAuthors: module.additionalAuthors
      ? module.additionalAuthors.map(author => ({
          type: author.type ?? null,
          name: author.name ?? null,
          link: author.link ?? null
        }))
      : null,
    latestRelease: latestRelease?.tagName,
    latestBetaRelease: latestBetaRelease && latestBetaRelease.tagName !== latestRelease?.tagName
      ? latestBetaRelease.tagName
      : undefined,
    latestSnapshotRelease: latestSnapshotRelease &&
      latestSnapshotRelease.tagName !== latestRelease?.tagName &&
      latestSnapshotRelease.tagName !== latestBetaRelease?.tagName
      ? latestSnapshotRelease.tagName
      : undefined,
    childGitHubReadme: module.readmeHTML
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
    const publicModule = moduleJson(module)
    const latestRelease = module.latestRelease
    const latestBetaRelease = module.latestBetaRelease
    const latestSnapshotRelease = module.latestSnapshotRelease

    return {
      ...publicModule,
      latestRelease: latestRelease?.tagName,
      latestBetaRelease: latestBetaRelease && latestBetaRelease.tagName !== latestRelease?.tagName
        ? latestBetaRelease.tagName
        : undefined,
      latestSnapshotRelease: latestSnapshotRelease &&
        latestSnapshotRelease.tagName !== latestRelease?.tagName &&
        latestSnapshotRelease.tagName !== latestBetaRelease?.tagName
        ? latestSnapshotRelease.tagName
        : undefined,
      releases: latestRelease ? [apiRelease(latestRelease)] : [],
      betaReleases: latestBetaRelease && latestBetaRelease.tagName !== latestRelease?.tagName
        ? [apiRelease(latestBetaRelease)]
        : undefined,
      snapshotReleases: latestSnapshotRelease &&
        latestSnapshotRelease.tagName !== latestRelease?.tagName &&
        latestSnapshotRelease.tagName !== latestBetaRelease?.tagName
        ? [apiRelease(latestSnapshotRelease)]
        : undefined,
      readme: undefined,
      readmeHTML: undefined,
      childGitHubReadme: undefined
    }
  })
}
