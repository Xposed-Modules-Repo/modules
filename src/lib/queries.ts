function positiveInt (value: string | undefined, fallback: number, max: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback
}

const detailReleaseLimit = positiveInt(process.env.GITHUB_DETAIL_RELEASE_LIMIT, 5, 20)
const detailReleaseAssetLimit = positiveInt(process.env.GITHUB_DETAIL_RELEASE_ASSET_LIMIT, 20, 50)

export const REPOSITORY_INVENTORY_FRAGMENT = `
fragment RepositoryInventory on Repository {
  name
  description
  url
  homepageUrl
  updatedAt
  createdAt
  pushedAt
  stargazerCount
  defaultBranchRef {
    name
    target {
      oid
    }
  }
  readme: object(expression: "HEAD:README.md") {
    ... on Blob {
      oid
      byteSize
    }
  }
  summary: object(expression: "HEAD:SUMMARY") {
    ... on Blob {
      oid
      byteSize
    }
  }
  scope: object(expression: "HEAD:SCOPE") {
    ... on Blob {
      oid
      byteSize
    }
  }
  sourceUrl: object(expression: "HEAD:SOURCE_URL") {
    ... on Blob {
      oid
      byteSize
    }
  }
  hide: object(expression: "HEAD:HIDE") {
    ... on Blob {
      oid
      byteSize
    }
  }
  additionalAuthors: object(expression: "HEAD:ADDITIONAL_AUTHORS") {
    ... on Blob {
      oid
      byteSize
    }
  }
  latestRelease {
    id
    name
    url
    isDraft
    createdAt
    publishedAt
    updatedAt
    tagName
    isPrerelease
  }
}
`

export const ORGANIZATION_INVENTORY_QUERY = `
${REPOSITORY_INVENTORY_FRAGMENT}

query OrganizationInventory($owner: String!, $cursor: String, $pageSize: Int!) {
  organization(login: $owner) {
    repositories(first: $pageSize, after: $cursor, orderBy: {field: UPDATED_AT, direction: DESC}, privacy: PUBLIC) {
      edges {
        cursor
        node {
          ...RepositoryInventory
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
      totalCount
    }
  }
}
`

export const REPOSITORY_INVENTORY_QUERY = `
${REPOSITORY_INVENTORY_FRAGMENT}

query RepositoryInventoryByName($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    ...RepositoryInventory
  }
}
`

export const REPOSITORY_DETAIL_FRAGMENT = `
fragment RepositoryDetail on Repository {
  name
  description
  url
  homepageUrl
  updatedAt
  createdAt
  pushedAt
  stargazerCount
  defaultBranchRef {
    name
    target {
      oid
    }
  }
  collaborators(affiliation: DIRECT, first: 100) {
    nodes {
      login
      name
      avatarUrl
    }
  }
  readme: object(expression: "HEAD:README.md") {
    ... on Blob {
      oid
    }
  }
  summary: object(expression: "HEAD:SUMMARY") {
    ... on Blob {
      oid
      text
    }
  }
  scope: object(expression: "HEAD:SCOPE") {
    ... on Blob {
      oid
      text
    }
  }
  sourceUrl: object(expression: "HEAD:SOURCE_URL") {
    ... on Blob {
      oid
      text
    }
  }
  hide: object(expression: "HEAD:HIDE") {
    ... on Blob {
      oid
      text
    }
  }
  additionalAuthors: object(expression: "HEAD:ADDITIONAL_AUTHORS") {
    ... on Blob {
      oid
      text
    }
  }
  latestRelease {
    id
    databaseId
    name
    url
    isDraft
    descriptionHTML
    createdAt
    publishedAt
    updatedAt
    tagName
    isPrerelease
    releaseAssets(first: ${detailReleaseAssetLimit}) {
      totalCount
      pageInfo {
        hasNextPage
      }
      nodes {
        name
        contentType
        downloadUrl
        downloadCount
        size
      }
    }
  }
  releases(first: ${detailReleaseLimit}, orderBy: {field: CREATED_AT, direction: DESC}) {
    totalCount
    pageInfo {
      hasNextPage
    }
    nodes {
      id
      databaseId
      name
      url
      isDraft
      descriptionHTML
      createdAt
      publishedAt
      updatedAt
      tagName
      isPrerelease
      isLatest
      releaseAssets(first: ${detailReleaseAssetLimit}) {
        totalCount
        pageInfo {
          hasNextPage
        }
        nodes {
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
`

export const REPOSITORY_DETAIL_QUERY = `
${REPOSITORY_DETAIL_FRAGMENT}

query RepositoryDetail($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    ...RepositoryDetail
  }
}
`

export function repositoryDetailBatchQuery (count: number): string {
  const variables = Array.from({ length: count }, (_, index) => `$name${index}: String!`).join(', ')
  const repositories = Array.from({ length: count }, (_, index) => {
    return `  repo${index}: repository(owner: $owner, name: $name${index}) {\n    ...RepositoryDetail\n  }`
  }).join('\n')

  return `
${REPOSITORY_DETAIL_FRAGMENT}

query RepositoryDetailBatch($owner: String!, ${variables}) {
${repositories}
}
`
}
