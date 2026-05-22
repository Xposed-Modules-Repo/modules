import { gzipSync, gunzipSync } from 'node:zlib'
import { safeName } from './cache'

const defaultPrefix = 'modules-cache:v1'
const defaultTtlSeconds = 30 * 24 * 60 * 60
const defaultCleanupIntervalSeconds = 24 * 60 * 60
const defaultMaxEntryBytes = 1_500_000
const defaultMaxTotalBytes = 350 * 1024 * 1024

let initPromise: Promise<void> | null = null
let disabledForBuild = false
let cleanupDone = false

interface D1Config {
  accountId: string
  databaseId: string
  apiToken: string
  endpoint: string
  prefix: string
  ttlSeconds: number
  cleanupIntervalSeconds: number
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
  value_gzip_b64: string
  raw_size?: number
  stored_size?: number
}

function config (): D1Config | null {
  if (disabledForBuild || process.env.D1_CACHE_ENABLED === 'false') return null

  const accountId = process.env.D1_CACHE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID
  const databaseId = process.env.D1_CACHE_DATABASE_ID
  const apiToken = process.env.D1_CACHE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN
  if (!accountId || !databaseId || !apiToken) return null

  return {
    accountId,
    databaseId,
    apiToken,
    endpoint: (process.env.D1_CACHE_ENDPOINT || 'https://api.cloudflare.com/client/v4').replace(/\/+$/, ''),
    prefix: process.env.D1_CACHE_PREFIX || defaultPrefix,
    ttlSeconds: positiveInt(process.env.D1_CACHE_TTL_SECONDS, defaultTtlSeconds),
    cleanupIntervalSeconds: positiveInt(process.env.D1_CACHE_CLEANUP_INTERVAL_SECONDS, defaultCleanupIntervalSeconds),
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

export function releaseHtmlCachePrefix (owner: string, repoName: string, version: number): string {
  return scopedPrefix('release-html', `v${version}`, safeName(owner), safeName(repoName))
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

export async function writeD1Json (key: string, namespace: string, value: unknown): Promise<void> {
  await writeD1Text(key, namespace, `${JSON.stringify(value)}\n`)
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
      console.warn(`[d1-cache] Ignoring invalid compressed value ${key}: ${(error as Error).message}`)
    }
  }
  return values
}

export async function writeD1Text (key: string, namespace: string, value: string): Promise<void> {
  const cfg = config()
  if (!cfg || process.env.D1_CACHE_WRITES === 'false') return
  await ensureD1Cache()

  const encoded = encodeValue(value)
  const storedSize = Buffer.byteLength(encoded.valueGzipBase64, 'utf8')
  if (storedSize > cfg.maxEntryBytes) {
    console.warn(`[d1-cache] Skipping ${key}; compressed entry is ${storedSize} bytes, limit is ${cfg.maxEntryBytes}`)
    return
  }

  const now = unixNow()
  const expiresAt = now + cfg.ttlSeconds
  await query(
    `INSERT INTO cache_entries
      (key, namespace, value_gzip_b64, raw_size, stored_size, created_at, updated_at, accessed_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      namespace = excluded.namespace,
      value_gzip_b64 = excluded.value_gzip_b64,
      raw_size = excluded.raw_size,
      stored_size = excluded.stored_size,
      updated_at = excluded.updated_at,
      accessed_at = excluded.accessed_at,
      expires_at = excluded.expires_at`,
    [key, namespace, encoded.valueGzipBase64, encoded.rawSize, storedSize, now, now, now, expiresAt]
  )
}

export async function deleteD1KeysByPrefix (namespace: string, keyPrefix: string, keepKeys: string[] = []): Promise<void> {
  const cfg = config()
  if (!cfg || process.env.D1_CACHE_WRITES === 'false') return
  await ensureD1Cache()

  const uniqueKeepKeys = [...new Set(keepKeys)]
  const likePrefix = `${escapeSqlLike(keyPrefix)}%`
  if (!uniqueKeepKeys.length) {
    await query(
      "DELETE FROM cache_entries WHERE namespace = ? AND key LIKE ? ESCAPE '\\'",
      [namespace, likePrefix]
    )
    return
  }

  const placeholders = uniqueKeepKeys.map(() => '?').join(', ')
  await query(
    `DELETE FROM cache_entries
    WHERE namespace = ? AND key LIKE ? ESCAPE '\\' AND key NOT IN (${placeholders})`,
    [namespace, likePrefix, ...uniqueKeepKeys]
  )
}

export async function cleanupD1Cache (): Promise<void> {
  const cfg = config()
  if (!cfg || cleanupDone) return
  cleanupDone = true
  await ensureD1Cache()

  const now = unixNow()
  const lastCleanup = await getMetaNumber('last_cleanup')
  if (lastCleanup && now - lastCleanup < cfg.cleanupIntervalSeconds) return

  await query('DELETE FROM cache_entries WHERE expires_at < ?', [now])
  await enforceTotalBudget(cfg.maxTotalBytes)
  await setMetaNumber('last_cleanup', now)
}

async function readD1Rows (keys: string[]): Promise<Map<string, CacheRow>> {
  const cfg = config()
  const values = new Map<string, CacheRow>()
  if (!cfg || process.env.D1_CACHE_READS === 'false' || keys.length === 0) return values
  await ensureD1Cache()
  await cleanupD1Cache()

  const now = unixNow()
  const uniqueKeys = [...new Set(keys)]
  for (const chunk of chunkArray(uniqueKeys, 50)) {
    const placeholders = chunk.map(() => '?').join(', ')
    const result = await query(
      `SELECT key, value_gzip_b64, raw_size, stored_size
      FROM cache_entries
      WHERE key IN (${placeholders}) AND expires_at >= ?`,
      [...chunk, now]
    )
    for (const row of rows(result)) {
      if (typeof row.key === 'string' && typeof row.value_gzip_b64 === 'string') {
        values.set(row.key, {
          key: row.key,
          value_gzip_b64: row.value_gzip_b64,
          raw_size: numberValue(row.raw_size),
          stored_size: numberValue(row.stored_size)
        })
      }
    }
  }
  return values
}

async function ensureD1Cache (): Promise<void> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    await query(`CREATE TABLE IF NOT EXISTS cache_entries (
      key TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      value_gzip_b64 TEXT NOT NULL,
      raw_size INTEGER NOT NULL,
      stored_size INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      accessed_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`)
    await query('CREATE INDEX IF NOT EXISTS idx_cache_entries_expires ON cache_entries(expires_at)')
    await query('CREATE INDEX IF NOT EXISTS idx_cache_entries_namespace_accessed ON cache_entries(namespace, accessed_at)')
    await query(`CREATE TABLE IF NOT EXISTS cache_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`)
  })().catch(error => {
    initPromise = null
    throw error
  })
  return initPromise
}

