export interface Env {
  DEBOUNCER: DurableObjectNamespace
  MODULES_METADATA_CACHE?: D1Database
  MODULES_README_CACHE?: D1Database
  MODULES_RELEASE_CACHE?: D1Database
  GITHUB_WEBHOOK_SECRET?: string
  PAGES_DEPLOY_HOOK_URL?: string
  DIRTY_REPOS_TOKEN?: string
  D1_CACHE_TOKEN?: string
  GITHUB_OWNER?: string
  QUIET_SECONDS?: string
  PENDING_TTL_SECONDS?: string
  LSPOSED_UPDATE_URL?: string
  EDGEONE_SECRET_ID?: string
  EDGEONE_SECRET_KEY?: string
  EDGEONE_ZONE_ID?: string
  EDGEONE_L7_RULE_ID?: string
  EDGEONE_API_HOST?: string
  EDGEONE_TOKEN_RETENTION_DAYS?: string
  EDGEONE_AUTH_PARAM?: string
  EDGEONE_TIME_PARAM?: string
}

interface WebhookPayload {
  repository?: {
    full_name?: string
    name?: string
    owner?: {
      login?: string
      name?: string
    }
  }
}

interface PendingRepos {
  repos: string[]
  triggeredAt: number
}

interface LsposedUpdateInfo {
  version?: string
  versionCode?: number
}

interface EdgeOneReleaseState {
  versionKey: string
  version?: string
  versionCode?: number
  firstSeenAt: number
  lastSeenAt: number
  timeoutSeconds: number
  appliedTimeoutSeconds?: number
  appliedAt?: number
  lastError?: string
}

const EDGEONE_RELEASE_STATE_KEY = 'edgeoneReleaseState'
const DAY_SECONDS = 24 * 60 * 60
const DAY_MS = DAY_SECONDS * 1000
const MAX_AUTH_TIMEOUT_SECONDS = 630_720_000

export default {
  async fetch (request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (isD1QueryPath(url.pathname) && request.method === 'POST') {
      return handleD1Query(request, env, url)
    }

    const id = env.DEBOUNCER.idFromName('global')
    return env.DEBOUNCER.get(id).fetch(request)
  },

  async scheduled (_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const id = env.DEBOUNCER.idFromName('global')
    ctx.waitUntil(env.DEBOUNCER.get(id).fetch(new Request('https://internal/edgeone/refresh', {
      method: 'POST',
      headers: { 'x-internal-scheduled': '1' }
    })))
  }
}

export class WebhookDebouncer {
  constructor (
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {}

  async fetch (request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/webhook' && request.method === 'POST') {
      return this.handleWebhook(request)
    }

    if (url.pathname === '/dirty' && request.method === 'GET') {
      return this.handleDirty(request, url)
    }

    if (url.pathname === '/health') {
      return json({ ok: true })
    }

    if (url.pathname === '/edgeone/refresh' && (request.method === 'GET' || request.method === 'POST')) {
      if (!isInternalScheduled(request) && !isAuthorized(request, this.env.DIRTY_REPOS_TOKEN)) {
        return json({ error: 'unauthorized' }, 401)
      }

      return this.handleEdgeOneRefresh(url.searchParams.get('dry') === '1')
    }

    if (url.pathname === '/edgeone/status' && request.method === 'GET') {
      if (!isAuthorized(request, this.env.DIRTY_REPOS_TOKEN)) {
        return json({ error: 'unauthorized' }, 401)
      }

      return json({
        state: await this.state.storage.get<EdgeOneReleaseState>(EDGEONE_RELEASE_STATE_KEY) || null
      })
    }

    return json({ error: 'not_found' }, 404)
  }

