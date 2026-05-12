import crypto from 'node:crypto'
import { load } from 'cheerio'

const DEFAULT_ASSET_PROXY_BASE = 'https://assets.lsposed.org'
const DEFAULT_ASSET_PROXY_TIMESTAMP = '6a03bf00'
const GITHUB_ATTACHMENT_PATTERN = /^\/[^/]+\/[^/]+\/assets\/\d+\/([0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12})$/
const ASSET_PROXY_ROUTE_PATTERNS = [
  /^\/raw\//,
  /^\/user-images\//,
  /^\/user-attachments\//,
  /^\/release\//
]

interface AssetProxyConfig {
  baseUrl: string
  key: string
  timestamp: string
  signatureParam: string
  timestampParam: string
}

export function proxyAssetUrl (value: string | null | undefined): string | null {
  if (!value) return null

  const config = assetProxyConfig()
  if (!config) return null

  const routePath = proxyRoutePath(value)
  if (!routePath) return null

  return signedAssetUrl(routePath, config)
}

export function rewriteAssetProxyHtml (html: string | null | undefined): string | null | undefined {
  if (!html) return html

  const canonicalHtml = canonicalizeAssetHtml(html)
  const $ = load(html, {}, false)
  if (canonicalHtml !== html) return rewriteAssetProxyHtml(canonicalHtml)

  const config = assetProxyConfig()
  if (!config) return canonicalHtml

  let changed = false
  $('[src], [href], [poster]').each((_, element) => {
    for (const attr of ['src', 'href', 'poster']) {
      const value = $(element).attr(attr)
      if (!value) continue

      const routePath = proxyRoutePath(value)
      if (!routePath) continue

      $(element).attr(attr, signedAssetUrl(routePath, config))
      changed = true
    }
  })

  $('[srcset]').each((_, element) => {
    const srcset = $(element).attr('srcset')
    if (!srcset) return

    const rewritten = rewriteSrcset(srcset, config)
    if (rewritten !== srcset) {
      $(element).attr('srcset', rewritten)
      changed = true
    }
  })

  return changed ? ($.root().html() || html) : html
}

export function canonicalizeAssetHtml (html: string | null | undefined): string | null | undefined {
  if (!html) return html

  const $ = load(html, {}, false)
  let changed = false

  $('img[data-canonical-src], source[data-canonical-src], img[src^="https://camo.githubusercontent.com/"], source[srcset*="https://camo.githubusercontent.com/"]').each((_, element) => {
    const canonical = $(element).attr('data-canonical-src')
    if (!canonical) return

    if ($(element).attr('src')?.startsWith('https://camo.githubusercontent.com/')) {
      $(element).attr('src', canonical)
      changed = true
    }

    const parentLink = $(element).parent('a')
    if (parentLink.attr('href')?.startsWith('https://camo.githubusercontent.com/')) {
      parentLink.attr('href', canonical)
      changed = true
    }

    const srcset = $(element).attr('srcset')
    if (srcset?.includes('https://camo.githubusercontent.com/')) {
      $(element).attr('srcset', srcset.replace(/https:\/\/camo\.githubusercontent\.com\/\S+/g, canonical))
      changed = true
    }
  })

  $('[src], [href], [poster], [data-canonical-src]').each((_, element) => {
    for (const attr of ['src', 'href', 'poster', 'data-canonical-src']) {
      const value = $(element).attr(attr)
      if (!value) continue

      const restored = canonicalAssetUrl(value)
      if (restored && restored !== value) {
        $(element).attr(attr, restored)
        changed = true
      }
    }
  })

  $('[srcset]').each((_, element) => {
    const srcset = $(element).attr('srcset')
    if (!srcset) return

    const rewritten = canonicalizeSrcset(srcset)
    if (rewritten !== srcset) {
      $(element).attr('srcset', rewritten)
      changed = true
    }
  })

  return changed ? ($.root().html() || html) : html
}