async function enforceTotalBudget (maxTotalBytes: number): Promise<void> {
  for (let iteration = 0; iteration < 100; iteration++) {
    const total = await cacheTotalBytes()
    if (total <= maxTotalBytes) return

    await query(`DELETE FROM cache_entries
      WHERE key IN (
        SELECT key FROM cache_entries
        ORDER BY accessed_at ASC, updated_at ASC
        LIMIT 100
      )`)
  }
}

async function cacheTotalBytes (): Promise<number> {
  const result = await query('SELECT COALESCE(SUM(stored_size), 0) AS total FROM cache_entries')
  const [row] = rows(result)
  return numberValue(row?.total)
}

async function getMetaNumber (key: string): Promise<number | null> {
  const result = await query('SELECT value FROM cache_meta WHERE key = ?', [key])
  const [row] = rows(result)
  if (typeof row?.value !== 'string') return null
  const value = Number.parseInt(row.value, 10)
  return Number.isFinite(value) ? value : null
}

async function setMetaNumber (key: string, value: number): Promise<void> {
  const now = unixNow()
  await query(
    `INSERT INTO cache_meta (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, String(value), now]
  )
}

async function query (sql: string, params: unknown[] = []): Promise<D1QueryResult> {
  const cfg = config()
  if (!cfg) return { success: false, results: [] }

  try {
    const response = await fetch(`${cfg.endpoint}/accounts/${cfg.accountId}/d1/database/${cfg.databaseId}/query`, {
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
  return gunzipSync(Buffer.from(row.value_gzip_b64, 'base64')).toString('utf8')
}

function scopedKey (...parts: string[]): string {
  return [process.env.D1_CACHE_PREFIX || defaultPrefix, ...parts].join(':')
}

function scopedPrefix (...parts: string[]): string {
  return `${scopedKey(...parts)}:`
}

function escapeSqlLike (value: string): string {
  return value.replace(/[\\%_]/g, character => `\\${character}`)
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

function chunkArray<T> (items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}
