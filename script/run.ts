import { writeFileSync, existsSync, mkdirSync, readFileSync } from "fs"
import { env } from "process"
import { marked } from "marked"
import { JSDOM } from "jsdom"
import DOMPurify from "dompurify"
import ellipsize from "ellipsize"

type ModuleRelease = {
  name: string
  url: string
  descriptionHTML: string
  createdAt: string
  publishedAt: string
  updatedAt: string
  tagName: string
  isPrerelease: Boolean
  releaseAssets: Array<{
    name: string
    contentType: string
    downloadUrl: string
    downloadCount: number
    size: number
  }>
}

type ModuleJson = {
  name: string
  description: string
  url: string
  homepageUrl: string | null
  collaborators: Array<{
    login: string
    name: string | null
  }>
  latestRelease: string | null
  latestReleaseTime: string
  latestBetaReleaseTime: string
  latestSnapshotReleaseTime: string
  releases: Array<ModuleRelease>
  readme: string | null
  readmeHTML: string | null
  summary: string | null
  scope: Array<string> | null
  sourceUrl: string | null
  hide: boolean
  additionalAuthors: Array<{
    type: string
    name: string
    link: string
  }>
  updatedAt: string
  createdAt: string
  stargazerCount: number
}

type GraphQlRelease = {
  name: string
  url: string
  isDraft: boolean
  description: string
  descriptionHTML: string
  createdAt: string
  publishedAt: string
  updatedAt: string
  tagName: string
  isPrerelease: boolean
  isLatest: boolean
  releaseAssets: {
    edges: Array<{
      node: {
        name: string
        contentType: string
        downloadUrl: string
        downloadCount: number
        size: number
      }
    }>
  }
}

type GraphQlRepository = {
  name: string
  description: string
  url: string
  homepageUrl?: string
  collaborators: {
    edges: Array<{
      node: {
        login: string
        name?: string
      }
    }>
  }
  readme: {
    text: string
  }
  summary?: {
    text: string
  }
  scope?: {
    text: string
  }
  sourceUrl?: {
    text: string
  }
  hide?: {
    text: string
  }
  additionalAuthors?: {
    text: string
  }
  latestRelease?: GraphQlRelease
  releases: {
    edges: Array<{
      node: GraphQlRelease
    }>
  }
  updatedAt: string
  createdAt: string
  stargazerCount: number
}

type GraphQlRepositoryWrapped = {
  node: GraphQlRepository
  cursor: string
}

type GraphqlRepoResponse = {
  data: {
    repository: GraphQlRepository
  }
  errors: string
}

type GraphqlReposResponse = {
  data: {
    organization: {
      repositories: {
        edges: Array<GraphQlRepositoryWrapped>
        pageInfo: {
          hasNextPage: boolean
          endCursor: string
        }
        totalCount: number
      }
    }
  }
  errors: string
}

const PAGINATION = 10

const wait = (delay: number) => {
  return new Promise((resolve) => setTimeout(resolve, delay))
}

