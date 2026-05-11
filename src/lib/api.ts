import type { ModuleRecord } from './types'

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

  return {
    ...publicModule,
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
            html: module.readmeHTML
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
      releases: latestRelease ? [latestRelease] : [],
      betaReleases: latestBetaRelease && latestBetaRelease.tagName !== latestRelease?.tagName
        ? [latestBetaRelease]
        : undefined,
      snapshotReleases: latestSnapshotRelease &&
        latestSnapshotRelease.tagName !== latestRelease?.tagName &&
        latestSnapshotRelease.tagName !== latestBetaRelease?.tagName
        ? [latestSnapshotRelease]
        : undefined,
      readme: undefined,
      readmeHTML: undefined,
      childGitHubReadme: undefined
    }
  })
}
