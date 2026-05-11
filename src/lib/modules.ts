import crypto from 'node:crypto'
import { load } from 'cheerio'
import {
  cacheRoot,
  ensureDir,
  pathExists,
  readJson,
  readManifest,
  repoDataPath,
  writeJson,
  writeManifest
} from './cache'
import { githubGraphql, githubRestJson } from './github'
import {
  README_ASSET_VERSION,
  refreshReadmeImageAssets,
  renderReadmeHtml,
  replacePrivateImages,
  restoreMirroredImages
} from './markdown'
import { REPOSITORY_DETAIL_QUERY } from './queries'
import type {
  Author,
  ModuleListItem,
  ModuleRecord,
  ModuleRelease,
  ReleaseAsset,
  SearchRecord,
  SiteData
} from './types'

export const PAGE_SIZE = 30
export const OWNER = process.env.GITHUB_ORG || 'Xposed-Modules-Repo'

let siteDataPromise: Promise<SiteData> | null = null

interface GitObjectRef {
  oid?: string | null
}

interface BlobRef {
  oid?: string | null
  text?: string | null
}

interface AssetNode {
  name: string
  contentType?: string | null
  downloadUrl: string
  downloadCount?: number
  size: number
}

interface ReleaseNode {
  name?: string | null
  url: string
  isDraft: boolean
  description?: string | null
  descriptionHTML?: string | null
  createdAt: string
  publishedAt?: string | null
  updatedAt: string
  tagName: string
  isPrerelease: boolean
  isLatest?: boolean
  releaseAssets?: {
    nodes?: AssetNode[]
  } | null
}

interface RepoNode {
  name: string
  description?: string | null
  url: string
  homepageUrl?: string | null
  updatedAt: string
  createdAt: string
  pushedAt?: string | null
  stargazerCount?: number
  defaultBranchRef?: {
    name?: string | null
    target?: GitObjectRef | null
  } | null
  collaborators?: {
    nodes?: Array<{ login: string, name?: string | null }>
  } | null
  readme?: BlobRef | null
  summary?: BlobRef | null
  scope?: BlobRef | null
  sourceUrl?: BlobRef | null
  hide?: BlobRef | null
  additionalAuthors?: BlobRef | null
  latestRelease?: ReleaseNode | null
  releases?: {
    nodes?: ReleaseNode[]
  } | null
}

interface RestRepoNode {
  name: string
  description?: string | null
  html_url: string
  homepage?: string | null
  updated_at: string
  created_at: string
  pushed_at?: string | null
  stargazers_count?: number
  default_branch?: string | null
}

export async function getSiteData (): Promise<SiteData> {
  siteDataPromise ||= buildSiteData()
  return siteDataPromise
}

export async function getVisibleModules (): Promise<ModuleRecord[]> {
  return (await getSiteData()).modules
}

export async function getModuleByName (name: string): Promise<ModuleRecord | undefined> {
  return (await getSiteData()).modules.find(module => module.name === name)
}

async function buildSiteData (): Promise<SiteData> {
  if (process.env.USE_SAMPLE_DATA === 'true') {
    return sampleSiteData()
  }

  await ensureDir(cacheRoot)

  const manifest = await readManifest(OWNER)
  const dirtyRepos = await dirtyRepoNames()
  const dirtyRepoSet = new Set(dirtyRepos)
  const inventory = await loadInventory(manifest.inventory as Record<string, RepoNode>, dirtyRepos)
  const inventoryByName = Object.fromEntries(inventory.map(repo => [repo.name, repo]))

  manifest.inventory = inventoryByName
  for (const cachedName of Object.keys(manifest.repos)) {
    if (!inventoryByName[cachedName]) delete manifest.repos[cachedName]
  }

  const allModuleRecords: ModuleRecord[] = []
  for (const repo of inventory) {
    const fingerprint = fingerprintRepository(repo)
    const dataPath = repoDataPath(repo.name)
    const cached = manifest.repos[repo.name]
    const forceHydrate = dirtyRepoSet.has(repo.name)
    let record: ModuleRecord | null = null

    if (!forceHydrate && cached?.fingerprint === fingerprint && await pathExists(dataPath)) {
      record = await readJson<ModuleRecord>(dataPath)
      if (record) await restoreCachedReadmeAssets(record, dataPath)
    }

    if (!forceHydrate && !record && await pathExists(dataPath)) {
      const existing = await readJson<ModuleRecord>(dataPath)
      if (existing?.fingerprint === fingerprint) {
        record = existing
        await restoreCachedReadmeAssets(record, dataPath)
      }
    }

    if (!record) {
      if (isPotentialModuleRepository(repo)) {
        try {
          record = await hydrateRepository(repo.name, fingerprint)
        } catch (error) {
          console.warn(`[hydrate] Skipping ${OWNER}/${repo.name}: ${(error as Error).message}`)
          record = minimalRepositoryRecord(repo, fingerprint)
        }
      } else {
        record = minimalRepositoryRecord(repo, fingerprint)
      }
      await writeJson(dataPath, record)
    }

    manifest.repos[repo.name] = {
      fingerprint,
      dataPath,
      readmeOid: record.readmeOid
    }
    await writeManifest(manifest)

    if (record.isModule) allModuleRecords.push(record)
  }

  allModuleRecords.sort(compareModules)
  const records = allModuleRecords.filter(record => !record.hide)

  const listItems = records.map(toListItem)
  return {
    allModules: allModuleRecords,
    modules: records,
    listItems,
    searchRecords: records.map(toSearchRecord),
    pageSize: PAGE_SIZE
  }
}

