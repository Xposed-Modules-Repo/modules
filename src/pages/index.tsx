import * as React from 'react'
import Layout from '../layout'
import { createStyles, makeStyles, Theme } from '@material-ui/core/styles'
import RepoCard, { RepoCardProps } from '../components/repo-card'
import { graphql } from 'gatsby'

const useStyles = makeStyles((theme: Theme) =>
  createStyles({
    title: {
      textAlign: 'center'
    },
    container: {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, 50%)',
      [theme.breakpoints.down('xs')]: {
        gridTemplateColumns: 'repeat(1, 100%)'
      }
    }
  })
)

export default function IndexPage ({ data }: any): React.ReactElement {
  const classes = useStyles()
  const getRepoCardProps = (repo: any): RepoCardProps => {
    const title = repo.node.description
    let summary = ''
    if (repo.node.summary) summary = repo.node.summary.text.trim()
    else if (repo.node.readme) summary = repo.node.readme.text
    const url = repo.node.homepageUrl || repo.node.url
    let sourceUrl
    if (repo.node.sourceUrl) sourceUrl = repo.node.sourceUrl.text.replace(/[\r\n]/g, '').trim()
    else sourceUrl = repo.node.url
    return {
      title, summary, url, sourceUrl
    }
  }
  return (
    <Layout>
      <h1 className={classes.title}>Xposed Module Repository</h1>
      <div className={classes.container}>
          {data.githubData.data.organization.repositories.edges.filter((repo: any) =>
            !repo.node.hide && repo.node.name.match(/\./) && repo.node.name !== 'org.meowcat.example'
          )
            .map((repo: any) => (
              <div key={repo.node.name}>
                <RepoCard {...getRepoCardProps(repo)} />
              </div>
            ))
          }
      </div>
    </Layout>
  )
}

export const query = graphql`
{
  githubData {
    data {
      organization {
        repositories {
          edges {
            node {
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
              readme {
                text
              }
              summary {
                text
              }
              sourceUrl {
                text
              }
              hide {
                text
              }
              additionalAuthors {
                text
              }
            }
          }
        }
      }
    }
  }
}
`
