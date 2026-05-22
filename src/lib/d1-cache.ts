import { gzipSync, gunzipSync } from 'node:zlib'
import { safeName } from './cache'

const defaultPrefix = 'modules-cache:v1'
const defaultTtlSeconds = 30 * 24 * 60 * 60
const defaultMaxEntryBytes = 1_500_000
const defaultMaxTotalBytes = 350 * 1024 * 1024

const metadataDatabaseId = '65e5b2d4-c6c3-4c1f-8eb1-17dde6c8a41d'
const readmeDatabaseId = 'd65705d6-c416-43b7-9cc7-f8a7971ce464'
const releaseDatabaseId = '998dbc82-4265-434d-a0ae-8b64cd708405'

let initPromises = new Map<CacheNamespace, Promise<void>>()
let disabledForBuild = false
const cleanupDone = new Set<CacheNamespace>()

interface D1Config {
  accountId: string
  defaultDatabaseId: string
  apiToken: string
  endpoint: string
  prefix: string
  ttlSeconds: number
  maxEntryBytes: number
  maxTotalBytes: number
}

interface D1QueryResult {
  success?: boolean
  results?: Array<Record<string, unknown>>
  meta?: {
    rows_read?: number
    rows_written?: number
    size_after?: number
  }
}

interface D1Response {
  success?: boolean
  result?: D1QueryResult | D1QueryResult[]
  errors?: Array<{ code?: number, message?: string }>
  messages?: unknown[]
}

interface CacheRow {
  key: string
  value_text?: string
  value_gzip_b64?: string
  raw_size?: number
  stored_size?: number
}

interface CacheKeyParts {
  namespace: CacheNamespace
  owner?: string
  repoName?: string
  releaseId?: string
}

export interface D1CacheEntryMetadata {
  owner?: string
  repoName?: string
  releaseId?: string
  fingerprint?: string
}

type CacheNamespace = 'module-record' | 'readme-html' | 'release-html'

function config (): D1Config | null {
  if (disabledForBuild || process.env.D1_CACHE_ENABLED === 'false') return null

  const accountId = process.env.D1_CACHE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID
  const defaultDatabaseId = process.env.D1_CACHE_METADATA_DATABASE_ID ||
    process.env.D1_CACHE_DATABASE_ID ||
    metadataDatabaseId
  const apiToken = process.env.D1_CACHE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || process.env.DIRTY_REPOS_TOKEN
  if (!accountId || !defaultDatabaseId || !apiToken) return null

  return {
    accountId,
    defaultDatabaseId,
    apiToken,
    endpoint: (process.env.D1_CACHE_ENDPOINT || 'https://api.cloudflare.com/client/v4').replace(/\/+$/, ''),
    prefix: process.env.D1_CACHE_PREFIX || defaultPrefix,
    ttlSeconds: positiveInt(process.env.D1_CACHE_TTL_SECONDS, defaultTtlSeconds),
    maxEntryBytes: positiveInt(process.env.D1_CACHE_MAX_ENTRY_BYTES, defaultMaxEntryBytes),
    maxTotalBytes: positiveInt(process.env.D1_CACHE_MAX_TOTAL_BYTES, defaultMaxTotalBytes)
  }
}

export function d1CacheEnabled (): boolean {
  return Boolean(config())
}

export function moduleRecordCacheKey (owner: string, repoName: string, _fingerprint?: string): string {
  return scopedKey('module-record', safeName(owner), safeName(repoName), 'record.json')
}

export function moduleRecordCachePrefix (owner: string, repoName: string): string {
  return scopedPrefix('module-record', safeName(owner), safeName(repoName))
}

export function moduleLatestRecordCacheKey (owner: string, repoName: string): string {
  return moduleRecordCacheKey(owner, repoName)
}

export function readmeHtmlCacheKey (owner: string, repoName: string, version: number): string {
  return scopedKey('readme-html', `v${version}`, safeName(owner), safeName(repoName), 'README.html.json')
}

export function readmeHtmlCachePrefix (owner: string, repoName: string, version: number): string {
  return scopedPrefix('readme-html', `v${version}`, safeName(owner), safeName(repoName))
}

