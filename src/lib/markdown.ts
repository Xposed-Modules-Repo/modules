import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { marked } from 'marked'
import { load } from 'cheerio'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { visit } from 'unist-util-visit'
import {
  assetCachePath,
  assetOutputPaths,
  assetPublicUrl,
  ensureDir,
  pathExists,
  renderedReadmePath
} from './cache'
import { githubBuffer, renderGithubMarkdown } from './github'

export const README_ASSET_VERSION = 2

const PUBLIC_IMAGE_PATTERNS = [
  /https:\/\/github\.com\/[a-zA-Z0-9-]+\/[\w.-]+\/assets\/\d+\/([0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12})/g,
  /https:\/\/github\.com\/user-attachments\/assets\/([0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12})/g
]

export function replacePrivateImages (markdown: string | null | undefined, html: string | null | undefined): string | null | undefined {
  if (!markdown || !html) return html

  const publicMatches = new Map<string, string>()
  for (const pattern of PUBLIC_IMAGE_PATTERNS) {
    for (const match of markdown.matchAll(pattern)) {
      publicMatches.set(match[0], match[1])
    }
  }

  let result = html
  for (const [publicUrl, uuid] of publicMatches) {
    const privatePattern = new RegExp(`https:\\/\\/private-user-images\\.githubusercontent\\.com\\/\\d+\\/\\d+-${uuid}\\..*?(?=")`, 'g')
    result = result.replaceAll(privatePattern, publicUrl)
  }
  return result
}

export async function renderReadmeHtml (
  owner: string,
  repoName: string,
  markdown: string,
  readmeOid: string,
  commitOid: string
): Promise<string> {
  const htmlPath = renderedReadmePath(repoName, readmeOid)
  if (await pathExists(htmlPath)) {
    const cachedHtml = await fs.readFile(htmlPath, 'utf8')
    const refreshedHtml = await mirrorRelativeImages(owner, repoName, markdown, cachedHtml, commitOid)
    if (refreshedHtml !== cachedHtml) await fs.writeFile(htmlPath, refreshedHtml, 'utf8')
    return refreshedHtml
  }

  let html = await renderMarkdown(owner, repoName, markdown)
  html = await mirrorRelativeImages(owner, repoName, markdown, html, commitOid)

  await ensureDir(path.dirname(htmlPath))
  await fs.writeFile(htmlPath, html, 'utf8')
  return html
}

