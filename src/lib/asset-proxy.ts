import crypto from 'node:crypto'
import { load } from 'cheerio'

const DEFAULT_ASSET_PROXY_BASE = 'https://assets.lsposed.org'
const DEFAULT_ASSET_PROXY_TIMESTAMP = '6a03bf00'
const GITHUB_ATTACHMENT_PATTERN = /^\/[^/]+\/[^/]+\/assets\/\d+\/([0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12})$/
const GITHUB_BARE_ASSET_PATTERN = /^\/assets\/([0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12})$/
const ASSET_PROXY_ROUTE_PATTERNS = [
  /^\/raw\//,
  /^\/user-images\//,
  /^\/user-attachments\//,
  /^\/avatars\//,
  /^\/release\//
]

interface AssetProxyConfig {
  baseUrl: string
  key: string
  timestamp: string
  signatureParam: string
  timestampParam: string
}

interface ProxyRouteOptions {
  allowGithubBlob?: boolean
  allowReleaseDownload?: boolean
}

interface ProxyRoute {
  pathname: string
  searchParams?: URLSearchParams
}

export function proxyAssetUrl (value: string | null | undefined): string | null {
  if (!value) return null

  const config = assetProxyConfig()
  if (!config) return null

  const route = proxyRoute(value, { allowReleaseDownload: true })
  if (!route) return null

  return signedAssetUrl(route, config)
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

      const route = proxyRoute(value, {
        allowGithubBlob: attr !== 'href' || isImageLink($, element, value)
      })
      if (!route) continue

      $(element).attr(attr, signedAssetUrl(route, config))
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

function proxyRoute (value: string, options: ProxyRouteOptions = {}): ProxyRoute | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

  let pathname: string | null = null
  switch (url.hostname) {
    case 'raw.githubusercontent.com':
      pathname = `/raw${url.pathname}`
      break
    case 'user-images.githubusercontent.com':
      pathname = `/user-images${url.pathname}`
      break
    case 'avatars.githubusercontent.com':
      pathname = `/avatars${url.pathname}`
      break
    case 'github.com':
      pathname = githubRoutePath(url.pathname, options)
      break
    default:
      return null
  }

  if (!pathname) return null

  return { pathname, searchParams: url.searchParams }
}

