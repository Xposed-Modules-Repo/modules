import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { marked } from 'marked'
import { load } from 'cheerio'
import {
  ensureDir,
  pathExists,
  renderedReadmePath
} from './cache'
import { fetchGithubReadmeHtml, renderGithubMarkdown } from './github'
import { canonicalizeAssetHtml } from './asset-proxy'
import { readD1Json, readmeHtmlCacheKey, writeD1Json } from './d1-cache'

export const README_ASSET_VERSION = 4

interface ReadmeAssetContext {
  owner: string
  repoName: string
  commitOid: string
}

interface ReadmeHtmlCacheEntry {
  oid: string
  assetVersion: number
  html: string
}

const PUBLIC_IMAGE_PATTERNS = [
  /https:\/\/github\.com\/[a-zA-Z0-9-]+\/[\w.-]+\/assets\/\d+\/([0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12})/g,
  /https:\/\/github\.com\/user-attachments\/assets\/([0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12})/g
]
const PRIVATE_IMAGE_PATTERN = /https:\/\/private-user-images\.githubusercontent\.com\/\d+\/\d+-([0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12})\.[^"'<>]+/g

export function replacePrivateImages (markdown: string | null | undefined, html: string | null | undefined): string | null | undefined {
  if (!html) return html

  let result = html.replaceAll(PRIVATE_IMAGE_PATTERN, (_, uuid: string) => {
    return `https://github.com/user-attachments/assets/${uuid}`
  })

  if (!markdown) return result

  const publicMatches = new Map<string, string>()
  for (const pattern of PUBLIC_IMAGE_PATTERNS) {
    for (const match of markdown.matchAll(pattern)) {
      publicMatches.set(match[0], match[1])
    }
  }

  for (const [publicUrl, uuid] of publicMatches) {
    const privatePattern = new RegExp(`https:\\/\\/private-user-images\\.githubusercontent\\.com\\/\\d+\\/\\d+-${uuid}\\..*?(?=")`, 'g')
    result = result.replaceAll(privatePattern, publicUrl)
  }
  return result
}

export function normalizeReadmeAssetHtml (
  markdown: string | null | undefined,
  html: string | null | undefined,
  context?: ReadmeAssetContext
): string | null | undefined {
  if (!html) return html

  const restoredHtml = replacePrivateImages(markdown, html) || html
  const unbundledHtml = restoreBundledAssetUrls(restoredHtml)
  const relativeHtml = context ? rewriteRelativeAssetUrls(unbundledHtml, context) : unbundledHtml
  return canonicalizeAssetHtml(relativeHtml) || relativeHtml
}

export async function renderReadmeHtml (
  owner: string,
  repoName: string,
  markdown: string | null | undefined,
  readmeOid: string,
  commitOid: string
): Promise<string> {
  const context = { owner, repoName, commitOid }
  const htmlPath = renderedReadmePath(repoName, readmeOid)
  if (await pathExists(htmlPath)) {
    const cachedHtml = await fs.readFile(htmlPath, 'utf8')
    const refreshedHtml = normalizeReadmeAssetHtml(markdown, cachedHtml, context) || cachedHtml
    if (refreshedHtml !== cachedHtml) await fs.writeFile(htmlPath, refreshedHtml, 'utf8')
    return refreshedHtml
  }

  const remoteCacheKey = readmeHtmlCacheKey(owner, repoName, README_ASSET_VERSION)
  const remoteEntry = await readD1Json<ReadmeHtmlCacheEntry>(remoteCacheKey)
  if (remoteEntry?.oid === readmeOid && remoteEntry.assetVersion === README_ASSET_VERSION) {
    const refreshedHtml = normalizeReadmeAssetHtml(markdown, remoteEntry.html, context) || remoteEntry.html
    await ensureDir(path.dirname(htmlPath))
    await fs.writeFile(htmlPath, refreshedHtml, 'utf8')
    return refreshedHtml
  }

  let html = await renderReadme(owner, repoName, markdown)
  html = normalizeReadmeAssetHtml(markdown, html, context) || html

  await ensureDir(path.dirname(htmlPath))
  await fs.writeFile(htmlPath, html, 'utf8')
  await writeD1Json(remoteCacheKey, 'readme-html', {
    oid: readmeOid,
    assetVersion: README_ASSET_VERSION,
    html
  } satisfies ReadmeHtmlCacheEntry)
  return html
}

async function renderReadme (owner: string, repoName: string, markdown: string | null | undefined): Promise<string> {
  if (process.env.USE_GITHUB_README_HTML_API !== 'false') {
    try {
      return unwrapReadmeHtml(await fetchGithubReadmeHtml(owner, repoName))
    } catch (error) {
      console.warn(`[markdown] GitHub README HTML API failed for ${repoName}; using markdown renderer fallback: ${(error as Error).message}`)
    }
  }

  if (!markdown) throw new Error(`README markdown is unavailable for ${repoName}`)
  return renderMarkdown(owner, repoName, markdown)
}

function unwrapReadmeHtml (html: string): string {
  const $ = load(html, {}, false)
  const article = $('article.markdown-body').first()
  return article.length ? (article.html() || html) : html
}

function restoreBundledAssetUrls (html: string): string {
  const $ = load(html, {}, false)
  let changed = false

  $('[src], [href], [poster], [data-canonical-src]').each((_, element) => {
    for (const attr of ['src', 'href', 'poster', 'data-canonical-src']) {
      const value = $(element).attr(attr)
      if (!value) continue

      const restored = bundledAssetUrl(value)
      if (restored && restored !== value) {
        $(element).attr(attr, restored)
        changed = true
      }
    }
  })

  $('[srcset]').each((_, element) => {
    const srcset = $(element).attr('srcset')
    if (!srcset) return

    const rewritten = restoreBundledSrcset(srcset)
    if (rewritten !== srcset) {
      $(element).attr('srcset', rewritten)
      changed = true
    }
  })

  return changed ? ($.root().html() || html) : html
}

function rewriteRelativeAssetUrls (html: string, context: ReadmeAssetContext): string {
  const $ = load(html, {}, false)
  let changed = false

  $('[src], [poster], [data-canonical-src]').each((_, element) => {
    for (const attr of ['src', 'poster', 'data-canonical-src']) {
      const value = $(element).attr(attr)
      if (!value) continue

      const rewritten = relativeRawUrl(value, context)
      if (rewritten && rewritten !== value) {
        $(element).attr(attr, rewritten)
        changed = true
      }
    }
  })

  $('a[href]').each((_, element) => {
    const value = $(element).attr('href')
    if (!value || (!looksLikeImagePath(value) && !$(element).find('img, source').length)) return

    const rewritten = relativeRawUrl(value, context)
    if (rewritten && rewritten !== value) {
      $(element).attr('href', rewritten)
      changed = true
    }
  })

  $('[srcset]').each((_, element) => {
    const srcset = $(element).attr('srcset')
    if (!srcset) return

    const rewritten = rewriteRelativeSrcset(srcset, context)
    if (rewritten !== srcset) {
      $(element).attr('srcset', rewritten)
      changed = true
    }
  })

  return changed ? ($.root().html() || html) : html
}

async function renderMarkdown (owner: string, repoName: string, markdown: string): Promise<string> {
  if (process.env.USE_GITHUB_MARKDOWN_API !== 'false') {
    try {
      return await renderGithubMarkdown(owner, repoName, markdown)
    } catch (error) {
      console.warn(`[markdown] GitHub Markdown API failed for ${repoName}; using local fallback: ${(error as Error).message}`)
    }
  }

  const cmark = process.env.CMARK_GFM_BIN
  if (cmark) {
    try {
      return execFileSync(cmark, [
        '--smart',
        '--validate-utf8',
        '--github-pre-lang',
        '-e',
        'footnotes',
        '-e',
        'table',
        '-e',
        'strikethrough',
        '-e',
        'autolink',
        '-e',
        'tagfilter',
        '-e',
        'tasklist',
        '--unsafe',
        '--strikethrough-double-tilde',
        '-t',
        'html'
      ], {
        input: markdown,
        maxBuffer: 20 * 1024 * 1024
      }).toString()
    } catch (error) {
      console.warn(`[markdown] cmark-gfm failed for ${repoName}; using marked fallback: ${(error as Error).message}`)
    }
  }

  return marked.parse(markdown, {
    async: false,
    gfm: true
  }) as string
}

function restoreBundledSrcset (srcset: string): string {
  return srcset
    .split(',')
    .map(entry => {
      const parts = entry.trim().split(/\s+/)
      if (!parts[0]) return entry
      const rewritten = bundledAssetUrl(parts[0])
      if (!rewritten) return entry.trim()
      return [rewritten, ...parts.slice(1)].join(' ')
    })
    .join(', ')
}

function rewriteRelativeSrcset (srcset: string, context: ReadmeAssetContext): string {
  return srcset
    .split(',')
    .map(entry => {
      const parts = entry.trim().split(/\s+/)
      if (!parts[0]) return entry
      const rewritten = relativeRawUrl(parts[0], context)
      if (!rewritten) return entry.trim()
      return [rewritten, ...parts.slice(1)].join(' ')
    })
    .join(', ')
}

function bundledAssetUrl (value: string): string | null {
  let pathname: string
  let search = ''
  try {
    const url = new URL(value)
    pathname = url.pathname
    search = url.search
  } catch {
    const [pathPart, queryPart] = value.split('?', 2)
    pathname = pathPart
    search = queryPart ? `?${queryPart}` : ''
  }

  if (!pathname.startsWith('/github-assets/') && !pathname.startsWith('github-assets/')) return null

  const parts = pathname.split('/').filter(Boolean).map(part => {
    try {
      return decodeURIComponent(part)
    } catch {
      return part
    }
  })
  const [, owner, repoName, commitOid, ...assetParts] = parts
  if (!owner || !repoName || !commitOid || !assetParts.length) return null

  return `https://raw.githubusercontent.com/${[
    owner,
    repoName,
    commitOid,
    ...assetParts
  ].map(encodeURIComponent).join('/')}${search}`
}

function relativeRawUrl (value: string, context: ReadmeAssetContext): string | null {
  const raw = value.trim()
  if (!raw || raw.startsWith('#') || raw.startsWith('//') || raw.startsWith('data:')) return null

  try {
    const url = new URL(raw)
    if (url.protocol === 'http:' || url.protocol === 'https:') return null
  } catch {
    // Not an absolute URL; continue as a repo-relative asset.
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null

  const match = raw.match(/^([^?#]*)(.*)$/)
  const pathPart = match?.[1] || ''
  const suffix = match?.[2] || ''
  if (!pathPart) return null

  let decoded: string
  try {
    decoded = decodeURI(pathPart)
  } catch {
    decoded = pathPart
  }

  decoded = decoded.replace(/\\/g, '/')
  const normalized = path.posix.normalize(decoded.startsWith('/') ? decoded.slice(1) : decoded)
  if (!normalized || normalized === '.' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    return null
  }

  return `https://raw.githubusercontent.com/${[
    context.owner,
    context.repoName,
    context.commitOid,
    ...normalized.split('/')
  ].map(encodeURIComponent).join('/')}${suffix}`
}

function looksLikeImagePath (value: string): boolean {
  const pathPart = value.split(/[?#]/, 1)[0].toLowerCase()
  return /\.(avif|gif|jpe?g|png|svg|webp)$/.test(pathPart)
}
