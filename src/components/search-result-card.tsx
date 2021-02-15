import * as React from 'react'
import { createStyles, makeStyles } from '@material-ui/core/styles'
import { SearchResult } from 'react-use-flexsearch'
import { Paper } from '@material-ui/core'
import Typography from '@material-ui/core/Typography'
import { Link } from 'gatsby'

export interface SearchResultCardProps {
  searchKeyword: string
  searchResult: SearchResult[]
  className?: string
}

const useStyles = makeStyles((theme) =>
  createStyles({
    root: {
      color: theme.palette.text.primary,
      borderRadius: 4,
      maxHeight: 'calc(100vh - 100px)',
      overflow: 'scroll',
      zIndex: theme.zIndex.appBar + 1,
      padding: 10,
      boxSizing: 'border-box',
      [theme.breakpoints.down('xs')]: {
        maxHeight: 'calc(100vh - 56px)'
      }
    },
    result: {
      width: 550,
      maxWidth: 'calc(100vw - 40px)',
      boxSizing: 'border-box',
      padding: '20px 15px',
      margin: '0 10px',
      borderBottom: '1px solid ' + theme.palette.divider,
      '&:last-child': {
        borderBottom: 'none'
      },
      '&:hover': {
        background: 'rgba(25, 25, 25, 0.1)'
      },
      cursor: 'pointer',
      display: 'block',
      textDecoration: 'none',
      color: theme.palette.text.primary
    },
    hide: {
      display: 'none'
    }
  })
)

export default function SearchResultCard (props: SearchResultCardProps): React.ReactElement {
  const classes = useStyles()
  return (
    <Paper
      component={'span'}
      className={`${classes.root} ${props.className ?? ''} ${props.searchKeyword ? '' : classes.hide}`}
    >
      {props.searchResult.length
        ? props.searchResult.map((result) => (
          <Link
            key={result.name}
            className={classes.result}
            to={`/module/${result.name}`}
          >
            <Typography gutterBottom variant="h5" component="h2">
              {result.description}
            </Typography>
            <Typography variant="body2" color="textSecondary" component="p"
            >
              {result.summary || result.readmeExcerpt}
            </Typography>
          </Link>
        ))
        : <div
            className={classes.result}
          >
            <Typography variant="body2" color="textSecondary" component="p"
                        align="center"
            >
              No results found
            </Typography>
        </div>
      }
    </Paper>
  )
}
