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
const { fetchFromGithub, generateGatsbyNode } = require('./helper')

const PAGINATION = 100
function makeRepositoriesQuery (cursor) {
  const arg = cursor ? `, after: "${cursor}"` : ''
  return `
{
  organization(login: "Xposed-Modules-Repo") {
    repositories(first: ${PAGINATION}${arg}) {
      edges {
        node {
          description
          url
          homepageUrl
          collaborators(affiliation: OUTSIDE, first: 3) {
            edges {
              node {
                login
                name
              }
            }
          }
          object(expression: "main:SUMMARY.md") {
            ... on Blob {
              text
            }
          }
          releases(first: 1) {
            edges {
              node {
                name
                url
                descriptionHTML
                updatedAt
                tagName
                isPrerelease
                releaseAssets(first: 1) {
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
  { boundActionCreators },
  { token, variables, url }
) => {
  const { createNode } = boundActionCreators
  if (token === undefined) {
    throw 'token is undefined'
  }
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
    const result = await fetchFromGithub(url, token, makeRepositoriesQuery(cursor), variables)
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
