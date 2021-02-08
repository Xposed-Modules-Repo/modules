// This source code is in redistribution of a free software
// https://github.com/ldd/gatsby-source-github-api
//
// MIT License
//
// Copyright (c) 2017 Leonardo Florez
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
const fetcher = require('graphql-fetch')
const crypto = require('crypto')
const uuid = require('uuid/v1')

const GITHUB_URL = 'https://api.github.com/graphql'
const DEFAULT_QUERY = `
query ($nFirst: Int = 2, $q: String = "") {
  search(query: $q, type: ISSUE, first: $nFirst){
    edges{
      node{
        ... on PullRequest{
          title
        }
      }
    }
  }
}
`
const DEFAULT_VARIABLES = { q: '', nFirst: 1 }
const fetchFromAPI = (graphQLQuery = DEFAULT_QUERY) => {
  if (process.env.GRAPHQL_TOKEN === undefined) {
    throw 'token is undefined'
  }
  const fetch = fetcher(GITHUB_URL)
  return fetchJSON(fetch, process.env.GRAPHQL_TOKEN, graphQLQuery, DEFAULT_VARIABLES)
}

async function fetchJSON (fetch, token, query, variables) {
  const headers = new Headers()
  headers.set('Authorization', `Bearer ${token}`)
  return await fetch(query, variables, {
    headers,
    method: 'POST',
    mode: 'cors'
  })
}

const generateGatsbyNode = (result, createNode) => {
  createNode({
    data: result.data,
    id: result.id || uuid(),
    // see https://github.com/ldd/gatsby-source-github-api/issues/19
    // provide the raw result to see errors, or other information
    rawResult: result,
    parent: null,
    children: [],
    internal: {
      type: 'GithubData',
      contentDigest: crypto
        .createHash('md5')
        .update(JSON.stringify(result))
        .digest('hex'),
      // see https://github.com/ldd/gatsby-source-github-api/issues/10
      // our node should have an 'application/json' MIME type, but we wish
      // transformers to ignore it, so we set its mediaType to text/plain for now
      mediaType: 'text/plain'
    }
  })
}

exports.fetchFromGithub = fetchFromAPI
exports.generateGatsbyNode = generateGatsbyNode
exports.DEFAULT_QUERY = DEFAULT_QUERY