  async alarm (): Promise<void> {
    const scheduledAt = await this.state.storage.get<number>('scheduledAt')
    if (!scheduledAt) return

    if (Date.now() + 500 < scheduledAt) {
      await this.state.storage.setAlarm(scheduledAt)
      return
    }

    const dirtyRepos = await this.state.storage.get<string[]>('dirtyRepos') || []

    if (!dirtyRepos.length) return
    if (!this.env.PAGES_DEPLOY_HOOK_URL) {
      throw new Error('PAGES_DEPLOY_HOOK_URL is not configured')
    }

    const pendingRepos: PendingRepos = {
      repos: dirtyRepos,
      triggeredAt: Date.now()
    }
    await this.state.storage.put('pendingRepos', pendingRepos)
    await this.state.storage.delete(['dirtyRepos', 'scheduledAt'])

    const response = await fetch(this.env.PAGES_DEPLOY_HOOK_URL, { method: 'POST' })
    if (!response.ok) {
      const queuedRepos = await this.state.storage.get<string[]>('dirtyRepos') || []
      await this.state.storage.put('dirtyRepos', [...new Set([...dirtyRepos, ...queuedRepos])].sort())
      await this.state.storage.delete('pendingRepos')
      throw new Error(`Pages deploy hook failed: ${response.status} ${await response.text()}`)
    }

    await this.state.storage.put('lastTriggeredAt', Date.now())
  }

  private async handleWebhook (request: Request): Promise<Response> {
    const body = await request.text()
    if (!await verifyGithubSignature(body, request.headers.get('x-hub-signature-256'), this.env.GITHUB_WEBHOOK_SECRET)) {
      return json({ error: 'invalid_signature' }, 401)
    }

    const payload = JSON.parse(body) as WebhookPayload
    const repoFullName = payload.repository?.full_name
    const repoName = normalizeRepoName(repoFullName, this.env.GITHUB_OWNER)

    if (!repoName) {
      return json({ ok: true, ignored: true })
    }

    const dirtyRepos = new Set(await this.state.storage.get<string[]>('dirtyRepos') || [])
    dirtyRepos.add(repoName)

    const quietMs = Number.parseInt(this.env.QUIET_SECONDS || '120', 10) * 1000
    const scheduledAt = Date.now() + Math.max(quietMs, 10_000)

    await this.state.storage.put('dirtyRepos', [...dirtyRepos].sort())
    await this.state.storage.put('lastEventAt', Date.now())
    await this.state.storage.put('scheduledAt', scheduledAt)
    await this.state.storage.setAlarm(scheduledAt)

    return json({
      ok: true,
      repo: repoName,
      dirtyRepos: [...dirtyRepos].sort(),
      scheduledAt: new Date(scheduledAt).toISOString()
    })
  }

  private async handleDirty (request: Request, url: URL): Promise<Response> {
    if (!isAuthorized(request, this.env.DIRTY_REPOS_TOKEN)) {
      return json({ error: 'unauthorized' }, 401)
    }

    const pending = await this.state.storage.get<PendingRepos>('pendingRepos')
    const ttlMs = Number.parseInt(this.env.PENDING_TTL_SECONDS || '3600', 10) * 1000
    const dirtyRepos = pending && Date.now() - pending.triggeredAt <= ttlMs
      ? pending.repos
      : []

    if (url.searchParams.get('consume') === '1') {
      await this.state.storage.delete('pendingRepos')
    }

    return json({
      dirtyRepos,
      triggeredAt: pending ? new Date(pending.triggeredAt).toISOString() : null
    })
  }

  private async handleEdgeOneRefresh (dryRun: boolean): Promise<Response> {
    try {
      const result = await refreshEdgeOneTokenTimeout(this.env, this.state.storage, dryRun)
      return json(result)
    } catch (error) {
      const previous = await this.state.storage.get<EdgeOneReleaseState>(EDGEONE_RELEASE_STATE_KEY)
      if (previous) {
        await this.state.storage.put(EDGEONE_RELEASE_STATE_KEY, {
          ...previous,
          lastError: (error as Error).message
        })
      }

      return json({ error: (error as Error).message }, 500)
    }
  }
}

function normalizeRepoName (fullName: string | undefined, owner: string | undefined): string | null {
  if (!fullName || !fullName.includes('/')) return null
  const [repoOwner, repoName] = fullName.split('/')
  if (owner && repoOwner !== owner) return null
  return repoName || null
}

