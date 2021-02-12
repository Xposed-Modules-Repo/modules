import { ReactElement } from 'react'
import Layout from '../layout'
import * as React from 'react'
import { graphql } from 'gatsby'
import SEO from '../components/seo'

export default function ModulePage ({ data }: any): ReactElement {
  return (
    <Layout>
      <SEO title={data.githubRepository.description} />
      {}
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
        excerpt(pruneLength: 250, truncate: true)
      }
    }
  }
}
`
