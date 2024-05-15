const { ApolloClient, InMemoryCache, createHttpLink } = require('@apollo/client')

const httpLink = createHttpLink({
  uri: 'https://api.github.com/graphql',
  headers: {
    authorization: `Bearer ${process.env.GRAPHQL_TOKEN}`,
  }
})
const apolloClient = new ApolloClient({
  link: httpLink,
  cache: new InMemoryCache(),
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
