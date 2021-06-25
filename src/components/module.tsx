import { ReactElement, useState } from 'react'
import * as React from 'react'
import { Grid } from '@material-ui/core'
import { createStyles, makeStyles, Theme } from '@material-ui/core/styles'
import '@primer/css/markdown/index.scss'
import './module.css'

const useStyles = makeStyles((theme: Theme) =>
  createStyles({
    container: {
      margin: '30px 0',
      [theme.breakpoints.down('sm')]: {
        margin: '10px 0'
      },
      '& a': {
        color: theme.palette.secondary.main
      }
    },
    releases: {
      '& a': {
        color: theme.palette.secondary.main
      }
    },
    document: {
      wordBreak: 'break-word',
      '& img': {
        maxWidth: '100%'
      },
      '& pre': {
        whiteSpace: 'pre-wrap'
      }
    },
    plainDocument: {
      wordBreak: 'break-word'
    },
    box: {
      padding: '24px 0',
      borderBottom: '1px solid #eaecef',
      '&:first-child': {
        paddingTop: '0.5rem'
      },
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
    },
    release: {
      [theme.breakpoints.down('sm')]: {
        display: 'none'
      }
    }
  })
)

export default function Module ({ data }: any): ReactElement {
  const classes = useStyles()
  const [showReleaseNum, setShowReleaseNum] = useState(1)
  return (
    <>
      <Grid container spacing={3}>
        <Grid item xs={12} md={9}>
          <div className={classes.container}>
            {data.githubRepository.childGitHubReadme
              ? (<div
                className="markdown-body"
                dangerouslySetInnerHTML={{
                  __html: data.githubRepository.readmeHTML || data.githubRepository.childGitHubReadme.childMarkdownRemark.html
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
                <h2 className={classes.h2}>Support / Discussion URL</h2>
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
            {data.githubRepository.releases?.edges.length
              ? (<div className={`${classes.box} ${classes.release}`}>
                <h2 className={classes.h2}>Releases</h2>
                <h3 className={classes.h2}>
                  <a href={data.githubRepository.releases.edges[0].node.url}
                     target={'_blank'}
                  >{data.githubRepository.releases.edges[0].node.name}</a>
                </h3>
                <p className={classes.p}>
                  Release Type: {data.githubRepository.releases.edges[0].node.isPrerelease ? 'Pre-release' : 'Stable'}
                </p>
                <p className={classes.p}>
                  {new Date(data.githubRepository.releases.edges[0].node.publishedAt).toLocaleString()}
                </p>
                <p className={classes.p}>
                  <a href={'#releases'}>View all releases</a>
                </p>
              </div>)
              : ''
            }
          </div>
        </Grid>
        {data.githubRepository.releases?.edges.length
          ? (<Grid item xs={12}>
            <div className={classes.releases}>
              <h1 id="releases">Releases</h1>
              {data.githubRepository.releases.edges.slice(0, showReleaseNum).map(({ node: release }: any) => (
                <div key={release.name}>
                  <h2><a href={release.url} target={'_blank'}>{release.name}</a></h2>
                  <p className={classes.p}>
                    Release Type: {release.isPrerelease ? 'Pre-release' : 'Stable'}
                  </p>
                  <p className={classes.p}>
                    {new Date(release.publishedAt).toLocaleString()}
                  </p>
                  <div
                    className="markdown-body"
                    dangerouslySetInnerHTML={{
                      __html: release.descriptionHTML
                    }}
                  />
                  {release.releaseAssets?.edges.length
                    ? (
                      <div>
                        <h3>Downloads</h3>
                        <ul>
                          {release.releaseAssets.edges.map(({ node: asset }: any) => (
                            <li key={asset.name}>
                              <a href={asset.downloadUrl} target={'_blank'}>{asset.name}</a>
                            </li>
                          ))}
                        </ul>
                      </div>)
                    : ''
                  }
                </div>
              ))}
              {showReleaseNum !== data.githubRepository.releases.edges.length
                ? (<p>
                  <a
                    href=""
                    onClick={(e) => {
                      e.preventDefault()
                      setShowReleaseNum(showReleaseNum + 1)
                    }}
                  >Show older versions</a>
                </p>)
                : ''
              }
            </div>
          </Grid>)
          : ''
        }
      </Grid>
    </>
  )
}
