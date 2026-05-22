export interface Env {
  DEBOUNCER: DurableObjectNamespace
  MODULES_CACHE?: D1Database
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

export default {
  async fetch (request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (isD1QueryPath(url.pathname) && request.method === 'POST') {
      return handleD1Query(request, env, url)
    }

    const id = env.DEBOUNCER.idFromName('global')
    return env.DEBOUNCER.get(id).fetch(request)
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
      return env.MODULES_METADATA_CACHE || env.MODULES_CACHE
    case 'd65705d6-c416-43b7-9cc7-f8a7971ce464':
      return env.MODULES_README_CACHE || env.MODULES_CACHE
    case '998dbc82-4265-434d-a0ae-8b64cd708405':
      return env.MODULES_RELEASE_CACHE || env.MODULES_CACHE
    default:
      return env.MODULES_CACHE
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