export function releaseHtmlCacheKey (owner: string, repoName: string, releaseId: string, version: number): string {
  return scopedKey('release-html', `v${version}`, safeName(owner), safeName(repoName), `${safeName(releaseId)}.html`)
}

export async function readD1Json<T> (key: string): Promise<T | null> {
  const text = await readD1Text(key)
  if (!text) return null

  try {
    return JSON.parse(text) as T
  } catch (error) {
    console.warn(`[d1-cache] Ignoring invalid JSON ${key}: ${(error as Error).message}`)
    return null
  }
}

export async function readD1JsonMap<T> (keys: string[]): Promise<Map<string, T>> {
  const texts = await readD1TextMap(keys)
  const values = new Map<string, T>()

  for (const [key, text] of texts) {
    try {
      values.set(key, JSON.parse(text) as T)
    } catch (error) {
      console.warn(`[d1-cache] Ignoring invalid JSON ${key}: ${(error as Error).message}`)
    }
  }
  return values
}

export async function writeD1Json (
  key: string,
  namespace: string,
  value: unknown,
  metadata: D1CacheEntryMetadata = {}
): Promise<void> {
  await writeD1Text(key, namespace, `${JSON.stringify(value)}\n`, metadata)
}

export async function readD1Text (key: string): Promise<string | null> {
  const values = await readD1TextMap([key])
  return values.get(key) || null
}

export async function readD1TextMap (keys: string[]): Promise<Map<string, string>> {
  const rows = await readD1Rows(keys)
  const values = new Map<string, string>()

  for (const [key, row] of rows) {
    try {
      values.set(key, decodeValue(row))
    } catch (error) {
      console.warn(`[d1-cache] Ignoring invalid cached value ${key}: ${(error as Error).message}`)
    }
  }
  return values
}

export async function writeD1Text (
  key: string,
  namespace: string,
  value: string,
  metadata: D1CacheEntryMetadata = {}
): Promise<void> {
  const cfg = config()
  if (!cfg || process.env.D1_CACHE_WRITES === 'false') return

  const cacheNamespace = namespaceForKey(key, namespace)
  await ensureD1Cache(cacheNamespace)

  const now = unixNow()
  const expiresAt = now + cfg.ttlSeconds
  const parts = cacheParts(key, cacheNamespace)
  const owner = metadata.owner || parts.owner || ''
  const repoName = metadata.repoName || parts.repoName || ''

  if (cacheNamespace === 'module-record') {
    const storedSize = Buffer.byteLength(value, 'utf8')
    if (storedSize > cfg.maxEntryBytes) {
      console.warn(`[d1-cache] Skipping ${key}; entry is ${storedSize} bytes, limit is ${cfg.maxEntryBytes}`)
      return
    }

    await query(
      cacheNamespace,
      `INSERT INTO module_records
        (cache_key, repo_owner, repo_name, fingerprint, record_json, raw_size, stored_size, created_at, updated_at, accessed_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(repo_owner, repo_name) DO UPDATE SET
        cache_key = excluded.cache_key,
        repo_owner = excluded.repo_owner,
        repo_name = excluded.repo_name,
        fingerprint = excluded.fingerprint,
        record_json = excluded.record_json,
        raw_size = excluded.raw_size,
        stored_size = excluded.stored_size,
        updated_at = excluded.updated_at,
        accessed_at = excluded.accessed_at,
        expires_at = excluded.expires_at`,
      [
        key,
        owner,
        repoName,
        metadata.fingerprint || fingerprintFromRecordJson(value),
        value,
        storedSize,
        storedSize,
        now,
        now,
        now,
        expiresAt
      ]
    )
    return
  }

  const encoded = encodeValue(value)
  const storedSize = Buffer.byteLength(encoded.valueGzipBase64, 'utf8')
  if (storedSize > cfg.maxEntryBytes) {
    console.warn(`[d1-cache] Skipping ${key}; compressed entry is ${storedSize} bytes, limit is ${cfg.maxEntryBytes}`)
    return
  }

  if (cacheNamespace === 'readme-html') {
    await query(
      cacheNamespace,
      `INSERT INTO readme_html
        (cache_key, repo_owner, repo_name, value_gzip_b64, raw_size, stored_size, created_at, updated_at, accessed_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(repo_owner, repo_name) DO UPDATE SET
        cache_key = excluded.cache_key,
        repo_owner = excluded.repo_owner,
        repo_name = excluded.repo_name,
        value_gzip_b64 = excluded.value_gzip_b64,
        raw_size = excluded.raw_size,
        stored_size = excluded.stored_size,
        updated_at = excluded.updated_at,
        accessed_at = excluded.accessed_at,
        expires_at = excluded.expires_at`,
      [key, owner, repoName, encoded.valueGzipBase64, encoded.rawSize, storedSize, now, now, now, expiresAt]
    )
    return
  }

  const releaseId = metadata.releaseId || parts.releaseId || ''
  await query(
    cacheNamespace,
    `INSERT INTO release_html
      (cache_key, repo_owner, repo_name, release_id, value_gzip_b64, raw_size, stored_size, created_at, updated_at, accessed_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(repo_owner, repo_name, release_id) DO UPDATE SET
      cache_key = excluded.cache_key,
      repo_owner = excluded.repo_owner,
      repo_name = excluded.repo_name,
      release_id = excluded.release_id,
      value_gzip_b64 = excluded.value_gzip_b64,
      raw_size = excluded.raw_size,
      stored_size = excluded.stored_size,
      updated_at = excluded.updated_at,
      accessed_at = excluded.accessed_at,
      expires_at = excluded.expires_at`,
    [key, owner, repoName, releaseId, encoded.valueGzipBase64, encoded.rawSize, storedSize, now, now, now, expiresAt]
  )
}