function sampleSiteData (): SiteData {
  const module: ModuleRecord = {
    name: 'com.example.module',
    description: 'Example Module',
    url: 'https://github.com/Xposed-Modules-Repo/com.example.module',
    homepageUrl: 'https://github.com/Xposed-Modules-Repo/com.example.module',
    collaborators: [{ login: 'example', name: 'Example Author' }],
    readme: '# Example Module\n\nThis page is generated from sample data.',
    readmeOid: 'sample-readme',
    readmeHTML: '<h1>Example Module</h1><p>This page is generated from sample data.</p>',
    readmeAssetVersion: README_ASSET_VERSION,
    summary: 'This page is generated from sample data.',
    sourceUrl: 'https://github.com/Xposed-Modules-Repo/com.example.module',
    hide: false,
    additionalAuthors: null,
    scope: null,
    releases: [{
      name: '1.0.0',
      url: 'https://github.com/Xposed-Modules-Repo/com.example.module/releases/tag/1-1.0.0',
      isDraft: false,
      description: 'Initial release',
      descriptionHTML: '<p>Initial release</p>',
      createdAt: '2026-01-01T00:00:00Z',
      publishedAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      tagName: '1-1.0.0',
      isPrerelease: false,
      isLatest: true,
      releaseAssets: [{
        name: 'example.apk',
        contentType: 'application/vnd.android.package-archive',
        downloadUrl: 'https://github.com/Xposed-Modules-Repo/com.example.module/releases/download/1-1.0.0/example.apk',
        downloadCount: 0,
        size: 1024
      }]
    }],
    latestReleaseTime: '2026-01-01T00:00:00Z',
    latestBetaReleaseTime: '2026-01-01T00:00:00Z',
    latestSnapshotReleaseTime: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    pushedAt: '2026-01-01T00:00:00Z',
    stargazerCount: 0,
    defaultBranch: 'main',
    defaultBranchOid: 'sample',
    fingerprint: 'sample',
    isModule: true
  }

  module.latestRelease = module.releases[0]
  module.latestBetaRelease = module.releases[0]
  module.latestSnapshotRelease = module.releases[0]

  return {
    allModules: [module],
    modules: [module],
    listItems: [toListItem(module)],
    searchRecords: [toSearchRecord(module)],
    pageSize: PAGE_SIZE
  }
}

async function loadInventory (cachedInventory: Record<string, RepoNode>, dirtyRepos: string[]): Promise<RepoNode[]> {
  if (dirtyRepos.length && Object.keys(cachedInventory).length) {
    const next = new Map(Object.entries(cachedInventory))
    for (const name of dirtyRepos) {
      console.log(`[inventory] Refreshing dirty repo ${OWNER}/${name}`)
      const repo = await fetchRepositoryInventory(name)
      if (repo) next.set(name, repo)
      else next.delete(name)
    }
    return [...next.values()]
  }

  return fetchOrganizationInventory()
}

