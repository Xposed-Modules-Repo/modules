const { ApolloClient, InMemoryCache, createHttpLink, from } = require('@apollo/client')
const { RetryLink } = require('@apollo/client/link/retry')
const { ApolloError } = require('@apollo/client/errors')

const httpLink = createHttpLink({
  uri: 'https://api.github.com/graphql',
  headers: {
    authorization: `Bearer ${process.env.GRAPHQL_TOKEN}`,
  }
})

const retryLink = new RetryLink({
  attempts: (count, _operation, /** @type {ApolloError} */ error) => {
    return count < 3
  },
  delay: (_count, operation, _error) => {
    const context = operation.getContext()
    /** @type {Response} */
    const response = context.response
    const xRatelimitRemaining = parseInt(response.headers.get('x-ratelimit-remaining'))
    if (!isNaN(xRatelimitRemaining) && xRatelimitRemaining > 0) {
      console.error('[NetworkError] retry after 1 second')
      return 1000
    }
    let retryAfter = parseInt(response.headers.get('retry-after'))
    const xRateLimitReset = parseInt(response.headers.get('x-ratelimit-reset'))
    if (isNaN(retryAfter) && isNaN(xRateLimitReset)) {
      console.error('[NetworkError] response header missing...')
      console.error('[NetworkError] retry after 1 min')
      return 60 * 1000
    }
    if (isNan(retryAfter)) {
      const retryAfter = (xRateLimitReset * 1000) - Date.now()
      console.error(`[NetworkError] retry after ${retryAfter} ms`)
    }
    return retryAfter * 1000
  },
})

/** @type {import('@apollo/client').DefaultOptions} */
const defaultOptions = {
  watchQuery: {
    fetchPolicy: 'no-cache',
  },
  query: {
    fetchPolicy: 'no-cache',
  }
}

const apolloClient = new ApolloClient({
  link: from([retryLink, httpLink]),
  cache: new InMemoryCache(),
  defaultOptions: defaultOptions,
})

const fetchFromGitHub = async (graphQLQuery) => {
  if (process.env.GRAPHQL_TOKEN === undefined) {
    throw new Error('token is undefined')
  }
  return apolloClient.query({
    query: graphQLQuery,
  }).then((response) => {
    return response
  })
}

const REGEX_PUBLIC_IMAGES = /https:\/\/github\.com\/[a-zA-Z0-9-]+\/[\w\-.]+\/assets\/\d+\/([0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12})/g
const replacePrivateImage = (markdown, html) => {
  const publicMatches = new Map()
  for (const match of markdown.matchAll(REGEX_PUBLIC_IMAGES)) {
    publicMatches.set(match[0], match[1])
  }
  for (const match of publicMatches) {
    const regexPrivateImages = new RegExp(`https:\\/\\/private-user-images\\.githubusercontent\\.com\\/\\d+\\/\\d+-${match[1]}\\..*?(?=")`, 'g')
    html = html.replaceAll(regexPrivateImages, match[0])
  }
  return html
}

exports.fetchFromGithub = fetchFromGitHub
exports.replacePrivateImage = replacePrivateImage
