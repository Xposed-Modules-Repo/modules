import { ReactElement } from 'react'
import Layout from '../layout'
import * as React from 'react'
import { graphql } from 'gatsby'
import SEO from '../components/seo'
import { Grid } from '@material-ui/core'
import { createStyles, makeStyles, Theme } from '@material-ui/core/styles'

const useStyles = makeStyles((_: Theme) =>
  createStyles({
    container: {
      margin: '30px 0'
    },
    document: {
      wordBreak: 'break-word'
    },
    plainDocument: {
      wordBreak: 'break-word'
    },
    box: {
      padding: '24px 0',
      borderBottom: '1px solid #eaecef',
      '&:last-child': {
        borderBottom: 'none'
      },
      wordBreak: 'break-word'
    },
    h2: {
      marginTop: 0,
      marginBottom: 14
    },
    p: {
      marginTop: 10,
      marginBottom: 10,
      '&:last-child': {
        marginBottom: 0
      }
    }
  })
)

export default function ModulePage ({ data }: any): ReactElement {
  const classes = useStyles()
  return (
    <Layout>
      <SEO title={data.githubRepository.description} />
      <Grid container spacing={3}>
        <Grid item xs={12} md={9}>
          <div className={classes.container}>
            {data.githubRepository.childGitHubReadme
              ? (<div
                className={classes.document}
                dangerouslySetInnerHTML={{
                  __html: data.githubRepository.childGitHubReadme.childMarkdownRemark.html
                }}
              />)
              : (<div className={classes.plainDocument}>
                {data.githubRepository.summary || data.githubRepository.description}
              </div>)
            }
          </div>
        </Grid>
        <Grid item xs={12} md={3}>
          <div className={classes.container}>
            <div className={classes.box}>
              <h2 className={classes.h2}>Package</h2>
              <p className={classes.p}>{data.githubRepository.name}</p>
            </div>
            {(data.githubRepository.collaborators?.edges.length) ||
            (data.githubRepository.additionalAuthors?.length)
              ? (<div className={classes.box}>
                  <h2 className={classes.h2}>Authors</h2>
                  {data.githubRepository.collaborators
                    ? data.githubRepository.collaborators.edges.map(({ node: collaborator }: any) => (
                      <p key={collaborator.login} className={classes.p}>
                        <a href={`https://github.com/${collaborator.login as string}`}
                           target={'_blank'}
                        >
                          {collaborator.name || collaborator.login}
                        </a>
                      </p>
                    ))
                    : ''
                  }
                  {data.githubRepository.additionalAuthors
                    ? data.githubRepository.additionalAuthors.map((author: any) => (
                      <p key={author.name} className={classes.p}>
                        <a href={author.link} target={'_blank'}>
                          {author.name || author.link}
                        </a>
                      </p>
                    ))
                    : ''
                  }
                </div>)
              : ''
            }
            {data.githubRepository.homepageUrl
              ? (<div className={classes.box}>
                <h2 className={classes.h2}>Support/Discussion URL</h2>
                <p className={classes.p}>
                  <a href={data.githubRepository.homepageUrl}
                     target={'_blank'}
                  >{data.githubRepository.homepageUrl}</a>
                </p>
              </div>)
              : ''
            }
            {data.githubRepository.sourceUrl
              ? (<div className={classes.box}>
                <h2 className={classes.h2}>Source URL</h2>
                <p className={classes.p}>
                  <a href={data.githubRepository.sourceUrl}
                     target={'_blank'}
                  >{data.githubRepository.sourceUrl}</a>
                </p>
              </div>)
              : ''
            }
          </div>
        </Grid>
      </Grid>
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
  }
}
`