export async function deleteD1KeysByPrefix (
  namespace: string,
  keyPrefix: string,
  keepKeys: string[] = [],
  metadata: D1CacheEntryMetadata = {}
): Promise<void> {
  const cfg = config()
  if (!cfg || process.env.D1_CACHE_WRITES === 'false') return

  const cacheNamespace = namespaceForKey(keyPrefix, namespace)
  await ensureD1Cache(cacheNamespace)

  const parts = cacheParts(keyPrefix, cacheNamespace)
  const owner = metadata.owner || parts.owner
  const repoName = metadata.repoName || parts.repoName
  const uniqueKeepKeys = [...new Set(keepKeys)]

  if (owner && repoName) {
    await deleteByRepo(cacheNamespace, owner, repoName, uniqueKeepKeys)
    return
  }

  const upperBound = `${keyPrefix}\uffff`
  await deleteByKeyRange(cacheNamespace, keyPrefix, upperBound, uniqueKeepKeys)
}

export async function deleteD1ReleaseHtmlExcept (
  owner: string,
  repoName: string,
  keepReleaseIds: string[]
): Promise<void> {
  const cfg = config()
  if (!cfg || process.env.D1_CACHE_WRITES === 'false') return
  await ensureD1Cache('release-html')

  const uniqueReleaseIds = [...new Set(keepReleaseIds.filter(Boolean))]
  if (!uniqueReleaseIds.length) {
    await query('release-html', 'DELETE FROM release_html WHERE repo_owner = ? AND repo_name = ?', [owner, repoName])
    return
  }

  const placeholders = uniqueReleaseIds.map(() => '?').join(', ')
  await query(
    'release-html',
    `DELETE FROM release_html
    WHERE repo_owner = ? AND repo_name = ? AND release_id NOT IN (${placeholders})`,
    [owner, repoName, ...uniqueReleaseIds]
  )
}

export async function cleanupD1Cache (): Promise<void> {
  const cfg = config()
  if (!cfg) return

  for (const cacheNamespace of ['module-record', 'readme-html', 'release-html'] as CacheNamespace[]) {
    if (cleanupDone.has(cacheNamespace)) continue
    cleanupDone.add(cacheNamespace)
    await ensureD1Cache(cacheNamespace)
    await query(cacheNamespace, `DELETE FROM ${tableName(cacheNamespace)} WHERE expires_at < ?`, [unixNow()])
    await enforceTotalBudget(cacheNamespace, cfg.maxTotalBytes)
  }
}

