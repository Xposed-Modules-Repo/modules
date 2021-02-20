import * as React from 'react'
import { ReactElement } from 'react'
import { createStyles, makeStyles, Theme } from '@material-ui/core/styles'

const useStyles = makeStyles((theme: Theme) =>
  createStyles({
    landing: {
      display: 'flex',
      width: '100%',
      height: 'calc(100vh - 144px)'
    },
    centerBox: {
      display: 'flex',
      width: '100%',
      height: '100%',
      textAlign: 'center',
      justifyContent: 'center',
      alignItems: 'center',
      flexDirection: 'column'
    },
    h1: {
      color: '#bcc6cc',
      fontSize: 60
    },
    h2: {
      color: theme.palette.type === 'light'
        ? '#464a4d'
        : '#cdd6e0',
      fontSize: 20,
      fontStyle: 'upper'
    }
  })
)

export default function _404 (): ReactElement {
  const classes = useStyles()
  return (
    <div className={classes.landing}>
      <div className={classes.centerBox}>
        <div className={classes.h1}>404</div>
        <div className={classes.h2}>try somewhere else</div>
      </div>
    </div>
  )
}
