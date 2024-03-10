import * as React from 'react'
import Layout from '../layout'
import { createStyles, makeStyles, Theme } from '@material-ui/core/styles'
import Pagination from '@material-ui/lab/Pagination'
import PaginationItem from '@material-ui/lab/PaginationItem'
import RepoCard, { RepoCardProps } from '../components/repo-card'
import { graphql, Link } from 'gatsby'
import SEO from '../components/seo'

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
    },
    pagination: {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      margin: 10
    }
  })
)

export default function IndexPage ({ data }: any): React.ReactElement {
  const classes = useStyles()
  const getRepoCardProps = (repo: any): RepoCardProps => {
    const title = repo.description
    let summary = ''
    if (repo.summary) summary = repo.summary
    else if (repo.childGitHubReadme) {
      summary = repo.childGitHubReadme.childMarkdownRemark.excerpt
    }
    const url = repo.homepageUrl || repo.url
    let sourceUrl
    if (repo.sourceUrl) sourceUrl = repo.sourceUrl
    else sourceUrl = repo.url
    return {
      title, summary, url, sourceUrl, name: repo.name
    }
  }
  return (
    <Layout>
      <h1 className={classes.title}>Xposed Module Repository</h1>
      <div className={classes.container}>
          {data.allGithubRepository.edges
            .map(({ node: repo }: any) => (
              <div key={repo.name}>
                <RepoCard {...getRepoCardProps(repo)} />
              </div>
            ))
          }
      </div>
      {data.allGithubRepository.pageInfo.pageCount > 1
        ? (<div className={classes.pagination}>
          <Pagination
            page={data.allGithubRepository.pageInfo.currentPage}
            count={data.allGithubRepository.pageInfo.pageCount}
            color="secondary"
            renderItem={(item) => (
              <PaginationItem
                component={Link}
                to={`/page/${item.page}`}
                {...item}
              />
            )}
          />
        </div>)
        : ''
      }
    </Layout>
  )
}

export const query = graphql`query ($skip: Int!, $limit: Int!) {
  allGithubRepository(
    skip: $skip
    limit: $limit
    filter: {isModule: {eq: true}, hide: {eq: false}}
    sort: {latestReleaseTime: DESC}
  ) {
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
    pageInfo {
      currentPage
      pageCount
    }
  }
}`

export const Head = () => <SEO title={'Browse Modules'} />
