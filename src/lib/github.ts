const endpoint = 'https://api.github.com/graphql'

function githubToken (): string | undefined {
  return process.env.GRAPHQL_TOKEN || process.env.GITHUB_TOKEN
}

function authHeaders (): Record<string, string> {
  const token = githubToken()
  return token ? { authorization: `Bearer ${token}` } : {}
}

async function sleep (ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

function retryDelay (response: Response): number {
  const retryAfter = Number.parseInt(response.headers.get('retry-after') || '', 10)
  if (!Number.isNaN(retryAfter)) return retryAfter * 1000

  const resetAt = Number.parseInt(response.headers.get('x-ratelimit-reset') || '', 10)
  if (!Number.isNaN(resetAt)) return Math.max((resetAt * 1000) - Date.now(), 1000)

  return 1000
}

export async function githubGraphql<T> (query: string, variables: Record<string, unknown> = {}): Promise<T> {
  if (!githubToken()) {
    throw new Error('GRAPHQL_TOKEN or GITHUB_TOKEN is required for GitHub GraphQL requests')
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        ...authHeaders()
      },
      body: JSON.stringify({ query, variables })
    })

    if (response.ok) {
      const payload = await response.json() as { data?: T, errors?: unknown }
      if (payload.errors) throw new Error(JSON.stringify(payload.errors))
      if (!payload.data) throw new Error('GitHub GraphQL response did not include data')
      return payload.data
    }

    if ((response.status === 403 || response.status === 429 || response.status >= 500) && attempt < 2) {
      await sleep(retryDelay(response))
      continue
    }

    throw new Error(`GitHub GraphQL request failed: ${response.status} ${await response.text()}`)
  }

  throw new Error('GitHub GraphQL request failed after retries')
}

export async function githubText (url: string, init: RequestInit = {}): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        ...authHeaders(),
        ...(init.headers || {})
      }
    })

    if (response.ok) return response.text()

    if ((response.status === 403 || response.status === 429 || response.status >= 500) && attempt < 2) {
      await sleep(retryDelay(response))
      continue
    }

    throw new Error(`GitHub request failed for ${url}: ${response.status} ${await response.text()}`)
  }

  throw new Error(`GitHub request failed for ${url} after retries`)
}

export async function githubBuffer (url: string): Promise<Buffer> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, {
      headers: {
        accept: 'application/octet-stream',
        ...authHeaders()
      }
    })

    if (response.ok) return Buffer.from(await response.arrayBuffer())

    if ((response.status === 403 || response.status === 429 || response.status >= 500) && attempt < 2) {
      await sleep(retryDelay(response))
      continue
    }

    throw new Error(`GitHub asset request failed for ${url}: ${response.status} ${await response.text()}`)
  }

  throw new Error(`GitHub asset request failed for ${url} after retries`)
}

export async function renderGithubMarkdown (owner: string, repoName: string, markdown: string): Promise<string> {
  return githubText('https://api.github.com/markdown', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      text: markdown,
      mode: 'gfm',
      context: `${owner}/${repoName}`
    })
  })
}
