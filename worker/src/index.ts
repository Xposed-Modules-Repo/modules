export interface Env {
  DEBOUNCER: DurableObjectNamespace
  GITHUB_WEBHOOK_SECRET?: string
  PAGES_DEPLOY_HOOK_URL?: string
  DIRTY_REPOS_TOKEN?: string
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

function json (body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8'
    }
  })
}
