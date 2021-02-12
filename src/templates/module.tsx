import { ReactElement } from 'react'
import Layout from '../layout'
import * as React from 'react'
import { graphql } from 'gatsby'

export default function ModulePage (): ReactElement {
  return (
    <Layout>
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