async function readD1Rows (keys: string[]): Promise<Map<string, CacheRow>> {
  const cfg = config()
  const values = new Map<string, CacheRow>()
  if (!cfg || process.env.D1_CACHE_READS === 'false' || keys.length === 0) return values
  await cleanupD1Cache()

  const keysByNamespace = new Map<CacheNamespace, string[]>()
  for (const key of new Set(keys)) {
    const cacheNamespace = namespaceForKey(key)
    keysByNamespace.set(cacheNamespace, [...(keysByNamespace.get(cacheNamespace) || []), key])
  }

  for (const [cacheNamespace, namespaceKeys] of keysByNamespace) {
    await ensureD1Cache(cacheNamespace)
    await readCurrentRows(cacheNamespace, namespaceKeys, values)
  }
  return values
}

async function readCurrentRows (
  cacheNamespace: CacheNamespace,
  keys: string[],
  values: Map<string, CacheRow>
): Promise<void> {
  const now = unixNow()
  for (const chunk of chunkArray(keys, 50)) {
    const placeholders = chunk.map(() => '?').join(', ')
    const result = await query(
      cacheNamespace,
      currentReadSql(cacheNamespace, placeholders),
      [...chunk, now]
    )
    for (const row of rows(result)) {
      const key = stringValue(row.cache_key)
      if (!key) continue
      values.set(key, {
        key,
        value_text: stringValue(row.value_text),
        value_gzip_b64: stringValue(row.value_gzip_b64),
        raw_size: numberValue(row.raw_size),
        stored_size: numberValue(row.stored_size)
      })
    }
  }
}

async function ensureD1Cache (cacheNamespace: CacheNamespace): Promise<void> {
  const existing = initPromises.get(cacheNamespace)
  if (existing) return existing

  const promise = createSchema(cacheNamespace).catch(error => {
    initPromises.delete(cacheNamespace)
    throw error
  })

  initPromises.set(cacheNamespace, promise)
  return promise
}

async function createSchema (cacheNamespace: CacheNamespace): Promise<void> {
  if (cacheNamespace === 'module-record') {
    await query(cacheNamespace, `CREATE TABLE IF NOT EXISTS module_records (
      cache_key TEXT PRIMARY KEY,
      repo_owner TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      record_json TEXT NOT NULL,
      raw_size INTEGER NOT NULL,
      stored_size INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      accessed_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`)
    await query(cacheNamespace, 'CREATE UNIQUE INDEX IF NOT EXISTS idx_module_records_repo ON module_records(repo_owner, repo_name)')
    await query(cacheNamespace, 'CREATE INDEX IF NOT EXISTS idx_module_records_expires ON module_records(expires_at)')
    await query(cacheNamespace, 'CREATE INDEX IF NOT EXISTS idx_module_records_accessed ON module_records(accessed_at)')
    return
  }

  if (cacheNamespace === 'readme-html') {
    await query(cacheNamespace, `CREATE TABLE IF NOT EXISTS readme_html (
      cache_key TEXT PRIMARY KEY,
      repo_owner TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      value_gzip_b64 TEXT NOT NULL,
      raw_size INTEGER NOT NULL,
      stored_size INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      accessed_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`)
    await query(cacheNamespace, 'CREATE UNIQUE INDEX IF NOT EXISTS idx_readme_html_repo ON readme_html(repo_owner, repo_name)')
    await query(cacheNamespace, 'CREATE INDEX IF NOT EXISTS idx_readme_html_expires ON readme_html(expires_at)')
    await query(cacheNamespace, 'CREATE INDEX IF NOT EXISTS idx_readme_html_accessed ON readme_html(accessed_at)')
    return
  }

  await query(cacheNamespace, `CREATE TABLE IF NOT EXISTS release_html (
    cache_key TEXT PRIMARY KEY,
    repo_owner TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    release_id TEXT NOT NULL,
    value_gzip_b64 TEXT NOT NULL,
    raw_size INTEGER NOT NULL,
    stored_size INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    accessed_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`)
  await query(cacheNamespace, 'CREATE UNIQUE INDEX IF NOT EXISTS idx_release_html_release ON release_html(repo_owner, repo_name, release_id)')
  await query(cacheNamespace, 'CREATE INDEX IF NOT EXISTS idx_release_html_repo ON release_html(repo_owner, repo_name)')
  await query(cacheNamespace, 'CREATE INDEX IF NOT EXISTS idx_release_html_expires ON release_html(expires_at)')
  await query(cacheNamespace, 'CREATE INDEX IF NOT EXISTS idx_release_html_accessed ON release_html(accessed_at)')
}