const fetchRepository = async (name: string): Promise<GraphqlRepoResponse> => {
  const onRateLimit = async (delay: number) => {
    return wait(delay).then(() => fetchRepository(name))
  }
  return await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.GRAPHQL_TOKEN}`,
    },
    body: JSON.stringify({
      query: `
{
  repository(owner: "Xposed-Modules-Repo", name: "${name}") {
    name
    description
    url
    homepageUrl
    collaborators(affiliation: DIRECT, first: 100) {
      edges {
        node {
          login
          name
        }
      }
    }
    readme: object(expression: "HEAD:README.md") {
      ... on Blob {
        text
      }
    }
    summary: object(expression: "HEAD:SUMMARY") {
      ... on Blob {
        text
      }
    }
    scope: object(expression: "HEAD:SCOPE") {
      ... on Blob {
        text
      }
    }
    sourceUrl: object(expression: "HEAD:SOURCE_URL") {
      ... on Blob {
        text
      }
    }
    hide: object(expression: "HEAD:HIDE") {
      ... on Blob {
        text
      }
    }
    additionalAuthors: object(expression: "HEAD:ADDITIONAL_AUTHORS") {
      ... on Blob {
        text
      }
    }
    latestRelease {
      name
      url
      isDraft
      description
      descriptionHTML
      createdAt
      publishedAt
      updatedAt
      tagName
      isPrerelease
      releaseAssets(first: 50) {
        edges {
          node {
            name
            contentType
            downloadUrl
            downloadCount
            size
          }
        }
      }
    }
    releases(first: 20) {
      edges {
        node {
          name
          url
          isDraft
          description
          descriptionHTML
          createdAt
          publishedAt
          updatedAt
          tagName
          isPrerelease
          isLatest
          releaseAssets(first: 50) {
            edges {
              node {
                name
                contentType
                downloadUrl
                downloadCount
                size
              }
            }
          }
        }
      }
    }
    updatedAt
    createdAt
    stargazerCount
  }
}
      `,
    }),
  })
    .then((response) => {
      if (response.status == 403 || response.status == 429) {
        const remaining = parseInt(
          response.headers.get("x-ratelimit-remaining") || "0"
        )
        const reset = parseInt(response.headers.get("x-ratelimit-reset") || "0")
        const retryAfter = parseInt(response.headers.get("retry-after") || "0")
        if (remaining > 0) {
          return onRateLimit(1000)
        } else if (retryAfter > 0) {
          return onRateLimit(retryAfter * 1000)
        } else if (reset > 0) {
          return onRateLimit(reset * 1000 - Date.now())
        } else {
          return onRateLimit(60 * 1000)
        }
      }
      return response.json()
    })
    .then((response: GraphqlRepoResponse) => {
      return response
    })
}

const fetchRepositories = async (
  cursor: string = ""
): Promise<GraphqlReposResponse> => {
  const onRateLimit = async (delay: number) => {
    return wait(delay).then(() => fetchRepositories(cursor))
  }

  const arg = cursor ? `, after: "${cursor}"` : ""
  return await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.GRAPHQL_TOKEN}`,
    },
    body: JSON.stringify({
      query: `
{
  organization(login: "Xposed-Modules-Repo") {
    repositories(
      first: ${PAGINATION}${arg}
      orderBy: { field: UPDATED_AT, direction: DESC }
      privacy: PUBLIC
    ) {
      edges {
        node {
          name
          description
          url
          homepageUrl
          collaborators(affiliation: DIRECT, first: 100) {
            edges {
              node {
                login
                name
              }
            }
          }
          readme: object(expression: "HEAD:README.md") {
            ... on Blob {
              text
            }
          }
          summary: object(expression: "HEAD:SUMMARY") {
            ... on Blob {
              text
            }
          }
          scope: object(expression: "HEAD:SCOPE") {
            ... on Blob {
              text
            }
          }
          sourceUrl: object(expression: "HEAD:SOURCE_URL") {
            ... on Blob {
              text
            }
          }
          hide: object(expression: "HEAD:HIDE") {
            ... on Blob {
              text
            }
          }
          additionalAuthors: object(expression: "HEAD:ADDITIONAL_AUTHORS") {
            ... on Blob {
              text
            }
          }
          latestRelease {
            name
            url
            isDraft
            description
            descriptionHTML
            createdAt
            publishedAt
            updatedAt
            tagName
            isPrerelease
            releaseAssets(first: 50) {
              edges {
                node {
                  name
                  contentType
                  downloadUrl
                  downloadCount
                  size
                }
              }
            }
          }
          releases(first: 20) {
            edges {
              node {
                name
                url
                isDraft
                description
                descriptionHTML
                createdAt
                publishedAt
                updatedAt
                tagName
                isPrerelease
                isLatest
                releaseAssets(first: 50) {
                  edges {
                    node {
                      name
                      contentType
                      downloadUrl
                      downloadCount
                      size
                    }
                  }
                }
              }
            }
          }
          updatedAt
          createdAt
          stargazerCount
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
      totalCount
    }
  }
}
        `,
    }),
  })
    .then((response) => {
      if (response.status == 403 || response.status == 429) {
        const remaining = parseInt(
          response.headers.get("x-ratelimit-remaining") || "0"
        )
        const reset = parseInt(response.headers.get("x-ratelimit-reset") || "0")
        const retryAfter = parseInt(response.headers.get("retry-after") || "0")
        if (remaining > 0) {
          return onRateLimit(1000)
        } else if (retryAfter > 0) {
          return onRateLimit(retryAfter * 1000)
        } else if (reset > 0) {
          return onRateLimit(reset * 1000 - Date.now())
        } else {
          return onRateLimit(60 * 1000)
        }
      }
      return response.json()
    })
    .then((response: GraphqlReposResponse) => {
      return response
    })
}