async function verifyGithubSignature (
  body: string,
  signature: string | null,
  secret: string | undefined
): Promise<boolean> {
  if (!secret) return true
  if (!signature?.startsWith('sha256=')) return false

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
  const expected = `sha256=${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
  return timingSafeEqual(expected, signature)
}

function timingSafeEqual (left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let result = 0
  for (let index = 0; index < left.length; index++) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return result === 0
}

function isAuthorized (request: Request, token: string | undefined): boolean {
  if (!token) return true
  return request.headers.get('authorization') === `Bearer ${token}`
}

function isInternalScheduled (request: Request): boolean {
  return request.headers.get('x-internal-scheduled') === '1'
}

async function refreshEdgeOneTokenTimeout (
  env: Env,
  storage: DurableObjectStorage,
  dryRun: boolean
): Promise<unknown> {
  const updateInfo = await fetchLsposedUpdateInfo(env)
  const versionKey = getUpdateVersionKey(updateInfo)
  const previous = await storage.get<EdgeOneReleaseState>(EDGEONE_RELEASE_STATE_KEY)
  const now = Date.now()
  const versionChanged = previous?.versionKey !== versionKey
  const firstSeenAt = versionChanged ? now : previous.firstSeenAt
  const retentionDays = parsePositiveInt(env.EDGEONE_TOKEN_RETENTION_DAYS, 7)
  const ageDays = Math.max(0, Math.ceil((now - firstSeenAt) / DAY_MS))
  const timeoutSeconds = Math.min(MAX_AUTH_TIMEOUT_SECONDS, (retentionDays + ageDays) * DAY_SECONDS)
  const configured = isEdgeOneConfigured(env)
  const nextState: EdgeOneReleaseState = {
    versionKey,
    version: updateInfo.version,
    versionCode: updateInfo.versionCode,
    firstSeenAt,
    lastSeenAt: now,
    timeoutSeconds,
    appliedTimeoutSeconds: previous?.appliedTimeoutSeconds,
    appliedAt: previous?.appliedAt
  }

  if (dryRun) {
    return {
      ok: true,
      dryRun,
      configured,
      versionChanged,
      version: updateInfo.version,
      versionCode: updateInfo.versionCode,
      timeoutSeconds,
      timeoutDays: timeoutSeconds / DAY_SECONDS,
      applied: false
    }
  }

  if (!configured) {
    await storage.put(EDGEONE_RELEASE_STATE_KEY, nextState)
    return {
      ok: true,
      configured,
      versionChanged,
      version: updateInfo.version,
      versionCode: updateInfo.versionCode,
      timeoutSeconds,
      timeoutDays: timeoutSeconds / DAY_SECONDS,
      applied: false
    }
  }

  if (previous?.appliedTimeoutSeconds === timeoutSeconds) {
    await storage.put(EDGEONE_RELEASE_STATE_KEY, nextState)
    return {
      ok: true,
      versionChanged,
      version: updateInfo.version,
      versionCode: updateInfo.versionCode,
      timeoutSeconds,
      timeoutDays: timeoutSeconds / DAY_SECONDS,
      applied: false,
      reason: 'unchanged'
    }
  }

  const edgeOneResult = await updateEdgeOneAuthenticationTimeout(env, timeoutSeconds)
  await storage.put(EDGEONE_RELEASE_STATE_KEY, {
    ...nextState,
    appliedTimeoutSeconds: timeoutSeconds,
    appliedAt: now
  })

  return {
    ok: true,
    versionChanged,
    version: updateInfo.version,
    versionCode: updateInfo.versionCode,
    timeoutSeconds,
    timeoutDays: timeoutSeconds / DAY_SECONDS,
    applied: edgeOneResult.changed,
    edgeOne: edgeOneResult
  }
}

async function fetchLsposedUpdateInfo (env: Env): Promise<LsposedUpdateInfo> {
  const updateUrl = env.LSPOSED_UPDATE_URL || 'https://lsposed.zip/update.json'
  const response = await fetch(updateUrl, {
    headers: { accept: 'application/json' },
    cf: { cacheTtl: 0, cacheEverything: false }
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch LSPosed update info: ${response.status}`)
  }

  const payload = await response.json() as LsposedUpdateInfo
  if (typeof payload.versionCode !== 'number' && typeof payload.version !== 'string') {
    throw new Error('LSPosed update info does not include versionCode or version')
  }
  return payload
}

