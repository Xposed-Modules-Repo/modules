import { ReactElement } from 'react'
import Layout from '../layout'
import * as React from 'react'
import { graphql } from 'gatsby'
import SEO from '../components/seo'
import Module from '../components/module'

export default function ModulePage ({ data }: any): ReactElement {
  const getSummary = (repo: any): string => {
    let summary = ''
    if (repo.summary) summary = repo.summary
    else if (repo.readmeHTML) {
      summary = repo.readmeHTML
    } else if (repo.childGitHubReadme) {
      summary = repo.childGitHubReadme.childMarkdownRemark.excerpt
    }
    return summary
  }
  return (
    <Layout>
      <SEO title={data.githubRepository.description} description={getSummary(data.githubRepository)} />
      <Module data={data} />
    </Layout>
  )
}

export const query = graphql`
query ($name: String!) {
  githubRepository(name: {eq: $name}) {
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
    readme
    readmeHTML
    summary
    sourceUrl
    hide
    additionalAuthors {
      name
      link
      type
    }
    childGitHubReadme {
      childMarkdownRemark {
        html
        excerpt
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
                downloadCount
                size
              }
            }
          }
        }
      }
    }
  }
}
`
