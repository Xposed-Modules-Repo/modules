export interface Author {
  type?: string | null
  name?: string | null
  link?: string | null
}

export interface Collaborator {
  login: string
  name?: string | null
  avatarUrl?: string | null
}

export interface ReleaseAsset {
  name: string
  contentType?: string | null
  downloadUrl: string
  downloadCount?: number
  size: number
}

export interface ModuleRelease {
  id?: string | null
  name?: string | null
  url: string
  isDraft: boolean
  descriptionHTML?: string | null
  createdAt: string
  publishedAt?: string | null
  updatedAt: string
  tagName: string
  isPrerelease: boolean
  isLatest?: boolean
  isLatestBeta?: boolean
  isLatestSnapshot?: boolean
  releaseAssets: ReleaseAsset[]
}

export interface ModuleRecord {
  name: string
  description?: string | null
  url: string
  homepageUrl?: string | null
  collaborators: Collaborator[]
  readmeHTML?: string | null
  readmeAssetVersion?: number
  readmeOid?: string | null
  summary?: string | null
  sourceUrl?: string | null
  hide: boolean
  additionalAuthors?: Author[] | null
  scope?: unknown
  releases: ModuleRelease[]
  latestRelease?: ModuleRelease
  latestBetaRelease?: ModuleRelease
  latestSnapshotRelease?: ModuleRelease
  latestReleaseTime: string
  latestBetaReleaseTime: string
  latestSnapshotReleaseTime: string
  updatedAt: string
  createdAt: string
  pushedAt?: string | null
  stargazerCount?: number
  defaultBranch?: string | null
  defaultBranchOid?: string | null
  fingerprint: string
  isModule: boolean
}

export interface ModuleListItem {
  name: string
  description?: string | null
  summary?: string | null
  url: string
  homepageUrl?: string | null
  sourceUrl?: string | null
  updatedAt: string
  stargazerCount?: number
  firstContributor?: string | null
  firstContributorAvatarUrl?: string | null
  latestRelease?: string
  latestBetaRelease?: string
  latestSnapshotRelease?: string
  latestReleaseTime: string
  latestBetaReleaseTime: string
  latestSnapshotReleaseTime: string
}

export interface SearchRecord {
  name: string
  description?: string | null
  summary?: string | null
  readmeExcerpt?: string | null
  authors?: string | null
}

export interface SiteData {
  allModules: ModuleRecord[]
  modules: ModuleRecord[]
  listItems: ModuleListItem[]
  searchRecords: SearchRecord[]
  pageSize: number
}
