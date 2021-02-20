import { ReactElement } from 'react'
import Layout from '../layout'
import * as React from 'react'
import { graphql } from 'gatsby'
import SEO from '../components/seo'
import Module from '../components/module'

export default function ModulePage ({ data }: any): ReactElement {
  return (
    <Layout>
      <SEO title={data.githubRepository.description} />
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
  }
}
`
