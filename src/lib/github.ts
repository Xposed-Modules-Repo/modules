const endpoint = 'https://api.github.com/graphql'
let lastRequestAt = 0

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

async function throttle (): Promise<void> {
  const delay = Number.parseInt(process.env.GITHUB_REQUEST_DELAY_MS || '750', 10)
  if (!Number.isFinite(delay) || delay <= 0) return

  const wait = Math.max(0, lastRequestAt + delay - Date.now())
  if (wait > 0) await sleep(wait)
  lastRequestAt = Date.now()
}

function maxAttempts (): number {
  const value = Number.parseInt(process.env.GITHUB_RETRY_ATTEMPTS || '6', 10)
  return Number.isFinite(value) && value > 0 ? value : 6
}

function retryDelay (response: Response, body: string, attempt: number): number {
  const retryAfter = Number.parseInt(response.headers.get('retry-after') || '', 10)
  if (!Number.isNaN(retryAfter)) return retryAfter * 1000

  const remaining = Number.parseInt(response.headers.get('x-ratelimit-remaining') || '', 10)
  const resetAt = Number.parseInt(response.headers.get('x-ratelimit-reset') || '', 10)
  if (
    remaining === 0 &&
    !Number.isNaN(resetAt) &&
    body.toLowerCase().includes('api rate limit exceeded')
  ) {
    return Math.max((resetAt * 1000) - Date.now(), 1000)
  }

  if (response.status === 403) {
    return 60_000 + Math.floor(Math.random() * 10_000)
  }

  const baseDelay = Math.min(30_000, 1000 * (2 ** attempt))
  return baseDelay + Math.floor(Math.random() * 750)
}

function shouldRetry (response: Response): boolean {
  return response.status === 403 ||
    response.status === 429 ||
    response.status === 502 ||
    response.status === 503 ||
    response.status === 504 ||
    response.status >= 500
}

function networkRetryDelay (attempt: number): number {
  return Math.min(30_000, 1000 * (2 ** attempt)) + Math.floor(Math.random() * 750)
}

export async function githubGraphql<T> (query: string, variables: Record<string, unknown> = {}): Promise<T> {
  if (!githubToken()) {
    throw new Error('GRAPHQL_TOKEN or GITHUB_TOKEN is required for GitHub GraphQL requests')
  }

  const attempts = maxAttempts()
  for (let attempt = 0; attempt < attempts; attempt++) {
    await throttle()
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
          ...authHeaders()
        },
        body: JSON.stringify({ query, variables })
      })
    } catch (error) {
      if (attempt < attempts - 1) {
        const delay = networkRetryDelay(attempt)
        console.warn(`[github] GraphQL network error; retrying in ${delay} ms: ${(error as Error).message}`)
        await sleep(delay)
        continue
      }
      throw error
    }

    if (response.ok) {
      let payload: { data?: T, errors?: unknown }
      try {
        payload = JSON.parse(await response.text()) as { data?: T, errors?: unknown }
      } catch (error) {
        if (attempt < attempts - 1) {
          const delay = networkRetryDelay(attempt)
          console.warn(`[github] GraphQL response read failed; retrying in ${delay} ms: ${(error as Error).message}`)
          await sleep(delay)
          continue
        }
        throw error
      }
      if (payload.errors) throw new Error(JSON.stringify(payload.errors))
      if (!payload.data) throw new Error('GitHub GraphQL response did not include data')
      return payload.data
    }

    const responseBody = await responseText(response)
    if (shouldRetry(response) && attempt < attempts - 1) {
      const delay = retryDelay(response, responseBody, attempt)
      console.warn(`[github] GraphQL returned ${response.status}; retrying in ${delay} ms`)
      await sleep(delay)
      continue
    }

    throw new Error(`GitHub GraphQL request failed: ${response.status} ${responseBody}`)
  }

  throw new Error('GitHub GraphQL request failed after retries')
}

export async function githubText (url: string, init: RequestInit = {}): Promise<string> {
  const attempts = maxAttempts()
  for (let attempt = 0; attempt < attempts; attempt++) {
    await throttle()
    let response: Response
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          accept: 'application/vnd.github+json',
          ...authHeaders(),
          ...(init.headers || {})
        }
      })
    } catch (error) {
      if (attempt < attempts - 1) {
        const delay = networkRetryDelay(attempt)
        console.warn(`[github] ${url} network error; retrying in ${delay} ms: ${(error as Error).message}`)
        await sleep(delay)
        continue
      }
      throw error
    }

    if (response.ok) {
      try {
        return await response.text()
      } catch (error) {
        if (attempt < attempts - 1) {
          const delay = networkRetryDelay(attempt)
          console.warn(`[github] ${url} response read failed; retrying in ${delay} ms: ${(error as Error).message}`)
          await sleep(delay)
          continue
        }
        throw error
      }
    }

    const responseBody = await responseText(response)
    if (shouldRetry(response) && attempt < attempts - 1) {
      const delay = retryDelay(response, responseBody, attempt)
      console.warn(`[github] ${url} returned ${response.status}; retrying in ${delay} ms`)
      await sleep(delay)
      continue
    }

    throw new Error(`GitHub request failed for ${url}: ${response.status} ${responseBody}`)
  }

  throw new Error(`GitHub request failed for ${url} after retries`)
}

export async function githubRestJson<T> (url: string): Promise<{ data: T, link: string | null }> {
  const attempts = maxAttempts()
  for (let attempt = 0; attempt < attempts; attempt++) {
    await throttle()
    let response: Response
    try {
      response = await fetch(url, {
        headers: {
          accept: 'application/vnd.github+json',
          ...authHeaders()
        }
      })
    } catch (error) {
      if (attempt < attempts - 1) {
        const delay = networkRetryDelay(attempt)
        console.warn(`[github] REST network error; retrying in ${delay} ms: ${(error as Error).message}`)
        await sleep(delay)
        continue
      }
      throw error
    }

    if (response.ok) {
      try {
        return {
          data: JSON.parse(await response.text()) as T,
          link: response.headers.get('link')
        }
      } catch (error) {
        if (attempt < attempts - 1) {
          const delay = networkRetryDelay(attempt)
          console.warn(`[github] REST response read failed; retrying in ${delay} ms: ${(error as Error).message}`)
          await sleep(delay)
          continue
        }
        throw error
      }
    }

    const responseBody = await responseText(response)
    if (shouldRetry(response) && attempt < attempts - 1) {
      const delay = retryDelay(response, responseBody, attempt)
      console.warn(`[github] REST returned ${response.status}; retrying in ${delay} ms`)
      await sleep(delay)
      continue
    }

    throw new Error(`GitHub REST request failed for ${url}: ${response.status} ${responseBody}`)
  }

  throw new Error(`GitHub REST request failed for ${url} after retries`)
}

async function responseText (response: Response): Promise<string> {
  try {
    return await response.text()
  } catch (error) {
    return `Could not read response body: ${(error as Error).message}`
  }
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