async function dirtyRepoNames (): Promise<string[]> {
  const values = [process.env.REPO, process.env.DIRTY_REPOS]
    .filter(Boolean)
    .flatMap(value => String(value).split(','))
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => value.includes('/') ? value.split('/').pop() || value : value)

  const endpoint = process.env.DIRTY_REPOS_ENDPOINT
  if (endpoint) {
    try {
      const response = await fetch(endpoint, {
        headers: process.env.DIRTY_REPOS_TOKEN
          ? { authorization: `Bearer ${process.env.DIRTY_REPOS_TOKEN}` }
          : {}
      })
      if (response.ok) {
        const payload = await response.json() as { dirtyRepos?: string[] }
        values.push(...(payload.dirtyRepos || []).map(value => value.includes('/') ? value.split('/').pop() || value : value))
      } else {
        console.warn(`[inventory] Dirty repo endpoint returned ${response.status}`)
      }
    } catch (error) {
      console.warn(`[inventory] Dirty repo endpoint failed: ${(error as Error).message}`)
    }
  }

  return [...new Set(values)]
}

async function fetchOrganizationInventory (): Promise<RepoNode[]> {
  const repos: RepoNode[] = []
  let hasNextPage = true
  let page = 1
  const pageSize = Math.max(1, Math.min(100, Number.parseInt(process.env.GITHUB_INVENTORY_PAGE_SIZE || '100', 10)))

  while (hasNextPage) {
    console.log(`[inventory] Querying ${OWNER}, page ${page}`)
    const url = `https://api.github.com/orgs/${encodeURIComponent(OWNER)}/repos?type=public&sort=updated&direction=desc&per_page=${pageSize}&page=${page}`
    const { data, link } = await githubRestJson<RestRepoNode[]>(url)

    repos.push(...data.map(restRepoToRepoNode))
    hasNextPage = Boolean(link?.includes('rel="next"')) && data.length > 0
    page++
  }

  return repos
}

async function fetchRepositoryInventory (name: string): Promise<RepoNode | null> {
  const url = `https://api.github.com/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(name)}`
  try {
    const { data } = await githubRestJson<RestRepoNode>(url)
    return restRepoToRepoNode(data)
  } catch (error) {
    if ((error as Error).message.includes(': 404 ')) return null
    throw error
  }
}

async function hydrateRepository (name: string, fingerprint: string): Promise<ModuleRecord> {
  console.log(`[hydrate] Fetching ${OWNER}/${name}`)
  const data = await githubGraphql<{ repository?: RepoNode | null }>(REPOSITORY_DETAIL_QUERY, {
    owner: OWNER,
    name
  })

  if (!data.repository) throw new Error(`Repository not found: ${OWNER}/${name}`)
  return parseRepository(data.repository, fingerprint)
}

async function parseRepository (repo: RepoNode, fingerprint: string): Promise<ModuleRecord> {
  const releases = normalizeReleases(repo)
  const record: ModuleRecord = {
    name: repo.name,
    description: repo.description,
    url: repo.url,
    homepageUrl: repo.homepageUrl,
    collaborators: (repo.collaborators?.nodes || []).map(node => ({
      login: node.login,
      name: node.name
    })),
    readme: repo.readme?.text,
    readmeOid: repo.readme?.oid,
    readmeHTML: null,
    summary: repo.summary?.text ? truncate(repo.summary.text.trim(), 512) : null,
    sourceUrl: repo.sourceUrl?.text ? repo.sourceUrl.text.replace(/[\r\n]/g, '').trim() : null,
    hide: Boolean(repo.hide),
    additionalAuthors: parseAdditionalAuthors(repo.additionalAuthors?.text),
    scope: parseJsonOrNull(repo.scope?.text),
    releases,
    latestReleaseTime: '1970-01-01T00:00:00Z',
    latestBetaReleaseTime: '1970-01-01T00:00:00Z',
    latestSnapshotReleaseTime: '1970-01-01T00:00:00Z',
    updatedAt: repo.updatedAt,
    createdAt: repo.createdAt,
    pushedAt: repo.pushedAt,
    stargazerCount: repo.stargazerCount,
    defaultBranch: repo.defaultBranchRef?.name,
    defaultBranchOid: repo.defaultBranchRef?.target?.oid,
    fingerprint,
    isModule: false
  }

  record.isModule = Boolean(
    record.name.match(/\./) &&
    record.description &&
    record.releases.length &&
    record.name !== 'org.meowcat.example' &&
    record.name !== '.github'
  )

  if (record.isModule) {
    assignLatestReleases(record)
  }

  if (record.readme && record.readmeOid) {
    record.readmeHTML = await renderReadmeHtml(
      OWNER,
      record.name,
      record.readme,
      record.readmeOid,
      record.defaultBranchOid || 'HEAD'
    )
    record.readmeAssetVersion = README_ASSET_VERSION
  }

  console.log(`[repo] ${repo.name}, module=${record.isModule}`)
  return record
}

