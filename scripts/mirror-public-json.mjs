#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '8911df62bfddad67b7d7e84ae666bc87'
const PROJECT = process.env.CF_PAGES_PROJECT || 'modules'
const OUTPUT_DIR = process.env.PUBLIC_MIRROR_OUTPUT_DIR || '.public-pages'
const CNAME = process.env.PUBLIC_MIRROR_CNAME || 'modules-backup.lsposed.org'
const BRANCH = process.env.CF_PAGES_BRANCH || 'primer'
const ENVIRONMENT = process.env.CF_PAGES_ENVIRONMENT || 'production'
const LAG_DAYS = Number.parseInt(process.env.PUBLIC_MIRROR_LAG_DAYS || '7', 10)
const CONCURRENCY = 12
const ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID?.trim()
const ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET?.trim()

const required = name => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function main () {
  const source = process.env.PUBLIC_MIRROR_SOURCE_URL?.trim() || await selectDeployment()

  console.log('[mirror] Source deployment selected')
  console.log(`[mirror] Output directory: ${OUTPUT_DIR}`)

  await mkdir(path.join(OUTPUT_DIR, 'module'), { recursive: true })
  await writeFile(path.join(OUTPUT_DIR, '.nojekyll'), '')
  await writeFile(path.join(OUTPUT_DIR, 'CNAME'), `${CNAME}\n`)

  const modulesText = await fetchFirstText(source, ['/modules-no-proxy.json', '/modules.json'])
  const modules = JSON.parse(modulesText)
  if (!Array.isArray(modules)) throw new Error('/modules.json is not an array')

  await writeFile(path.join(OUTPUT_DIR, 'modules.json'), modulesText)

  const names = modules
    .map(module => module?.name)
    .filter(name => typeof name === 'string' && name.length > 0)

  console.log(`[mirror] Mirroring ${names.length} module JSON files`)
  await mapLimit(names, CONCURRENCY, async (name, index) => {
    const encodedName = encodeURIComponent(name)
    const moduleText = await fetchFirstText(source, [
      `/module-no-proxy/${encodedName}.json`,
      `/module/${encodedName}.json`
    ])
    await writeFile(path.join(OUTPUT_DIR, 'module', `${name}.json`), moduleText)

    if ((index + 1) % 50 === 0 || index + 1 === names.length) {
      console.log(`[mirror] ${index + 1}/${names.length}`)
    }
  })

  await writeFile(path.join(OUTPUT_DIR, 'index.html'), `<!doctype html>
<meta charset="utf-8">
<title>Xposed Modules JSON Mirror</title>
<meta name="robots" content="noindex">
<pre>{
  "moduleCount": ${names.length},
  "generatedAt": ${JSON.stringify(new Date().toISOString())},
  "modules": "/modules.json",
  "module": "/module/&lt;package&gt;.json"
}</pre>
`)

  console.log('[mirror] Done')
}

async function selectDeployment () {
  const token = required('CF_API_TOKEN')
  const cutoff = Date.now() - LAG_DAYS * 24 * 60 * 60 * 1000
  let oldest

  for (let page = 1; page <= 20; page++) {
    const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT}/deployments`)
    url.searchParams.set('page', String(page))
    url.searchParams.set('per_page', '25')

    const payload = await fetchJson(url, { Authorization: `Bearer ${token}` })
    if (!payload.success) throw new Error(`Cloudflare API failed: ${JSON.stringify(payload.errors)}`)

    const deployments = (payload.result || []).filter(isWantedDeployment)
    for (const deployment of deployments) {
      oldest = deployment
      if (Date.parse(deployment.created_on) <= cutoff) {
        console.log(`[mirror] Selected deployment from ${deployment.created_on}`)
        return new URL(deployment.url)
      }
    }

    if ((payload.result || []).length < 25) break
  }

  if (!oldest?.url) throw new Error('No matching Cloudflare Pages deployment found')

  console.warn(`[mirror] No deployment is at least ${LAG_DAYS} days old; using oldest available deployment from ${oldest.created_on}`)
  return new URL(oldest.url)
}

function isWantedDeployment (deployment) {
  return deployment.url &&
    deployment.environment === ENVIRONMENT &&
    deployment.latest_stage?.status === 'success' &&
    deployment.deployment_trigger?.metadata?.branch === BRANCH
}

async function fetchFirstText (source, paths) {
  let firstError

  for (const pathname of paths) {
    const url = new URL(pathname, source)
    const response = await fetchWithRetry(url, { headers: sourceHeaders() })
    if (response.ok) return response.text()

    const error = new Error(`Failed to fetch ${url.pathname}: ${response.status}`)
    firstError ||= error
    if (response.status !== 404) throw error
  }

  throw firstError || new Error('No source path provided')
}

async function fetchJson (url, headers) {
  const response = await fetchWithRetry(url, { headers })
  if (!response.ok) throw new Error(`Failed to fetch Cloudflare API: ${response.status}`)
  return response.json()
}

async function fetchWithRetry (url, init) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(url, init).catch(error => ({ ok: false, status: 0, error }))
    if (response.ok || response.status < 500 || attempt === 3) return response
    await sleep(attempt * 500)
  }
}

async function mapLimit (items, limit, fn) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      await fn(items[index], index)
    }
  }))
}

function sourceHeaders () {
  if (!ACCESS_CLIENT_ID || !ACCESS_CLIENT_SECRET) return undefined

  return {
    'CF-Access-Client-Id': ACCESS_CLIENT_ID,
    'CF-Access-Client-Secret': ACCESS_CLIENT_SECRET
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
