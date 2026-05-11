import type { ModuleRecord } from './types'

export function moduleJson (module: ModuleRecord): Record<string, unknown> {
  const {
    fingerprint,
    isModule,
    defaultBranchOid,
    readmeOid,
    ...publicModule
  } = module

  return publicModule
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
      readmeHTML: undefined
    }
  })
}