function getUpdateVersionKey (updateInfo: LsposedUpdateInfo): string {
  if (typeof updateInfo.versionCode === 'number') return `versionCode:${updateInfo.versionCode}`
  return `version:${updateInfo.version || ''}`
}

function isEdgeOneConfigured (env: Env): boolean {
  return Boolean(
    env.EDGEONE_SECRET_ID &&
    env.EDGEONE_SECRET_KEY &&
    env.EDGEONE_ZONE_ID &&
    env.EDGEONE_L7_RULE_ID
  )
}

async function updateEdgeOneAuthenticationTimeout (
  env: Env,
  timeoutSeconds: number
): Promise<{ changed: boolean, previousTimeouts: number[], updatedActions: number }> {
  const rule = await describeEdgeOneRule(env)
  const authActions = findAuthenticationActions(
    rule,
    env.EDGEONE_AUTH_PARAM || 'sign',
    env.EDGEONE_TIME_PARAM || 't'
  )

  if (!authActions.length) {
    throw new Error('EdgeOne rule does not contain a matching Authentication action')
  }

  const previousTimeouts = authActions.map(action => action.AuthenticationParameters?.Timeout)
    .filter((value): value is number => typeof value === 'number')
  const changed = previousTimeouts.length !== authActions.length ||
    previousTimeouts.some(timeout => timeout !== timeoutSeconds)

  if (!changed) {
    return { changed: false, previousTimeouts, updatedActions: authActions.length }
  }

  for (const action of authActions) {
    action.AuthenticationParameters ||= {}
    action.AuthenticationParameters.Timeout = timeoutSeconds
  }

  await edgeOneRequest(env, 'ModifyL7AccRule', {
    ZoneId: env.EDGEONE_ZONE_ID,
    Rule: toWritableEdgeOneRule(rule)
  })

  return { changed: true, previousTimeouts, updatedActions: authActions.length }
}

async function describeEdgeOneRule (env: Env): Promise<Record<string, any>> {
  const payload = await edgeOneRequest(env, 'DescribeL7AccRules', {
    ZoneId: env.EDGEONE_ZONE_ID,
    Filters: [
      {
        Name: 'rule-id',
        Values: [env.EDGEONE_L7_RULE_ID]
      }
    ],
    Limit: 1
  }) as { Response?: { Rules?: Array<Record<string, any>> } }

  const rule = payload.Response?.Rules?.find(rule => rule.RuleId === env.EDGEONE_L7_RULE_ID)
  if (!rule) throw new Error('EdgeOne rule was not found')
  return rule
}

function toWritableEdgeOneRule (rule: Record<string, any>): Record<string, any> {
  const writable: Record<string, any> = {
    RuleId: rule.RuleId,
    RuleName: rule.RuleName,
    Status: rule.Status,
    Branches: rule.Branches
  }
  if ('Description' in rule) writable.Description = rule.Description
  return writable
}

function findAuthenticationActions (
  node: unknown,
  authParam: string,
  timeParam: string
): Array<Record<string, any>> {
  const result: Array<Record<string, any>> = []
  walkRuleNode(node, value => {
    if (!isObject(value)) return
    if (value.Name !== 'Authentication') return

    const parameters = isObject(value.AuthenticationParameters) ? value.AuthenticationParameters : undefined
    if (!parameters) return
    if (parameters.AuthParam !== authParam || parameters.TimeParam !== timeParam) return

    result.push(value)
  })
  return result
}

function walkRuleNode (node: unknown, visit: (value: unknown) => void): void {
  visit(node)
  if (Array.isArray(node)) {
    for (const item of node) walkRuleNode(item, visit)
  } else if (isObject(node)) {
    for (const value of Object.values(node)) walkRuleNode(value, visit)
  }
}