function canonicalAssetUrl (value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }

  if (url.hostname === 'camo.githubusercontent.com') return null

  if (url.hostname === 'github.com') {
    const attachmentMatch = url.pathname.match(GITHUB_ATTACHMENT_PATTERN) || url.pathname.match(GITHUB_BARE_ASSET_PATTERN)
    if (attachmentMatch?.[1]) return `https://github.com/user-attachments/assets/${attachmentMatch[1]}`
  }

  const proxyHost = assetProxyBaseHost()
  if (url.hostname === proxyHost && ASSET_PROXY_ROUTE_PATTERNS.some(pattern => pattern.test(url.pathname))) {
    return canonicalRouteUrl(url.pathname, url.searchParams)
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

function canonicalRouteUrl (pathname: string, searchParams?: URLSearchParams): string | null {
  if (pathname.startsWith('/raw/')) {
    return `https://raw.githubusercontent.com/${pathname.slice('/raw/'.length)}${canonicalSearch(searchParams)}`
  }

  if (pathname.startsWith('/user-images/')) {
    return `https://user-images.githubusercontent.com/${pathname.slice('/user-images/'.length)}${canonicalSearch(searchParams)}`
  }

  if (pathname.startsWith('/user-attachments/')) {
    if (pathname.startsWith('/user-attachments/user-attachments/')) {
      return `https://github.com${pathname.slice('/user-attachments'.length)}`
    }

    return `https://github.com${pathname}`
  }

  if (pathname.startsWith('/avatars/')) {
    return `https://avatars.githubusercontent.com/${pathname.slice('/avatars/'.length)}${canonicalSearch(searchParams)}`
  }

  if (pathname.startsWith('/release/')) {
    return `https://github.com/${pathname.slice('/release/'.length)}${canonicalSearch(searchParams)}`
  }

  return null
}

function canonicalSearch (searchParams?: URLSearchParams): string {
  if (!searchParams) return ''

  const params = new URLSearchParams(searchParams)
  params.delete(process.env.ASSET_PROXY_SIGNATURE_PARAM || 'sign')
  params.delete(process.env.ASSET_PROXY_TIMESTAMP_PARAM || 't')
  const search = params.toString()
  return search ? `?${search}` : ''
}

function githubRoutePath (pathname: string, options: ProxyRouteOptions): string | null {
  if (pathname.startsWith('/user-attachments/assets/')) {
    return pathname
  }

  const attachmentMatch = pathname.match(GITHUB_ATTACHMENT_PATTERN) || pathname.match(GITHUB_BARE_ASSET_PATTERN)
  if (attachmentMatch?.[1]) {
    return `/user-attachments/assets/${attachmentMatch[1]}`
  }

  const parts = pathname.split('/').filter(Boolean)
  if (parts.length >= 5 && parts[2] === 'raw') {
    const [owner, repo, , ...assetParts] = parts
    return `/raw/${[owner, repo, ...assetParts].join('/')}`
  }

  if (options.allowGithubBlob && parts.length >= 5 && parts[2] === 'blob') {
    const [owner, repo, , ...assetParts] = parts
    return `/raw/${[owner, repo, ...assetParts].join('/')}`
  }

  if (options.allowReleaseDownload && parts.length >= 6 && parts[2] === 'releases' && parts[3] === 'download') {
    return pathname
  }

  if (isGithubWorkflowBadgePath(parts)) {
    return pathname
  }

  return null
}

function isGithubWorkflowBadgePath (parts: string[]): boolean {
  const lastPart = parts.at(-1)
  if (!lastPart?.toLowerCase().endsWith('badge.svg')) return false

  return (parts.length >= 5 && parts[2] === 'actions' && parts[3] === 'workflows') ||
    (parts.length >= 4 && parts[2] === 'workflows')
}

function signedAssetUrl (route: ProxyRoute, config: AssetProxyConfig): string {
  const digest = crypto
    .createHash('md5')
    .update(`${config.key}${route.pathname}${config.timestamp}`)
    .digest('hex')

  const target = new URL(route.pathname, config.baseUrl)
  const routeSearchParams = new URLSearchParams(route.searchParams)
  routeSearchParams.delete(config.signatureParam)
  routeSearchParams.delete(config.timestampParam)
  routeSearchParams.forEach((value, key) => {
    target.searchParams.append(key, value)
  })
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

      const route = proxyRoute(parts[0], { allowGithubBlob: true })
      if (!route) return entry.trim()

      return [signedAssetUrl(route, config), ...parts.slice(1)].join(' ')
    })
    .join(', ')
}

function isImageLink ($: ReturnType<typeof load>, element: Parameters<ReturnType<typeof load>>[0], href: string): boolean {
  if (!looksLikeImageUrl(href)) return false

  const link = $(element)
  if (!link.is('a')) return false

  const imageUrl = link.find('img[src], source[srcset]').first().attr('src') || ''
  if (!imageUrl) return true

  return sameGithubBlobTarget(href, imageUrl) || looksLikeImageUrl(imageUrl)
}

function sameGithubBlobTarget (left: string, right: string): boolean {
  try {
    const leftUrl = new URL(left)
    const rightUrl = new URL(right)
    return leftUrl.hostname === 'github.com' &&
      rightUrl.hostname === 'github.com' &&
      leftUrl.pathname === rightUrl.pathname
  } catch {
    return false
  }
}

function looksLikeImageUrl (value: string): boolean {
  try {
    const pathname = new URL(value).pathname.toLowerCase()
    return /\.(avif|gif|jpe?g|png|svg|webp)(?:$|[?#])/.test(pathname)
  } catch {
    return false
  }
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