async function enforceTotalBudget (cacheNamespace: CacheNamespace, maxTotalBytes: number): Promise<void> {
  for (let iteration = 0; iteration < 100; iteration++) {
    const total = await cacheTotalBytes(cacheNamespace)
    if (total <= maxTotalBytes) return

    await query(cacheNamespace, `DELETE FROM ${tableName(cacheNamespace)}
      WHERE cache_key IN (
        SELECT cache_key FROM ${tableName(cacheNamespace)}
        ORDER BY accessed_at ASC, updated_at ASC
        LIMIT 100
      )`)
  }
}

async function cacheTotalBytes (cacheNamespace: CacheNamespace): Promise<number> {
  const result = await query(cacheNamespace, `SELECT COALESCE(SUM(stored_size), 0) AS total FROM ${tableName(cacheNamespace)}`)
  const [row] = rows(result)
  return numberValue(row?.total)
}

async function deleteByRepo (
  cacheNamespace: CacheNamespace,
  owner: string,
  repoName: string,
  keepKeys: string[]
): Promise<void> {
  if (!keepKeys.length) {
    await query(cacheNamespace, `DELETE FROM ${tableName(cacheNamespace)} WHERE repo_owner = ? AND repo_name = ?`, [owner, repoName])
    return
  }

  const placeholders = keepKeys.map(() => '?').join(', ')
  await query(
    cacheNamespace,
    `DELETE FROM ${tableName(cacheNamespace)}
    WHERE repo_owner = ? AND repo_name = ? AND cache_key NOT IN (${placeholders})`,
    [owner, repoName, ...keepKeys]
  )
}

async function deleteByKeyRange (
  cacheNamespace: CacheNamespace,
  keyPrefix: string,
  upperBound: string,
  keepKeys: string[]
): Promise<void> {
  if (!keepKeys.length) {
    await query(cacheNamespace, `DELETE FROM ${tableName(cacheNamespace)} WHERE cache_key >= ? AND cache_key < ?`, [keyPrefix, upperBound])
    return
  }

  const placeholders = keepKeys.map(() => '?').join(', ')
  await query(
    cacheNamespace,
    `DELETE FROM ${tableName(cacheNamespace)}
    WHERE cache_key >= ? AND cache_key < ? AND cache_key NOT IN (${placeholders})`,
    [keyPrefix, upperBound, ...keepKeys]
  )
}

async function query (
  cacheNamespace: CacheNamespace,
  sql: string,
  params: unknown[] = []
): Promise<D1QueryResult> {
  const cfg = config()
  if (!cfg) return { success: false, results: [] }

  try {
    const databaseId = databaseIdForNamespace(cacheNamespace, cfg)
    const response = await fetch(`${cfg.endpoint}/accounts/${cfg.accountId}/d1/database/${databaseId}/query`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.apiToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ sql, params })
    })
    const payload = await response.json() as D1Response
    const result = firstResult(payload)

    if (!response.ok || !payload.success || !result.success) {
      const message = payload.errors?.map(error => `${error.code || 'error'} ${error.message || ''}`.trim()).join('; ') ||
        `HTTP ${response.status}`
      throw new Error(message)
    }
    return result
  } catch (error) {
    console.warn(`[d1-cache] Query failed; disabling D1 cache for this build: ${(error as Error).message}`)
    disabledForBuild = true
    return { success: false, results: [] }
  }
}

