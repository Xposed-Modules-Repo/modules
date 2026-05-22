import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { load } from 'cheerio'
import {
  cacheRoot,
  ensureDir,
  pathExists,
  readJson,
  readManifest,
  repoDataPath,
  renderedReadmePath,
  writeJson,
  writeManifest
} from './cache'
import { githubGraphql, githubRestJson } from './github'
import { canonicalizeAssetHtml, proxyAssetUrl } from './asset-proxy'
import {
  README_ASSET_VERSION,
  normalizeReadmeAssetHtml,
  renderReadmeHtml,
  replacePrivateImages
} from './markdown'
import {
  cleanupD1Cache,
  deleteD1KeysByPrefix,
  moduleLatestRecordCacheKey,
  moduleRecordCacheKey,
  moduleRecordCachePrefix,
  readD1TextMap,
  readD1Json,
  readD1JsonMap,
  readmeHtmlCacheKey,
  readmeHtmlCachePrefix,
  releaseHtmlCacheKey,
  releaseHtmlCachePrefix,
  writeD1Text,
  writeD1Json
} from './d1-cache'
import { REPOSITORY_DETAIL_QUERY, repositoryDetailBatchQuery } from './queries'
import type {
  Author,
  Collaborator,
  ModuleListItem,
  ModuleRecord,
  ModuleRelease,
  ReleaseAsset,
  SearchRecord,
  SiteData
} from './types'

