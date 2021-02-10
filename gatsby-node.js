const fs = require('fs')

const { fetchFromGithub, generateGatsbyNode } = require('./source-helper')

const PAGINATION = 100
function makeRepositoriesQuery (cursor) {
  const arg = cursor ? `, after: "${cursor}"` : ''
  return `
{
  organization(login: "Xposed-Modules-Repo") {
    repositories(first: ${PAGINATION}${arg}, orderBy: {field: UPDATED_AT, direction: DESC}) {
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
          releases(orderBy: {field: CREATED_AT, direction: DESC}, first: 20) {
            edges {
              node {
                name
                url
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
}`
}

exports.sourceNodes = async (
  { actions }
) => {
  const { createNode } = actions
  let cursor = null
  let page = 1
  let total
  const mergedResult = {
    data: {
      organization: {
        repositories: {
          edges: []
        }
      }
    }
  }
  while (true) {
    console.log(`Querying GitHub API, page ${page}, total ${Math.ceil(total / PAGINATION) || 'unknown'}, cursor: ${cursor}`)
    const result = await fetchFromGithub(makeRepositoriesQuery(cursor))
    if (result.errors) {
      console.error(result.errors)
      break
    }
    mergedResult.data.organization.repositories.edges =
      mergedResult.data.organization.repositories.edges.concat(result.data.organization.repositories.edges)
    if (!result.data.organization.repositories.pageInfo.hasNextPage) {
      break
    }
    cursor = result.data.organization.repositories.pageInfo.endCursor
    total = result.data.organization.repositories.totalCount
    page++
  }
  generateGatsbyNode(mergedResult, createNode)
}

function flatten (object) {
  for (const key of Object.keys(object)) {
    if (object[key] !== null && object[key] !== undefined && typeof object[key] === 'object') {
      if (object[key].edges) {
        object[key] = object[key].edges.map(edge => edge.node)
      }
    }
    if (object[key] !== null && object[key] !== undefined && typeof object[key] === 'object') {
      flatten(object[key])
    }
  }
}

function parseNestedObject (repo) {
  if (repo.summary) {
    repo.summary = repo.summary.text.trim()
  }
  if (repo.readme) {
    repo.readme = repo.readme.text
  }
  if (repo.sourceUrl) {
    repo.sourceUrl = repo.sourceUrl.text.replace(/[\r\n]/g, '').trim()
  }
  if (repo.additionalAuthors) {
    try {
      repo.additionalAuthors = JSON.parse(repo.additionalAuthors.text)
    } catch (e) {
      repo.additionalAuthors = null
    }
  }
  if (repo.scope) {
    try {
      repo.scope = JSON.parse(repo.scope.text)
    } catch (e) {
      repo.scope = null
    }
  }
  repo.hide = !!repo.hide
  return repo
}

exports.onPostBuild = async ({ graphql }) => {
  const result = await graphql(`
{
  githubData {
    data {
      organization {
        repositories {
          edges {
            node {
              name
              description
              url
              homepageUrl
              collaborators {
                edges {
                  node {
                    login
                    name
                  }
                }
              }
              releases {
                edges {
                  node {
                    name
                    url
                    description
                    descriptionHTML
                    createdAt
                    publishedAt
                    updatedAt
                    tagName
                    isPrerelease
                    releaseAssets {
                      edges {
                        node {
                          name
                          contentType
                          downloadUrl
                        }
                      }
                    }
                  }
                }
              }
              readme {
                text
              }
              summary {
                text
              }
              scope {
                text
              }
              sourceUrl {
                text
              }
              hide {
                text
              }
              additionalAuthors {
                text
              }
              updatedAt
              createdAt
              stargazerCount
            }
            cursor
          }
        }
      }
    }
  }
}`)
  const postsPath = './public'
  flatten(result)
  let modules
  try {
    modules = result.data.githubData.data.organization.repositories.filter((repo) => (
      repo.name.match(/\./) && repo.name !== 'org.meowcat.example'
    )).map((repo) => parseNestedObject(repo))
  } catch (e) {
    throw new Error(`${e.message}, ${JSON.stringify(result)}`)
  }
  if (!fs.existsSync(postsPath)) fs.mkdirSync(postsPath, { recursive: true })
  fs.writeFileSync(`${postsPath}/modules.json`, JSON.stringify(modules))
}