function currentReadSql (cacheNamespace: CacheNamespace, placeholders: string): string {
  if (cacheNamespace === 'module-record') {
    return `SELECT cache_key, record_json AS value_text, raw_size, stored_size
      FROM module_records
      WHERE cache_key IN (${placeholders}) AND expires_at >= ?`
  }

  if (cacheNamespace === 'readme-html') {
    return `SELECT cache_key, value_gzip_b64, raw_size, stored_size
      FROM readme_html
      WHERE cache_key IN (${placeholders}) AND expires_at >= ?`
  }

  return `SELECT cache_key, value_gzip_b64, raw_size, stored_size
    FROM release_html
    WHERE cache_key IN (${placeholders}) AND expires_at >= ?`
}

function tableName (cacheNamespace: CacheNamespace): string {
  switch (cacheNamespace) {
    case 'module-record':
      return 'module_records'
    case 'readme-html':
      return 'readme_html'
    case 'release-html':
      return 'release_html'
  }
}

function firstResult (payload: D1Response): D1QueryResult {
  if (Array.isArray(payload.result)) return payload.result[0] || { success: false, results: [] }
  return payload.result || { success: false, results: [] }
}

function rows (result: D1QueryResult): Array<Record<string, unknown>> {
  return Array.isArray(result.results) ? result.results : []
}

function encodeValue (value: string): { valueGzipBase64: string, rawSize: number } {
  return {
    valueGzipBase64: gzipSync(value).toString('base64'),
    rawSize: Buffer.byteLength(value, 'utf8')
  }
}

function decodeValue (row: CacheRow): string {
  if (typeof row.value_text === 'string') return row.value_text
  return gunzipSync(Buffer.from(row.value_gzip_b64 || '', 'base64')).toString('utf8')
}

function scopedKey (...parts: string[]): string {
  return [process.env.D1_CACHE_PREFIX || defaultPrefix, ...parts].join(':')
}

function scopedPrefix (...parts: string[]): string {
  return `${scopedKey(...parts)}:`
}

function namespaceForKey (key: string, explicitNamespace?: string): CacheNamespace {
  if (explicitNamespace === 'readme-html' || key.includes(':readme-html:')) return 'readme-html'
  if (explicitNamespace === 'release-html' || key.includes(':release-html:')) return 'release-html'
  return 'module-record'
}

function cacheParts (key: string, fallbackNamespace?: CacheNamespace): CacheKeyParts {
  const prefix = `${process.env.D1_CACHE_PREFIX || defaultPrefix}:`
  if (!key.startsWith(prefix)) return { namespace: fallbackNamespace || namespaceForKey(key) }

  const parts = key.slice(prefix.length).split(':')
  const namespace = namespaceForKey(key, parts[0])
  if (namespace === 'module-record') {
    return {
      namespace,
      owner: parts[1],
      repoName: parts[2]
    }
  }

  if (namespace === 'readme-html') {
    return {
      namespace,
      owner: parts[2],
      repoName: parts[3]
    }
  }

  const releaseFile = parts[4] || ''
  return {
    namespace,
    owner: parts[2],
    repoName: parts[3],
    releaseId: releaseFile.endsWith('.html') ? releaseFile.slice(0, -5) : releaseFile
  }
}

function databaseIdForNamespace (cacheNamespace: CacheNamespace, cfg: D1Config): string {
  switch (cacheNamespace) {
    case 'readme-html':
      return process.env.D1_CACHE_README_DATABASE_ID || readmeDatabaseId
    case 'release-html':
      return process.env.D1_CACHE_RELEASE_DATABASE_ID || releaseDatabaseId
    default:
      return process.env.D1_CACHE_METADATA_DATABASE_ID || cfg.defaultDatabaseId
  }
}

function fingerprintFromRecordJson (value: string): string {
  try {
    const parsed = JSON.parse(value) as { fingerprint?: unknown }
    return typeof parsed.fingerprint === 'string' ? parsed.fingerprint : ''
  } catch {
    return ''
  }
}

function unixNow (): number {
  return Math.floor(Date.now() / 1000)
}

function positiveInt (value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function numberValue (value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function stringValue (value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function chunkArray<T> (items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}
