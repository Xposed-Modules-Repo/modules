import * as React from 'react'
import {
  Container,
  createMuiTheme,
  CssBaseline,
  Drawer,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  MuiThemeProvider,
  useMediaQuery
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
import AppsIcon from '@material-ui/icons/Apps'
import PublishIcon from '@material-ui/icons/Publish'
import './styles.styl'
import { Link, useStaticQuery, graphql } from 'gatsby'
import { useEffect, useState } from 'react'
import { useFlexSearch } from 'react-use-flexsearch'
import FlexSearch from 'flexsearch'
import * as flexsearchConfig from './flexsearch-config'
import { useDebounce } from './debounce'
import SearchResultCard from './components/search-result-card'

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
      fontSize: 14
    },
    list: {
      width: 250
    },
    searchResult: {
      position: 'absolute',
      right: 0,
      top: 'calc(100% + 8px)',
      [theme.breakpoints.down('xs')]: {
        right: -28
      }
    },
    hide: {
      display: 'none'
    }
  })
)

const index = FlexSearch.create(flexsearchConfig)

export default function Layout (props: { children: React.ReactNode }): React.ReactElement {
  const classes = useStyles()
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [isSearchFocused, _setIsSearchFocused] = useState(false)
  const searchRef = React.createRef<HTMLInputElement>()
  const setIsSearchFocused = (focused: boolean): void => {
    _setIsSearchFocused(focused)
    if (focused) {
      searchRef.current?.focus()
    } else {
      searchRef.current?.blur()
    }
  }
  useEffect(() => {
    const blur = (): void => setIsSearchFocused(false)
    window.addEventListener('click', blur)
    return () => {
      window.removeEventListener('click', blur)
    }
  })
  const debouncedSearchKeyword = useDebounce(searchKeyword, 300)
  const { localSearchRepositories } = useStaticQuery(graphql`
{
  localSearchRepositories {
    index
    store
  }
}
`)
  useEffect(() => {
    index.import(localSearchRepositories.index)
  }, [localSearchRepositories.index])
  const searchResult = useFlexSearch(
    debouncedSearchKeyword,
    index,
    localSearchRepositories.store,
    5
  )
  const toggleDrawer = (): void => {
    setIsDrawerOpen(!isDrawerOpen)
  }
  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)', {
    noSsr: true
  })
  const theme = React.useMemo(
    () => createMuiTheme({
      palette: {
        type: prefersDarkMode ? 'dark' : 'light',
        primary: { main: prefersDarkMode ? '#333' : blue[600] },
        secondary: { main: red.A200 }
      }
    }),
    [prefersDarkMode]
  )
  return (
    <MuiThemeProvider theme={theme}>
      <CssBaseline />
      <div className={classes.root}>
        <AppBar position='sticky'>
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
            <div
              className={classes.search}
              onClick={(e) => { setIsSearchFocused(true); e.stopPropagation() }}
            >
              <div className={classes.searchIcon}>
                <SearchIcon />
              </div>
              <InputBase
                placeholder="Search…"
                classes={{
                  root: classes.inputRoot,
                  input: classes.inputInput
                }}
                inputRef={searchRef}
                inputProps={{ 'aria-label': 'search' }}
                value={searchKeyword}
                onChange={(e) => { setSearchKeyword(e.target.value) }}
              />
              <SearchResultCard
                className={`${classes.searchResult} ${isSearchFocused ? '' : classes.hide}`}
                searchKeyword={debouncedSearchKeyword}
                searchResult={searchResult}
              />
            </div>
          </Toolbar>
        </AppBar>
        <Drawer open={isDrawerOpen} onClose={toggleDrawer}>
          <List className={classes.list}>
            <ListItem button component={Link} to={'/'}>
              <ListItemIcon><AppsIcon /></ListItemIcon>
              <ListItemText primary="Browse" />
            </ListItem>
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
