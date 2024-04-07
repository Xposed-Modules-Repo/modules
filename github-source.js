const fetcher = require('graphql-fetch')
const GITHUB_URL = 'https://api.github.com/graphql'

const DEFAULT_VARIABLES = { q: '', nFirst: 1 }
const fetchFromGitHub = async (graphQLQuery) => {
  if (process.env.GRAPHQL_TOKEN === undefined) {
    throw new Error('token is undefined')
  }
  const fetch = fetcher(GITHUB_URL)
  const headers = new global.Headers()
  headers.set('Authorization', `Bearer ${process.env.GRAPHQL_TOKEN}`)
  return fetch(graphQLQuery, DEFAULT_VARIABLES, {
    headers,
    method: 'POST',
    mode: 'cors'
  })
}

const REGEX_PRIVATE_IMAGES = /https:\/\/private-user-images\.githubusercontent\.com\/\d+\/\d+-(.*?)\..*?(?=")/g
const replacePrivateImage = (markdown, html) => {
  const set = new Set()
  const privateMatches = []
  for (const match of html.matchAll(REGEX_PRIVATE_IMAGES)) {
    if (set.has(match[0])) continue
    set.add(match[0])
    privateMatches.push([match[0], match[1]])
  }
  for (const match of privateMatches) {
    const regexPublicImages = new RegExp(`https:\\/\\/github\\.com\\/[a-zA-Z0-9\\-]+\\/[\\w\\-.]+\\/assets\\/\\d+\\/${match[1]}`)
    const publicMatch = markdown.match(regexPublicImages)
    if (publicMatch) {
      html = html.replaceAll(match[0], publicMatch[0])
    }
  }
  return html
}

exports.fetchFromGithub = fetchFromGitHub
exports.replacePrivateImage = replacePrivateImage
