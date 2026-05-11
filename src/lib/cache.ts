import fs from 'node:fs/promises'
import path from 'node:path'

export interface RepoCacheEntry {
  fingerprint: string
  dataPath: string
  readmeOid?: string | null
}

export interface BuildManifest {
  version: 1
  owner: string
  updatedAt: string
  inventory: Record<string, unknown>
  repos: Record<string, RepoCacheEntry>
}

export const cacheRoot = process.env.MODULES_CACHE_DIR ||
  path.join(process.cwd(), 'node_modules', '.astro', 'modules-cache')

export const assetPublicRoot = path.join(process.cwd(), 'public', 'github-assets')
export const assetBuildRoot = path.join(process.cwd(), 'dist', 'github-assets')

export function safeName (value: string): string {
  return encodeURIComponent(value).replaceAll('%', '_')
}

export function cachePath (...parts: string[]): string {
  return path.join(cacheRoot, ...parts)
}

export async function ensureDir (dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

export async function pathExists (file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

export async function readJson<T> (file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function writeJson (file: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(file))
  await fs.writeFile(file, `${JSON.stringify(value)}\n`, 'utf8')
}

export async function readManifest (owner: string): Promise<BuildManifest> {
  const manifest = await readJson<BuildManifest>(cachePath('manifest.json'))
  if (manifest && manifest.version === 1 && manifest.owner === owner) return manifest
  return {
    version: 1,
    owner,
    updatedAt: new Date(0).toISOString(),
    inventory: {},
    repos: {}
  }
}

export async function writeManifest (manifest: BuildManifest): Promise<void> {
  manifest.updatedAt = new Date().toISOString()
  await writeJson(cachePath('manifest.json'), manifest)
}

export function repoDataPath (repoName: string): string {
  return cachePath('repos', `${safeName(repoName)}.json`)
}

export function renderedReadmePath (repoName: string, readmeOid: string): string {
  return cachePath('gfm-html', safeName(repoName), `${readmeOid}.html`)
}

export function assetCachePath (owner: string, repoName: string, commitOid: string, assetPath: string): string {
  return cachePath('github-assets', owner, repoName, commitOid, assetPath)
}

export function assetOutputPath (owner: string, repoName: string, commitOid: string, assetPath: string): string {
  return path.join(assetPublicRoot, owner, repoName, commitOid, assetPath)
}

export function assetOutputPaths (owner: string, repoName: string, commitOid: string, assetPath: string): string[] {
  return [
    path.join(assetPublicRoot, owner, repoName, commitOid, assetPath),
    path.join(assetBuildRoot, owner, repoName, commitOid, assetPath)
  ]
}

export function assetPublicUrl (owner: string, repoName: string, commitOid: string, assetPath: string): string {
  return `/github-assets/${[owner, repoName, commitOid, ...assetPath.split('/')].map(encodeURIComponent).join('/')}`
}