const REGEX_PUBLIC_IMAGES =
  /https:\/\/github\.com\/[a-zA-Z0-9-]+\/[\w\-.]+\/assets\/\d+\/([0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12})/g
const replacePrivateImage = (markdown: string, html: string) => {
  const publicMatches = new Map()
  for (const match of markdown.matchAll(REGEX_PUBLIC_IMAGES)) {
    publicMatches.set(match[0], match[1])
  }
  for (const match of publicMatches) {
    const regexPrivateImages = new RegExp(
      `https:\\/\\/private-user-images\\.githubusercontent\\.com\\/\\d+\\/\\d+-${match[1]}\\..*?(?=")`,
      "g"
    )
    html = html.replaceAll(regexPrivateImages, match[0])
  }
  return html
}

const window = new JSDOM("").window
const purify = DOMPurify(window)

const convert2json = async (
  repo: GraphQlRepository
): Promise<ModuleJson | null> => {
  repo.latestRelease &&
    !repo.releases.edges.find((r) => {
      r.node.tagName == repo.latestRelease?.tagName
    }) &&
    repo.releases.edges.push({ node: repo.latestRelease })
  const releases: Array<ModuleRelease> = repo.releases.edges
    .filter(
      ({ node: { releaseAssets, isDraft, tagName } }) =>
        !isDraft &&
        tagName.match(/^\d+-.+$/) &&
        releaseAssets &&
        releaseAssets.edges.some(
          ({ node: { contentType } }) =>
            contentType === "application/vnd.android.package-archive"
        )
    )
    .map((v) => {
      const release = v.node
      return {
        name: release.name,
        url: release.url,
        descriptionHTML: replacePrivateImage(
          release.description,
          release.descriptionHTML
        ),
        createdAt: release.createdAt,
        publishedAt: release.publishedAt,
        updatedAt: release.updatedAt,
        tagName: release.tagName,
        isPrerelease: release.isPrerelease,
        releaseAssets: release.releaseAssets.edges.map((u) => {
          const asset = u.node
          return {
            name: asset.name,
            contentType: asset.contentType,
            downloadUrl: asset.downloadUrl,
            downloadCount: asset.downloadCount,
            size: asset.size,
          }
        }),
      }
    })

  const isModule = !!(
    repo.name.match(/\./) &&
    repo.description &&
    releases &&
    releases.length &&
    repo.name !== "org.meowcat.example" &&
    repo.name !== ".github"
  )
  if (!isModule) {
    console.log(`skipped ${repo.name}`)
    return null
  }
  console.log(`found ${repo.name}`)
  const latestRelease = releases.find((v) => !v.isPrerelease)
  const latestBetaRelease =
    releases.find(
      (v) => v.isPrerelease && !v.name.match(/^(snapshot|nightly).*/i)
    ) || latestRelease
  const latestSnapshotRelease =
    releases.find(
      (v) => v.isPrerelease && v.name.match(/^(snapshot|nightly).*/i)
    ) || latestBetaRelease

  const html = repo.readme
    ? purify.sanitize(await marked.parse(repo.readme.text.trim()))
    : null

  let scope: Array<string> = []
  try {
    scope = repo.scope ? JSON.parse(repo.scope.text) : undefined
  } catch (e) {
    console.error(`scope for repo ${repo.name} is invalid: ${e}`)
  }

  let additionalAuthors = []
  try {
    additionalAuthors = repo.additionalAuthors
      ? JSON.parse(repo.additionalAuthors.text)
      : []
  } catch (e) {
    console.error(`additionalAuthors for repo ${repo.name} is invalid: ${e}`)
  }

  return {
    name: repo.name,
    description: repo.description,
    url: repo.url,
    homepageUrl: repo.homepageUrl || null,
    collaborators: repo.collaborators.edges.map((v) => {
      return { login: v.node.login, name: v.node.name || null }
    }),
    latestRelease: latestRelease?.name || null,
    latestReleaseTime: latestRelease?.publishedAt || "1970-01-01T00:00:00Z",
    latestBetaReleaseTime:
      latestBetaRelease?.publishedAt || "1970-01-01T00:00:00Z",
    latestSnapshotReleaseTime:
      latestSnapshotRelease?.publishedAt || "1970-01-01T00:00:00Z",
    releases: releases,
    readme: repo.readme ? repo.readme.text.trim() : null,
    readmeHTML: html || null,
    summary: ellipsize(repo.summary?.text.trim(), 512).trim(),
    scope: scope,
    sourceUrl: repo.sourceUrl?.text.trim() || null,
    hide: !!repo.hide?.text,
    additionalAuthors: additionalAuthors,
    updatedAt: repo.updatedAt,
    createdAt: repo.createdAt,
    stargazerCount: repo.stargazerCount,
  }
}