export async function restoreMirroredImages (html: string): Promise<void> {
  const $ = load(html, {}, false)
  const urls = new Set<string>()

  $('img').each((_, element) => {
    const src = $(element).attr('src')
    if (src?.startsWith('/github-assets/')) urls.add(src)
  })

  for (const url of urls) {
    const parts = url.split('/').filter(Boolean).map(part => {
      try {
        return decodeURIComponent(part)
      } catch {
        return part
      }
    })

    const [, owner, repoName, commitOid, ...assetParts] = parts
    if (!owner || !repoName || !commitOid || !assetParts.length) continue

    const assetPath = assetParts.join('/')
    const cacheFile = assetCachePath(owner, repoName, commitOid, assetPath)
    if (!await pathExists(cacheFile)) continue

    for (const outputFile of assetOutputPaths(owner, repoName, commitOid, assetPath)) {
      if (!await pathExists(outputFile)) {
        await ensureDir(path.dirname(outputFile))
        await fs.copyFile(cacheFile, outputFile)
      }
    }
  }
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

async function mirrorRelativeImages (
  owner: string,
  repoName: string,
  markdown: string,
  html: string,
  commitOid: string
): Promise<string> {
  const assets = extractRelativeMarkdownImages(markdown)
  if (!assets.size) return html

  const publicUrls = new Map<string, string>()
  for (const assetPath of assets) {
    try {
      await mirrorAsset(owner, repoName, commitOid, assetPath)
      publicUrls.set(assetPath, assetPublicUrl(owner, repoName, commitOid, assetPath))
    } catch (error) {
      console.warn(`[assets] Could not mirror ${owner}/${repoName}@${commitOid}:${assetPath}: ${(error as Error).message}`)
    }
  }

  if (!publicUrls.size) return html

  const $ = load(html, {}, false)
  $('img').each((_, element) => {
    const current = $(element).attr('src')
    if (current) {
      const rewritten = resolveHtmlImageUrl(current, owner, repoName, publicUrls)
      if (rewritten) $(element).attr('src', rewritten)
    }

    const srcset = $(element).attr('srcset')
    if (srcset) {
      $(element).attr('srcset', rewriteSrcset(srcset, owner, repoName, publicUrls))
    }
  })

  $('source').each((_, element) => {
    const srcset = $(element).attr('srcset')
    if (srcset) {
      $(element).attr('srcset', rewriteSrcset(srcset, owner, repoName, publicUrls))
    }
  })

  $('a').each((_, element) => {
    const href = $(element).attr('href')
    if (!href) return
    const rewritten = resolveHtmlImageUrl(href, owner, repoName, publicUrls)
    if (rewritten) $(element).attr('href', rewritten)
  })

  return $.root().html() || html
}

export async function refreshReadmeImageAssets (
  owner: string,
  repoName: string,
  markdown: string,
  html: string,
  commitOid: string
): Promise<string> {
  return mirrorRelativeImages(owner, repoName, markdown, html, commitOid)
}

function extractRelativeMarkdownImages (markdown: string): Set<string> {
  const images = new Set<string>()
  const tree = unified().use(remarkParse).parse(markdown)

  visit(tree, 'image', (node: { url?: string }) => {
    const resolved = resolveRelativeAsset(node.url || '')
    if (resolved) images.add(resolved)
  })

  visit(tree, 'html', (node: { value?: string }) => {
    if (!node.value) return
    const $ = load(node.value, {}, false)
    $('img').each((_, element) => {
      const resolved = resolveRelativeAsset($(element).attr('src') || '')
      if (resolved) images.add(resolved)
    })
  })

  return images
}

function resolveRelativeAsset (value: string): string | null {
  const raw = value.trim()
  if (!raw || raw.startsWith('#') || raw.startsWith('data:')) return null

  try {
    const url = new URL(raw)
    if (url.protocol === 'http:' || url.protocol === 'https:') return null
  } catch {
    // Not an absolute URL; continue as a repo-relative asset.
  }

  const withoutSuffix = raw.split(/[?#]/, 1)[0]
  if (!withoutSuffix) return null

  let decoded: string
  try {
    decoded = decodeURI(withoutSuffix)
  } catch {
    decoded = withoutSuffix
  }

  decoded = decoded.replace(/\\/g, '/')
  const normalized = path.posix.normalize(decoded.startsWith('/') ? decoded.slice(1) : decoded)
  if (!normalized || normalized === '.' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    return null
  }

  return normalized
}

async function mirrorAsset (owner: string, repoName: string, commitOid: string, assetPath: string): Promise<void> {
  const cacheFile = assetCachePath(owner, repoName, commitOid, assetPath)

  if (!await pathExists(cacheFile)) {
    const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/${encodeURIComponent(commitOid)}/${assetPath.split('/').map(encodeURIComponent).join('/')}`
    const body = await githubBuffer(rawUrl)
    await ensureDir(path.dirname(cacheFile))
    await fs.writeFile(cacheFile, body)
  }

  for (const outputFile of assetOutputPaths(owner, repoName, commitOid, assetPath)) {
    if (!await pathExists(outputFile)) {
      await ensureDir(path.dirname(outputFile))
      await fs.copyFile(cacheFile, outputFile)
    }
  }
}

function resolveHtmlImageUrl (
  current: string,
  owner: string,
  repoName: string,
  publicUrls: Map<string, string>
): string | null {
  const relative = resolveRelativeAsset(current)
  if (relative && publicUrls.has(relative)) return publicUrls.get(relative) || null

  let pathname: string
  try {
    const url = new URL(current)
    pathname = decodeURIComponent(url.pathname).replace(/\\/g, '/')
  } catch {
    return null
  }

  const normalizedOwner = `/${owner}/${repoName}/`
  if (!pathname.includes(normalizedOwner)) return null

  for (const [assetPath, publicUrl] of publicUrls) {
    if (pathname.endsWith(`/${assetPath}`)) return publicUrl
  }

  return null
}

function rewriteSrcset (
  srcset: string,
  owner: string,
  repoName: string,
  publicUrls: Map<string, string>
): string {
  return srcset
    .split(',')
    .map(entry => {
      const parts = entry.trim().split(/\s+/)
      if (!parts[0]) return entry
      const rewritten = resolveHtmlImageUrl(parts[0], owner, repoName, publicUrls)
      if (!rewritten) return entry.trim()
      return [rewritten, ...parts.slice(1)].join(' ')
    })
    .join(', ')
}
