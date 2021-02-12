import * as React from 'react'
import {
  Container,
  createMuiTheme,
  Drawer,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  MuiThemeProvider
} from '@material-ui/core'
import { blue, red } from '@material-ui/core/colors'
import { createStyles, fade, makeStyles, Theme } from '@material-ui/core/styles'
import AppBar from '@material-ui/core/AppBar'
import Toolbar from '@material-ui/core/Toolbar'
import IconButton from '@material-ui/core/IconButton'
import MenuIcon from '@material-ui/icons/Menu'
import Typography from '@material-ui/core/Typography'
import SearchIcon from '@material-ui/icons/Search'
import InputBase from '@material-ui/core/InputBase'
import PublishIcon from '@material-ui/icons/Publish'
import './styles.styl'
import { Link } from 'gatsby'
import { useState } from 'react'

const theme = createMuiTheme({
  palette: {
    primary: { main: blue[600] },
    secondary: { main: red.A200 }
  }
})

const useStyles = makeStyles((theme: Theme) =>
  createStyles({
    root: {
      flexGrow: 1
    },
    menuButton: {
      marginRight: theme.spacing(2)
    },
    title: {
      flexGrow: 1,
      display: 'none',
      [theme.breakpoints.up('sm')]: {
        display: 'block'
      }
    },
    h1: {
      textDecoration: 'none',
      color: 'inherit'
    },
    search: {
      position: 'relative',
      borderRadius: theme.shape.borderRadius,
      backgroundColor: fade(theme.palette.common.white, 0.15),
      '&:hover': {
        backgroundColor: fade(theme.palette.common.white, 0.25)
      },
      marginLeft: 0,
      marginRight: '12px',
      width: '100%',
      [theme.breakpoints.up('sm')]: {
        marginLeft: theme.spacing(1),
        width: 'auto'
      }
    },
    searchIcon: {
      padding: theme.spacing(0, 2),
      height: '100%',
      position: 'absolute',
      pointerEvents: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    },
    inputRoot: {
      color: 'inherit'
    },
    inputInput: {
      padding: theme.spacing(1, 1, 1, 0),
      // vertical padding + font size from searchIcon
      paddingLeft: `calc(1em + ${theme.spacing(4)}px)`,
      transition: theme.transitions.create('width'),
      width: '100%',
      [theme.breakpoints.up('sm')]: {
        width: '12ch',
        '&:focus': {
          width: '20ch'
        }
      }
    },
    footer: {
      height: 80,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#444',
      fontSize: 14
    },
    list: {
      width: 250
    }
  })
)

export default function Layout (props: { children: React.ReactNode }): React.ReactElement {
  const classes = useStyles()
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const toggleDrawer = (): void => {
    setIsDrawerOpen(!isDrawerOpen)
  }
  return (
    <MuiThemeProvider theme={theme}>
      <div className={classes.root}>
        <AppBar position="static">
          <Toolbar>
            <IconButton
              className={classes.menuButton}
              color="inherit"
              aria-label="open drawer"
              onClick={toggleDrawer}
            >
              <MenuIcon />
            </IconButton>
            <div className={classes.title}>
              <Typography variant="h6" noWrap className={classes.h1}
                          component={Link} to={'/'}
              >
                Xposed Module Repository
              </Typography>
            </div>
            <div className={classes.search}>
              <div className={classes.searchIcon}>
                <SearchIcon />
              </div>
              <InputBase
                placeholder="Search…"
                classes={{
                  root: classes.inputRoot,
                  input: classes.inputInput
                }}
                inputProps={{ 'aria-label': 'search' }}
              />
            </div>
          </Toolbar>
        </AppBar>
        <Drawer open={isDrawerOpen} onClose={toggleDrawer}>
          <List className={classes.list}>
            <ListItem button component={Link} to={'/submission'}>
              <ListItemIcon><PublishIcon /></ListItemIcon>
              <ListItemText primary="Submission" />
            </ListItem>
          </List>
        </Drawer>
        <Container maxWidth="md">
          <>{props.children}</>
        </Container>
        <div className={classes.footer}>
          2021 New Xposed Module Repository
        </div>
      </div>
    </MuiThemeProvider>
  )
}