const main = async () => {
  if (!env.GRAPHQL_TOKEN) throw Error("GRAPHQL_TOKEN is not defined")
  const modulePackage = env.REPO
    ? env.REPO.indexOf("/") > -1
      ? env.REPO.split("/")[1]
      : env.REPO
    : null

  const cachedModules = ".cache/modules.json"

  let cursor: string = ""
  let mergedRepositories: Array<GraphQlRepositoryWrapped> = []
  let page = 1
  let total = 0
  if (modulePackage && existsSync(cachedModules)) {
    console.log(`Querying GitHub API for module ${modulePackage}`)
    const response = await fetchRepository(modulePackage)
    if (response.errors || !response.data) {
      const errMsg = response.errors || "response.data is null"
      console.error(errMsg)
      throw errMsg
    }
    const module = await convert2json(response.data.repository)
    if (!module) {
      return
    }
    let modules: Array<ModuleJson> = JSON.parse(
      readFileSync(cachedModules, { encoding: "utf-8" })
    )
    modules.forEach((value, index, array) => {
      if (value.name == modulePackage) {
        array.splice(index, 1)
      }
    })
    modules.unshift(module)
    modules = modules.sort((a, b) => {
      const aTime = Math.max(
        Date.parse(a.latestReleaseTime),
        Date.parse(a.latestBetaReleaseTime),
        Date.parse(a.latestSnapshotReleaseTime)
      )
      const bTime = Math.max(
        Date.parse(b.latestReleaseTime),
        Date.parse(b.latestBetaReleaseTime),
        Date.parse(b.latestSnapshotReleaseTime)
      )
      return bTime - aTime
    })
    writeFileSync(cachedModules, JSON.stringify(modules))
  } else {
    while (true) {
      console.log(
        `Querying GitHub API, page ${page}, total ${
          Math.ceil(total / PAGINATION) || "unknown"
        }, cursor: ${cursor}`
      )
      const response = await fetchRepositories(cursor)
      if (response.errors || !response.data) {
        const errMsg = response.errors || "response.data is null"
        console.error(errMsg)
        throw errMsg
      }
      const repositories = response.data.organization.repositories
      mergedRepositories = mergedRepositories.concat(repositories.edges)
      if (!repositories.pageInfo.hasNextPage) {
        break
      }
      cursor = repositories.pageInfo.endCursor
      total = repositories.totalCount
      page++
    }

    let modules: Array<ModuleJson> = []
    for (const m of mergedRepositories) {
      const module = await convert2json(m.node)
      if (module) modules.push(module)
    }
    modules = modules.sort((a, b) => {
      const aTime = Math.max(
        Date.parse(a.latestReleaseTime),
        Date.parse(a.latestBetaReleaseTime),
        Date.parse(a.latestSnapshotReleaseTime)
      )
      const bTime = Math.max(
        Date.parse(b.latestReleaseTime),
        Date.parse(b.latestBetaReleaseTime),
        Date.parse(b.latestSnapshotReleaseTime)
      )
      return bTime - aTime
    })
    if (!existsSync(".cache")) mkdirSync(".cache")
    writeFileSync(cachedModules, JSON.stringify(modules))
  }
}

main()