function normalizeReleases (repo: RepoNode): ModuleRelease[] {
  const rawReleases = [
    ...(repo.latestRelease ? [repo.latestRelease] : []),
    ...(repo.releases?.nodes || [])
  ]

  return rawReleases
    .filter(release => {
      const assets = release.releaseAssets?.nodes || []
      return !release.isLatest &&
        !release.isDraft &&
        /^\d+-.+$/.test(release.tagName) &&
        assets.some(asset => asset.contentType === 'application/vnd.android.package-archive')
    })
    .map(release => ({
      name: release.name,
      url: release.url,
      isDraft: release.isDraft,
      description: release.description,
      descriptionHTML: replacePrivateImages(release.description, release.descriptionHTML),
      createdAt: release.createdAt,
      publishedAt: release.publishedAt,
      updatedAt: release.updatedAt,
      tagName: release.tagName,
      isPrerelease: release.isPrerelease,
      releaseAssets: (release.releaseAssets?.nodes || []).map(toReleaseAsset)
    }))
}

function toReleaseAsset (asset: AssetNode): ReleaseAsset {
  return {
    name: asset.name,
    contentType: asset.contentType,
    downloadUrl: asset.downloadUrl,
    downloadCount: asset.downloadCount,
    size: asset.size
  }
}

function restRepoToRepoNode (repo: RestRepoNode): RepoNode {
  return {
    name: repo.name,
    description: repo.description,
    url: repo.html_url,
    homepageUrl: repo.homepage,
    updatedAt: repo.updated_at,
    createdAt: repo.created_at,
    pushedAt: repo.pushed_at,
    stargazerCount: repo.stargazers_count,
    defaultBranchRef: repo.default_branch
      ? {
          name: repo.default_branch,
          target: null
        }
      : null
  }
}

function isPotentialModuleRepository (repo: RepoNode): boolean {
  return Boolean(
    repo.name.match(/\./) &&
    repo.description &&
    repo.name !== 'org.meowcat.example' &&
    repo.name !== '.github'
  )
}

function minimalRepositoryRecord (repo: RepoNode, fingerprint: string): ModuleRecord {
  return {
    name: repo.name,
    description: repo.description,
    url: repo.url,
    homepageUrl: repo.homepageUrl,
    collaborators: [],
    readme: null,
    readmeOid: null,
    readmeHTML: null,
    summary: null,
    sourceUrl: null,
    hide: false,
    additionalAuthors: null,
    scope: null,
    releases: [],
    latestReleaseTime: '1970-01-01T00:00:00Z',
    latestBetaReleaseTime: '1970-01-01T00:00:00Z',
    latestSnapshotReleaseTime: '1970-01-01T00:00:00Z',
    updatedAt: repo.updatedAt,
    createdAt: repo.createdAt,
    pushedAt: repo.pushedAt,
    stargazerCount: repo.stargazerCount,
    defaultBranch: repo.defaultBranchRef?.name,
    defaultBranchOid: repo.defaultBranchRef?.target?.oid,
    fingerprint,
    isModule: false
  }
}

async function restoreCachedReadmeAssets (record: ModuleRecord, dataPath: string): Promise<void> {
  if (!record.readmeHTML) return

  await restoreMirroredImages(record.readmeHTML)
  if (
    record.readmeAssetVersion === README_ASSET_VERSION ||
    !record.readme ||
    !record.readmeHTML.includes('\\')
  ) {
    return
  }

  const refreshedHtml = await refreshReadmeImageAssets(
    OWNER,
    record.name,
    record.readme,
    record.readmeHTML,
    record.defaultBranchOid || 'HEAD'
  )

  record.readmeHTML = refreshedHtml
  record.readmeAssetVersion = README_ASSET_VERSION
  await writeJson(dataPath, record)
}

function assignLatestReleases (record: ModuleRecord): void {
  const latest = record.releases.find(release => !release.isPrerelease)
  if (latest) {
    latest.isLatest = true
    record.latestRelease = latest
    record.latestReleaseTime = latest.publishedAt || latest.updatedAt
  }

  const latestBeta = record.releases.find(release =>
    release.isPrerelease && !release.name?.match(/^(snapshot|nightly).*/i)
  ) || latest
  if (latestBeta) {
    latestBeta.isLatestBeta = true
    record.latestBetaRelease = latestBeta
    record.latestBetaReleaseTime = latestBeta.publishedAt || latestBeta.updatedAt
  }

  const latestSnapshot = record.releases.find(release =>
    release.isPrerelease && release.name?.match(/^(snapshot|nightly).*/i)
  ) || latestBeta
  if (latestSnapshot) {
    latestSnapshot.isLatestSnapshot = true
    record.latestSnapshotRelease = latestSnapshot
    record.latestSnapshotReleaseTime = latestSnapshot.publishedAt || latestSnapshot.updatedAt
  }
}