function isObject (value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

async function edgeOneRequest (env: Env, action: string, payload: unknown): Promise<unknown> {
  const secretId = requireEnv(env.EDGEONE_SECRET_ID, 'EDGEONE_SECRET_ID')
  const secretKey = requireEnv(env.EDGEONE_SECRET_KEY, 'EDGEONE_SECRET_KEY')
  const host = env.EDGEONE_API_HOST || 'teo.tencentcloudapi.com'
  const service = 'teo'
  const version = '2022-09-01'
  const body = JSON.stringify(payload)
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const signedHeaders = 'content-type;host;x-tc-action'
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    await sha256Hex(body)
  ].join('\n')
  const credentialScope = `${date}/${service}/tc3_request`
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    credentialScope,
    await sha256Hex(canonicalRequest)
  ].join('\n')
  const secretDate = await hmacSha256(`TC3${secretKey}`, date)
  const secretService = await hmacSha256(secretDate, service)
  const secretSigning = await hmacSha256(secretService, 'tc3_request')
  const signature = toHex(await hmacSha256(secretSigning, stringToSign))
  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  const response = await fetch(`https://${host}`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json; charset=utf-8',
      'X-TC-Action': action,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Version': version
    },
    body
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`EdgeOne API ${action} failed: ${response.status} ${text}`)

  const json = JSON.parse(text) as { Response?: { Error?: { Code?: string, Message?: string } } }
  if (json.Response?.Error) {
    throw new Error(`EdgeOne API ${action} failed: ${json.Response.Error.Code || 'Error'} ${json.Response.Error.Message || ''}`.trim())
  }

  return json
}

function requireEnv (value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

function parsePositiveInt (value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

async function sha256Hex (input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return toHex(digest)
}

async function hmacSha256 (key: string | ArrayBuffer, input: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    typeof key === 'string' ? new TextEncoder().encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(input))
}

function toHex (buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function isD1QueryPath (pathname: string): boolean {
  return /^\/accounts\/[^/]+\/d1\/database\/[^/]+\/query$/.test(pathname)
}

async function handleD1Query (request: Request, env: Env, url: URL): Promise<Response> {
  if (!isAuthorized(request, env.D1_CACHE_TOKEN || env.DIRTY_REPOS_TOKEN)) {
    return d1Json({ success: false, errors: [{ message: 'unauthorized' }], result: { success: false, results: [] } }, 401)
  }

  const database = d1DatabaseForRequest(url, env)
  if (!database) {
    return d1Json({ success: false, errors: [{ message: 'D1 database binding is not configured' }], result: { success: false, results: [] } }, 500)
  }

  try {
    const payload = await request.json() as { sql?: unknown, params?: unknown[] }
    if (typeof payload.sql !== 'string') {
      return d1Json({ success: false, errors: [{ message: 'sql is required' }], result: { success: false, results: [] } }, 400)
    }

    const params = Array.isArray(payload.params) ? payload.params : []
    const statement = database.prepare(payload.sql).bind(...params)
    const result = isReadQuery(payload.sql)
      ? await statement.all()
      : await statement.run()
    const resultPayload = result as {
      success?: boolean
      results?: unknown[]
      meta?: unknown
      error?: string
    }
    const success = resultPayload.success !== false

    return d1Json({
      success,
      result: {
        success,
        results: Array.isArray(resultPayload.results) ? resultPayload.results : [],
        meta: resultPayload.meta
      },
      errors: resultPayload.error ? [{ message: resultPayload.error }] : [],
      messages: []
    }, success ? 200 : 500)
  } catch (error) {
    return d1Json({
      success: false,
      result: { success: false, results: [] },
      errors: [{ message: (error as Error).message }]
    }, 500)
  }
}

function d1DatabaseForRequest (url: URL, env: Env): D1Database | undefined {
  const databaseId = url.pathname.split('/')[5]
  switch (databaseId) {
    case '65e5b2d4-c6c3-4c1f-8eb1-17dde6c8a41d':
      return env.MODULES_METADATA_CACHE
    case 'd65705d6-c416-43b7-9cc7-f8a7971ce464':
      return env.MODULES_README_CACHE
    case '998dbc82-4265-434d-a0ae-8b64cd708405':
      return env.MODULES_RELEASE_CACHE
    default:
      return undefined
  }
}

function isReadQuery (sql: string): boolean {
  return /^\s*(?:select|with|pragma)\b/i.test(sql)
}

function d1Json (body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  })
}

function json (body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8'
    }
  })
}