function assetProxyConfig (): AssetProxyConfig | null {
  const key = process.env.ASSET_PROXY_KEY?.trim()
  if (!key) return null

  const baseUrl = (process.env.ASSET_PROXY_BASE || DEFAULT_ASSET_PROXY_BASE).trim().replace(/\/+$/, '')
  const timestamp = (process.env.ASSET_PROXY_TIMESTAMP || DEFAULT_ASSET_PROXY_TIMESTAMP).trim().toLowerCase()
  const signatureParam = (process.env.ASSET_PROXY_SIGNATURE_PARAM || 'sign').trim()
  const timestampParam = (process.env.ASSET_PROXY_TIMESTAMP_PARAM || 't').trim()

  if (!/^[0-9a-f]+$/i.test(timestamp) || !signatureParam || !timestampParam) return null

  try {
    const url = new URL(baseUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  } catch {
    return null
  }

  return { baseUrl, key, timestamp, signatureParam, timestampParam }
}

function proxyRoutePath (value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

  switch (url.hostname) {
    case 'raw.githubusercontent.com':
      return `/raw${url.pathname}`
    case 'user-images.githubusercontent.com':
      return `/user-images${url.pathname}`
    case 'github.com':
      return githubRoutePath(url.pathname)
    default:
      return null
  }
}

function canonicalAssetUrl (value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }

  if (url.hostname === 'camo.githubusercontent.com') return null

  const proxyHost = assetProxyBaseHost()
  if (url.hostname === proxyHost && ASSET_PROXY_ROUTE_PATTERNS.some(pattern => pattern.test(url.pathname))) {
    return canonicalRouteUrl(url.pathname)
  }

  return null
}

function assetProxyBaseHost (): string {
  try {
    return new URL(process.env.ASSET_PROXY_BASE || DEFAULT_ASSET_PROXY_BASE).hostname
  } catch {
    return new URL(DEFAULT_ASSET_PROXY_BASE).hostname
  }
}

function canonicalRouteUrl (pathname: string): string | null {
  if (pathname.startsWith('/raw/')) {
    return `https://raw.githubusercontent.com/${pathname.slice('/raw/'.length)}`
  }

  if (pathname.startsWith('/user-images/')) {
    return `https://user-images.githubusercontent.com/${pathname.slice('/user-images/'.length)}`
  }

  if (pathname.startsWith('/user-attachments/')) {
    if (pathname.startsWith('/user-attachments/user-attachments/')) {
      return `https://github.com${pathname.slice('/user-attachments'.length)}`
    }

    return `https://github.com${pathname}`
  }

  if (pathname.startsWith('/release/')) {
    return `https://github.com/${pathname.slice('/release/'.length)}`
  }

  return null
}

function githubRoutePath (pathname: string): string | null {
  if (pathname.startsWith('/user-attachments/assets/')) {
    return pathname
  }

  const attachmentMatch = pathname.match(GITHUB_ATTACHMENT_PATTERN)
  if (attachmentMatch?.[1]) {
    return `/user-attachments/assets/${attachmentMatch[1]}`
  }

  const parts = pathname.split('/').filter(Boolean)
  if (parts.length >= 5 && parts[2] === 'raw') {
    const [owner, repo, , ...assetParts] = parts
    return `/raw/${[owner, repo, ...assetParts].join('/')}`
  }

  if (parts.length >= 6 && parts[2] === 'releases' && parts[3] === 'download') {
    return `/release${pathname}`
  }

  return null
}

function signedAssetUrl (routePath: string, config: AssetProxyConfig): string {
  const digest = crypto
    .createHash('md5')
    .update(`${config.key}${routePath}${config.timestamp}`)
    .digest('hex')

  const target = new URL(routePath, config.baseUrl)
  target.searchParams.set(config.signatureParam, digest)
  target.searchParams.set(config.timestampParam, config.timestamp)
  return target.toString()
}

function rewriteSrcset (srcset: string, config: AssetProxyConfig): string {
  return srcset
    .split(',')
    .map(entry => {
      const parts = entry.trim().split(/\s+/)
      if (!parts[0]) return entry

      const routePath = proxyRoutePath(parts[0])
      if (!routePath) return entry.trim()

      return [signedAssetUrl(routePath, config), ...parts.slice(1)].join(' ')
    })
    .join(', ')
}

function canonicalizeSrcset (srcset: string): string {
  return srcset
    .split(',')
    .map(entry => {
      const parts = entry.trim().split(/\s+/)
      if (!parts[0]) return entry

      const restored = canonicalAssetUrl(parts[0])
      if (!restored) return entry.trim()

      return [restored, ...parts.slice(1)].join(' ')
    })
    .join(', ')
}
