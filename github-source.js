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

exports.fetchFromGithub = fetchFromGitHub