export const PAGE_SIZE = 30
export const OWNER = process.env.GITHUB_ORG || 'Xposed-Modules-Repo'
const RELEASE_HTML_ASSET_VERSION = 1
const GITHUB_ASSET_TEXT_URL_PATTERN = /https?:\/\/(?:raw\.githubusercontent\.com|user-images\.githubusercontent\.com|avatars\.githubusercontent\.com|camo\.githubusercontent\.com|github\.com\/(?:user-attachments|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/assets\/))[^\s<>'"`()[\]|]+/g
const FORMAT_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g

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
    nodes?: Array<{ login: string, name?: string | null, avatarUrl?: string | null }>
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

interface HydrationTask {
  repo: RepoNode
  fingerprint: string
  dataPath: string
}

type LegacyModuleRecord = ModuleRecord & {
  readme?: string | null
}

type LegacyModuleRelease = ModuleRelease & {
  description?: string | null
  descriptionHTMLCacheKey?: string | null
}

type D1CachedModuleRelease = ModuleRelease & {
  descriptionHTMLCacheKey?: string | null
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

  const recordsByName = new Map<string, ModuleRecord>()
  const repoStates: HydrationTask[] = []
  const hydrationTasks: HydrationTask[] = []
  const remoteCacheTasks: HydrationTask[] = []

  for (const repo of inventory) {
    const fingerprint = fingerprintRepository(repo)
    const dataPath = repoDataPath(repo.name)
    const state = { repo, fingerprint, dataPath }
    repoStates.push(state)

    const cached = manifest.repos[repo.name]
    const forceHydrate = dirtyRepoSet.has(repo.name)
    let record: ModuleRecord | null = null

    if (!forceHydrate && cached?.fingerprint === fingerprint && await pathExists(dataPath)) {
      record = await readJson<ModuleRecord>(dataPath)
      if (record) await refreshCachedModuleRecord(record, dataPath)
    }

    if (!forceHydrate && !record && await pathExists(dataPath)) {
      const existing = await readJson<ModuleRecord>(dataPath)
      if (existing?.fingerprint === fingerprint) {
        record = existing
        await refreshCachedModuleRecord(record, dataPath)
      }
    }

    if (!record) {
      if (isPotentialModuleRepository(repo)) {
        if (forceHydrate) hydrationTasks.push(state)
        else remoteCacheTasks.push(state)
        continue
      }
      record = minimalRepositoryRecord(repo, fingerprint)
      await writeJson(dataPath, record)
    }

    recordsByName.set(repo.name, record)
  }

  await restoreD1CachedRepositories(remoteCacheTasks, recordsByName, hydrationTasks)
  await hydrateRepositories(hydrationTasks, recordsByName)

  const allModuleRecords: ModuleRecord[] = []
  for (const { repo, fingerprint, dataPath } of repoStates) {
    const record = recordsByName.get(repo.name) || minimalRepositoryRecord(repo, fingerprint)
    manifest.repos[repo.name] = {
      fingerprint: record.fingerprint || fingerprint,
      dataPath,
      readmeOid: record.readmeOid
    }
    if (record.isModule) allModuleRecords.push(record)
  }
  await writeManifest(manifest)

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
    collaborators: [{ login: 'example', name: 'Example Author', avatarUrl: 'https://avatars.githubusercontent.com/example' }],
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
  try {
    // Partial builds still need fresh REST inventory; otherwise one missed webhook can keep unrelated cached pages stale.
    const repos = await fetchOrganizationInventory()
    if (!dirtyRepos.length) return repos

    const next = new Map(repos.map(repo => [repo.name, repo]))
    for (const name of dirtyRepos) {
      if (next.has(name)) continue

      console.log(`[inventory] Dirty repo ${OWNER}/${name} was not in org inventory; refreshing directly`)
      const repo = await fetchRepositoryInventory(name)
      if (repo) next.set(name, repo)
    }
    return [...next.values()]
  } catch (error) {
    if (!dirtyRepos.length || !Object.keys(cachedInventory).length) throw error

    console.warn(`[inventory] Full inventory refresh failed; falling back to dirty-only refresh: ${(error as Error).message}`)
    const next = new Map(Object.entries(cachedInventory))
    for (const name of dirtyRepos) {
      console.log(`[inventory] Refreshing dirty repo ${OWNER}/${name}`)
      const repo = await fetchRepositoryInventory(name)
      if (repo) next.set(name, repo)
      else next.delete(name)
    }
    return [...next.values()]
  }
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

async function restoreD1CachedRepositories (
  tasks: HydrationTask[],
  recordsByName: Map<string, ModuleRecord>,
  hydrationTasks: HydrationTask[]
): Promise<void> {
  if (!tasks.length) return

  await cleanupD1Cache()
  const keysByRepo = new Map(tasks.map(task => [
    task.repo.name,
    moduleRecordCacheKey(OWNER, task.repo.name, task.fingerprint)
  ]))
  const records = await readD1JsonMap<ModuleRecord>([...keysByRepo.values()])

  for (const task of tasks) {
    const key = keysByRepo.get(task.repo.name)
    const record = key ? records.get(key) : null
    if (record?.fingerprint === task.fingerprint) {
      console.log(`[d1-cache] Restored ${OWNER}/${task.repo.name} from D1`)
      await restoreD1CachedReadme(record)
      await restoreD1CachedReleaseHtml(record)
      await writeJson(task.dataPath, record)
      await refreshCachedModuleRecord(record, task.dataPath)
      recordsByName.set(task.repo.name, record)
      continue
    }

    hydrationTasks.push(task)
  }
}

async function readStaleCachedModuleRecord (repoName: string, dataPath: string): Promise<ModuleRecord | null> {
  const localRecord = await readJson<ModuleRecord>(dataPath)
  if (localRecord) {
    await refreshCachedModuleRecord(localRecord, dataPath)
    return localRecord
  }

  const remoteRecord = await readD1Json<ModuleRecord>(moduleLatestRecordCacheKey(OWNER, repoName))
  if (!remoteRecord) return null

  console.warn(`[d1-cache] Restored stale ${OWNER}/${repoName} from D1 latest cache`)
  await restoreD1CachedReadme(remoteRecord)
  await restoreD1CachedReleaseHtml(remoteRecord)
  await writeJson(dataPath, remoteRecord)
  await refreshCachedModuleRecord(remoteRecord, dataPath)
  return remoteRecord
}

async function writeD1CachedModuleRecord (repoName: string, record: ModuleRecord): Promise<void> {
  if (!record.isModule) return

  const releaseHtmlKeys = await writeD1CachedReleaseHtml(repoName, record)
  await deleteD1KeysByPrefix(
    'release-html',
    releaseHtmlCachePrefix(OWNER, repoName, RELEASE_HTML_ASSET_VERSION),
    releaseHtmlKeys
  )
  await deleteD1KeysByPrefix(
    'readme-html',
    readmeHtmlCachePrefix(OWNER, repoName, README_ASSET_VERSION),
    record.readmeOid ? [readmeHtmlCacheKey(OWNER, repoName, README_ASSET_VERSION)] : []
  )

  const cacheRecord = d1CacheableModuleRecord(record)
  const recordKey = moduleRecordCacheKey(OWNER, repoName, record.fingerprint)
  await writeD1Json(recordKey, 'module-record', cacheRecord)
  await deleteD1KeysByPrefix('module-record', moduleRecordCachePrefix(OWNER, repoName), [recordKey])
  await deleteD1KeysByPrefix('module-record-latest', moduleRecordCachePrefix(OWNER, repoName), [])
}

async function restoreD1CachedReadme (record: ModuleRecord): Promise<void> {
  if (record.readmeHTML || !record.readmeOid) return

  try {
    record.readmeHTML = await renderReadmeHtml(
      OWNER,
      record.name,
      null,
      record.readmeOid,
      record.defaultBranchOid || 'HEAD'
    )
    record.readmeAssetVersion = README_ASSET_VERSION
  } catch (error) {
    console.warn(`[d1-cache] README restore failed for ${OWNER}/${record.name}: ${(error as Error).message}`)
  }
}

function d1CacheableModuleRecord (record: ModuleRecord): ModuleRecord {
  const releases = record.releases.map(release => d1CacheableRelease(record.name, release))

  return {
    ...record,
    readmeHTML: null,
    releases,
    latestRelease: record.latestRelease ? d1CacheableRelease(record.name, record.latestRelease) : undefined,
    latestBetaRelease: record.latestBetaRelease ? d1CacheableRelease(record.name, record.latestBetaRelease) : undefined,
    latestSnapshotRelease: record.latestSnapshotRelease ? d1CacheableRelease(record.name, record.latestSnapshotRelease) : undefined
  }
}

async function writeD1CachedReleaseHtml (repoName: string, record: ModuleRecord): Promise<string[]> {
  const keys = new Set<string>()

  for (const release of record.releases) {
    const key = d1ReleaseHtmlKey(repoName, release)
    if (!key || !release.descriptionHTML) continue

    keys.add(key)
    await writeD1Text(key, 'release-html', release.descriptionHTML)
  }

  return [...keys]
}

async function restoreD1CachedReleaseHtml (record: ModuleRecord): Promise<void> {
  const releases = uniqueRecordReleases(record)
  const keyedReleases = releases
    .map(release => ({
      release,
      key: release.descriptionHTMLCacheKey || d1ReleaseHtmlKey(record.name, release)
    }))
    .filter((entry): entry is { release: D1CachedModuleRelease, key: string } => Boolean(entry.key))

  if (!keyedReleases.length) return

  const htmlByKey = await readD1TextMap([...new Set(keyedReleases.map(entry => entry.key))])
  for (const { release, key } of keyedReleases) {
    const html = htmlByKey.get(key)
    if (html) release.descriptionHTML = html
    delete release.descriptionHTMLCacheKey
  }
}

function d1CacheableRelease (repoName: string, release: ModuleRelease): D1CachedModuleRelease {
  const key = d1ReleaseHtmlKey(repoName, release)
  return {
    ...release,
    descriptionHTML: null,
    descriptionHTMLCacheKey: key
  }
}

function d1ReleaseHtmlKey (repoName: string, release: ModuleRelease): string | null {
  const releaseId = release.id || release.tagName
  if (!releaseId) return null
  return releaseHtmlCacheKey(OWNER, repoName, releaseId, RELEASE_HTML_ASSET_VERSION)
}

function uniqueRecordReleases (record: ModuleRecord): D1CachedModuleRelease[] {
  const releases = [
    ...record.releases,
    record.latestRelease,
    record.latestBetaRelease,
    record.latestSnapshotRelease
  ].filter(Boolean) as D1CachedModuleRelease[]

  const seen = new Set<string>()
  return releases.filter(release => {
    const key = release.descriptionHTMLCacheKey || d1ReleaseHtmlKey(record.name, release) || release.tagName || release.url
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function hydrateRepositories (
  tasks: HydrationTask[],
  recordsByName: Map<string, ModuleRecord>
): Promise<void> {
  const batchSize = detailBatchSize()
  for (const chunk of chunkArray(tasks, batchSize)) {
    const names = chunk.map(task => task.repo.name)
    console.log(`[hydrate] Fetching ${OWNER} detail batch, size=${names.length}`)
    let details: Map<string, RepoNode | null>
    try {
      details = await fetchRepositoryDetails(names)
    } catch (error) {
      console.warn(`[hydrate] Detail batch failed: ${(error as Error).message}`)
      details = new Map()
    }

    for (const task of chunk) {
      let record: ModuleRecord
      try {
        const detail = details.get(task.repo.name)
        if (!detail) throw new Error(`Repository not found: ${OWNER}/${task.repo.name}`)
        record = await parseRepository(detail, task.fingerprint)
      } catch (error) {
        const staleRecord = await readStaleCachedModuleRecord(task.repo.name, task.dataPath)
        if (staleRecord) {
          console.warn(`[hydrate] Using stale cached record for ${OWNER}/${task.repo.name}: ${(error as Error).message}`)
          record = staleRecord
        } else {
          console.warn(`[hydrate] Skipping ${OWNER}/${task.repo.name}: ${(error as Error).message}`)
          record = minimalRepositoryRecord(task.repo, task.fingerprint)
        }
      }

      recordsByName.set(task.repo.name, record)
      await writeJson(task.dataPath, record)
      if (record.fingerprint === task.fingerprint) await writeD1CachedModuleRecord(task.repo.name, record)
    }
  }
}

async function fetchRepositoryDetails (names: string[]): Promise<Map<string, RepoNode | null>> {
  const details = new Map<string, RepoNode | null>()
  if (!names.length) return details

  if (names.length === 1) {
    const data = await githubGraphql<{ repository?: RepoNode | null }>(REPOSITORY_DETAIL_QUERY, {
      owner: OWNER,
      name: names[0]
    })
    details.set(names[0], data.repository || null)
    return details
  }

  try {
    const variables: Record<string, unknown> = { owner: OWNER }
    names.forEach((name, index) => {
      variables[`name${index}`] = name
    })

    const data = await githubGraphql<Record<string, RepoNode | null>>(
      repositoryDetailBatchQuery(names.length),
      variables
    )

    names.forEach((name, index) => {
      details.set(name, data[`repo${index}`] || null)
    })
    return details
  } catch (error) {
    const midpoint = Math.ceil(names.length / 2)
    console.warn(`[hydrate] Splitting failed detail batch of ${names.length}: ${(error as Error).message}`)

    for (const segment of [names.slice(0, midpoint), names.slice(midpoint)]) {
      try {
        for (const [name, repo] of await fetchRepositoryDetails(segment)) {
          details.set(name, repo)
        }
      } catch (segmentError) {
        console.warn(`[hydrate] Detail segment failed: ${(segmentError as Error).message}`)
        for (const name of segment) details.set(name, null)
      }
    }
    return details
  }
}

function detailBatchSize (): number {
  const value = Number.parseInt(process.env.GITHUB_DETAIL_BATCH_SIZE || '20', 10)
  if (!Number.isFinite(value)) return 20
  return Math.max(1, Math.min(50, value))
}

function chunkArray<T> (items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

async function parseRepository (repo: RepoNode, fingerprint: string): Promise<ModuleRecord> {
  const releases = normalizeReleases(repo)
  const record: ModuleRecord = {
    name: repo.name,
    description: repo.description,
    url: repo.url,
    homepageUrl: repo.homepageUrl,
    collaborators: normalizeCollaborators(repo.collaborators?.nodes),
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

  if (record.readmeOid) {
    try {
      record.readmeHTML = await renderReadmeHtml(
        OWNER,
        record.name,
        repo.readme?.text,
        record.readmeOid,
        record.defaultBranchOid || 'HEAD'
      )
      record.readmeAssetVersion = README_ASSET_VERSION
    } catch (error) {
      console.warn(`[repo] README render failed for ${repo.name}: ${(error as Error).message}`)
    }
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
      id: release.id,
      name: release.name,
      url: release.url,
      isDraft: release.isDraft,
      descriptionHTML: canonicalizeAssetHtml(replacePrivateImages(null, release.descriptionHTML)),
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

async function refreshCachedModuleRecord (record: ModuleRecord, dataPath: string): Promise<void> {
  await restoreD1CachedReadme(record)
  await restoreD1CachedReleaseHtml(record)

  const cachedReadme = (record as LegacyModuleRecord).readme
  let changed = refreshCachedCollaborators(record)
  if (refreshCachedHtmlAssets(record, cachedReadme)) changed = true
  await refreshRenderedReadmeHtml(record, cachedReadme)

  if ('readme' in record) {
    delete (record as LegacyModuleRecord).readme
    changed = true
  }

  if (!record.readmeHTML) {
    if (changed) await writeJson(dataPath, record)
    return
  }

  if (record.readmeAssetVersion !== README_ASSET_VERSION) {
    record.readmeAssetVersion = README_ASSET_VERSION
    changed = true
  }

  if (changed) await writeJson(dataPath, record)
}

function refreshCachedCollaborators (record: ModuleRecord): boolean {
  let changed = false
  record.collaborators = record.collaborators.map(author => {
    const name = sanitizeCollaboratorName(author.name)
    if (name !== author.name) changed = true
    return { ...author, name }
  })
  return changed
}

function refreshCachedHtmlAssets (record: ModuleRecord, cachedReadme?: string | null): boolean {
  let changed = false

  const readmeHTML = normalizeReadmeAssetHtml(cachedReadme, record.readmeHTML, {
    owner: OWNER,
    repoName: record.name,
    commitOid: record.defaultBranchOid || 'HEAD'
  })
  if (readmeHTML !== record.readmeHTML) {
    record.readmeHTML = readmeHTML
    changed = true
  }

  for (const release of record.releases) {
    if (refreshCachedReleaseAssets(release)) changed = true
  }

  if (refreshCachedReleaseAssets(record.latestRelease)) changed = true
  if (refreshCachedReleaseAssets(record.latestBetaRelease)) changed = true
  if (refreshCachedReleaseAssets(record.latestSnapshotRelease)) changed = true

  return changed
}

async function refreshRenderedReadmeHtml (record: ModuleRecord, cachedReadme?: string | null): Promise<void> {
  if (!record.readmeOid) return

  const htmlPath = renderedReadmePath(record.name, record.readmeOid)
  if (!await pathExists(htmlPath)) return

  const cachedHtml = await fs.readFile(htmlPath, 'utf8')
  const refreshedHtml = normalizeReadmeAssetHtml(cachedReadme, cachedHtml, {
    owner: OWNER,
    repoName: record.name,
    commitOid: record.defaultBranchOid || 'HEAD'
  }) || cachedHtml
  if (refreshedHtml !== cachedHtml) await fs.writeFile(htmlPath, refreshedHtml, 'utf8')
}

function refreshCachedReleaseAssets (release: ModuleRelease | undefined): boolean {
  if (!release || typeof release !== 'object') return false

  let changed = false
  const cachedRelease = release as LegacyModuleRelease
  const descriptionHTML = canonicalizeAssetHtml(replacePrivateImages(cachedRelease.description, release.descriptionHTML))
  if (descriptionHTML !== release.descriptionHTML) {
    release.descriptionHTML = descriptionHTML
    changed = true
  }

  if ('description' in release) {
    delete cachedRelease.description
    changed = true
  }

  if ('descriptionHTMLCacheKey' in release) {
    delete cachedRelease.descriptionHTMLCacheKey
    changed = true
  }

  if (!release.releaseAssets) return changed

  for (const asset of release.releaseAssets as Array<ReleaseAsset & { proxyDownloadUrl?: unknown }>) {
    if ('proxyDownloadUrl' in asset) {
      delete asset.proxyDownloadUrl
      changed = true
    }
  }

  return changed
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
    id: release.id,
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

function normalizeCollaborators (nodes?: Array<{ login: string, name?: string | null, avatarUrl?: string | null }> | null): Collaborator[] {
  return (nodes || []).map(node => ({
    login: node.login,
    name: sanitizeCollaboratorName(node.name),
    avatarUrl: node.avatarUrl
  }))
}

function sanitizeCollaboratorName (name?: string | null): string | null {
  if (!name) return null

  const cleaned = name
    .replace(FORMAT_CONTROL_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned || looksLikeStructuredPayload(cleaned)) return null
  return cleaned
}

function looksLikeStructuredPayload (value: string): boolean {
  if (/^[{\[]/.test(value)) return true
  if (!/[{}\[\]":,]/.test(value)) return false

  return /(?:^|["'{,])(?:status_code|message|data)(?:["'}:]|$)/i.test(value)
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
        const author: Author = {
          type: null,
          name: null,
          link: null
        }
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
  const firstContributor = module.collaborators[0]
  const firstContributorAvatarUrl = firstContributor
    ? proxyAssetUrl(firstContributor.avatarUrl || `https://avatars.githubusercontent.com/${firstContributor.login}`) ||
      firstContributor.avatarUrl ||
      `https://avatars.githubusercontent.com/${firstContributor.login}`
    : null

  return {
    name: module.name,
    description: module.description,
    summary: module.summary || excerptFromHtml(module.readmeHTML, 250),
    url: module.url,
    homepageUrl: module.homepageUrl,
    sourceUrl: module.sourceUrl || module.url,
    updatedAt: module.updatedAt,
    stargazerCount: module.stargazerCount,
    firstContributor: firstContributor?.name || firstContributor?.login || null,
    firstContributorAvatarUrl,
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
    authors: [
      ...module.collaborators.map(author => `${author.name || author.login} (@${author.login})`),
      ...(module.additionalAuthors || []).map(author => author.name || author.link || '')
    ].filter(Boolean).join(', ')
  }
}

function excerptFromHtml (html?: string | null, length = 250): string | null {
  if (!html) return null
  const text = load(html).text()
    .replace(GITHUB_ASSET_TEXT_URL_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text ? truncate(text, length) : null
}
