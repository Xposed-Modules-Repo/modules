import * as React from 'react'
import { makeStyles } from '@material-ui/core/styles'
import Card from '@material-ui/core/Card'
import CardActionArea from '@material-ui/core/CardActionArea'
import CardActions from '@material-ui/core/CardActions'
import CardContent from '@material-ui/core/CardContent'
import Button from '@material-ui/core/Button'
import Typography from '@material-ui/core/Typography'
import { Link } from 'gatsby'

export interface RepoCardProps {
  name: string
  title: string
  summary: string
  url: string
  sourceUrl: string
}

const useStyles = makeStyles({
  root: {
    margin: 10,
    height: 200,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    alignItems: 'left'
  },
  actionArea: {
    flex: '1 1 auto',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    overflow: 'hidden'
  },
  cardContent: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    overflow: 'hidden'
  },
  body: {
    overflow: 'hidden'
  }
})

export default function RepoCard (props: RepoCardProps): React.ReactElement {
  const classes = useStyles()
  return (
    <Card className={classes.root}>
      <CardActionArea className={classes.actionArea}
                      component={Link} to={`/module/${props.name}`}>
        <CardContent className={classes.cardContent}>
          <Typography gutterBottom variant="h5" component="h2">
            {props.title}
          </Typography>
          <Typography variant="body2" color="textSecondary" component="p"
                      className={classes.body}
          >
            {props.summary}
          </Typography>
        </CardContent>
      </CardActionArea>
      <CardActions>
        {props.url
          ? (<Button size="small" color="secondary"
                     href={props.url} target={'_blank'}
          >
              Website
            </Button>)
          : ''
        }
        {props.sourceUrl
          ? (<Button size="small" color="secondary"
                     href={props.sourceUrl} target={'_blank'}
          >
              Source
             </Button>)
          : ''
        }
      </CardActions>
    </Card>
  )
}