function fingerprintRepository (repo: RepoNode): string {
  return sha256(stableJson({
    name: repo.name,
    description: repo.description,
    homepageUrl: repo.homepageUrl,
    updatedAt: repo.updatedAt,
    pushedAt: repo.pushedAt,
    defaultBranchOid: repo.defaultBranchRef?.target?.oid,
    readmeOid: repo.readme?.oid,
    summaryOid: repo.summary?.oid,
    scopeOid: repo.scope?.oid,
    sourceUrlOid: repo.sourceUrl?.oid,
    hideOid: repo.hide?.oid,
    additionalAuthorsOid: repo.additionalAuthors?.oid,
    latestRelease: compactRelease(repo.latestRelease),
    releases: (repo.releases?.nodes || []).map(compactRelease)
  }))
}

function compactRelease (release?: ReleaseNode | null): unknown {
  if (!release) return null
  return {
    name: release.name,
    tagName: release.tagName,
    isDraft: release.isDraft,
    isPrerelease: release.isPrerelease,
    isLatest: release.isLatest,
    publishedAt: release.publishedAt,
    updatedAt: release.updatedAt,
    assets: (release.releaseAssets?.nodes || []).map(asset => ({
      name: asset.name,
      contentType: asset.contentType,
      downloadUrl: asset.downloadUrl,
      size: asset.size
    }))
  }
}

function stableJson (value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys (value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, sortKeys(child)])
  )
}

function sha256 (value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function parseAdditionalAuthors (text?: string | null): Author[] | null {
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed)) return null
    return parsed
      .filter(value => value && typeof value === 'object')
      .map(value => {
        const source = value as Record<string, unknown>
        const author: Author = {}
        for (const key of ['type', 'name', 'link'] as const) {
          if (typeof source[key] === 'string') author[key] = source[key] as string
        }
        return author
      })
  } catch {
    return null
  }
}

function parseJsonOrNull (text?: string | null): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function truncate (text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1).trim()}...`
}

function compareModules (left: ModuleRecord, right: ModuleRecord): number {
  return right.latestReleaseTime.localeCompare(left.latestReleaseTime) ||
    right.latestBetaReleaseTime.localeCompare(left.latestBetaReleaseTime) ||
    left.name.localeCompare(right.name)
}

function toListItem (module: ModuleRecord): ModuleListItem {
  return {
    name: module.name,
    description: module.description,
    summary: module.summary || excerptFromHtml(module.readmeHTML, 250),
    url: module.url,
    homepageUrl: module.homepageUrl,
    sourceUrl: module.sourceUrl || module.url,
    latestRelease: module.latestRelease?.tagName,
    latestBetaRelease: module.latestBetaRelease?.tagName !== module.latestRelease?.tagName
      ? module.latestBetaRelease?.tagName
      : undefined,
    latestSnapshotRelease: module.latestSnapshotRelease?.tagName !== module.latestBetaRelease?.tagName &&
      module.latestSnapshotRelease?.tagName !== module.latestRelease?.tagName
      ? module.latestSnapshotRelease?.tagName
      : undefined,
    latestReleaseTime: module.latestReleaseTime,
    latestBetaReleaseTime: module.latestBetaReleaseTime,
    latestSnapshotReleaseTime: module.latestSnapshotReleaseTime
  }
}

function toSearchRecord (module: ModuleRecord): SearchRecord {
  return {
    name: module.name,
    description: module.description,
    summary: module.summary,
    readmeExcerpt: excerptFromHtml(module.readmeHTML, 250),
    release: module.releases[0]?.description || null,
    authors: [
      ...module.collaborators.map(author => `${author.name || author.login} (@${author.login})`),
      ...(module.additionalAuthors || []).map(author => author.name || author.link || '')
    ].filter(Boolean).join(', ')
  }
}

function excerptFromHtml (html?: string | null, length = 250): string | null {
  if (!html) return null
  const text = load(html).text().replace(/\s+/g, ' ').trim()
  return text ? truncate(text, length) : null
}
