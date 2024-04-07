import * as React from 'react'
import { ReactElement, useState } from 'react'
import Layout from '../layout'
import { createStyles, makeStyles, Theme } from '@material-ui/core/styles'
import SEO from '../components/seo'
import { Button, Container, FormControl, InputLabel, MenuItem, Select, TextField } from '@material-ui/core'

const useStyles = makeStyles((theme: Theme) =>
  createStyles({
    title: {
      textAlign: 'center'
    },
    formControl: {
      margin: theme.spacing(1),
      verticalAlign: 'bottom',
      flex: '1 1 auto'
    },
    formInput: {
      margin: theme.spacing(1),
      verticalAlign: 'bottom',
      flex: '1 1 auto',
      [theme.breakpoints.down('xs')]: {
        minWidth: '100%',
        marginLeft: 0
      }
    },
    label: {
      padding: '1.9rem 0 0.6rem',
      lineHeight: '1rem',
      display: 'inline-block',
      verticalAlign: 'bottom'
    },
    labelInput: {
      padding: '1.9rem 0 0.6rem',
      lineHeight: '1rem',
      display: 'inline-block',
      verticalAlign: 'bottom',
      [theme.breakpoints.down('xs')]: {
        paddingBottom: 0
      }
    },
    flex: {
      display: 'flex',
      alignItems: 'end',
      justifyContent: 'left',
      flexWrap: 'wrap'
    },
    submit: {
      display: 'flex',
      justifyContent: 'center',
      margin: 20
    },
    landing: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      minHeight: 'calc(100vh - 144px)'
    }
  })
)

export default function SubmissionPage (): ReactElement {
  let initialSubmissionType = 'submission'
  if (typeof window !== 'undefined') {
    const match = window.location.search.match(/\?.*type=([^&#]*)/)
    if (match) {
      initialSubmissionType = match[1]
    }
  }
  const classes = useStyles()
  const [submissionType, _setSubmissionType] = useState(initialSubmissionType)
  const setSubmissionType = (type: string): void => {
    _setSubmissionType(type)
    if (typeof window !== 'undefined') {
      history.pushState({}, '', `?type=${type}`)
    }
  }
  const [packageName, setPackageName] = useState('')
  const isPackageNameValid = (): boolean => {
    if (!packageName.match(/\./)) return false
    const groups = packageName.split('.')
    for (const group of groups) {
      if (!group.match(/^[a-zA-Z_][a-zA-Z_0-9]*$/)) return false
    }
    return true
  }
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const showPackageName = (): boolean => {
    return ['submission', 'transfer', 'appeal'].includes(submissionType)
  }
  const isValidForm = (): boolean => {
    return showPackageName() ? !!packageName && isPackageNameValid() : !!title
  }
  const submit = (): void => {
    if (typeof window !== 'undefined') {
      const issueTitle = showPackageName()
        ? `[${submissionType}] ${packageName}`
        : `[${submissionType}] ${title}`
      window.open(`https://github.com/Xposed-Modules-Repo/submission/issues/new?title=${
        encodeURIComponent(issueTitle)
      }&body=${
        encodeURIComponent(description)
      }`, '_blank')
    }
  }
  return (
    <Layout>
      <Container maxWidth="sm" className={classes.landing}>
        <h1 className={classes.title}>Submit Your Xposed Module!</h1>
        <form>
          <div className={classes.flex}>
            <span className={classes.label}>I'd like to </span>
            <FormControl className={classes.formControl}>
              <InputLabel id="select-label">Select</InputLabel>
              <Select
                labelId="select-label"
                id="select"
                value={submissionType}
                onChange={(e) => setSubmissionType(e.target.value as string)}
              >
                <MenuItem value="submission">Submit a new package</MenuItem>
                <MenuItem value="transfer">Transfer package ownership</MenuItem>
                <MenuItem value="appeal">Appeal for package name/ownership</MenuItem>
                <MenuItem value="issue">Report an issue</MenuItem>
                <MenuItem value="suggestion">Give some suggestions</MenuItem>
              </Select>
            </FormControl>
          </div>
          {showPackageName()
            ? (<div className={classes.flex}>
              <span className={classes.labelInput}>Package name: </span>
              <TextField
                label={packageName ? isPackageNameValid() ? 'Package name' : 'Invalid package name' : 'io.github.username.example'}
                className={classes.formInput}
                value={packageName}
                error={!!packageName && !isPackageNameValid()}
                onChange={(e) => setPackageName(e.target.value)}
              />
            </div>)
            : (<div className={classes.flex}>
              <span className={classes.labelInput}>Title: </span>
              <TextField
                label={'Title'}
                className={classes.formInput}
                value={title}
                error={!title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>)
          }
          <div className={classes.flex}>
            <span className={classes.labelInput}>Description (Reason): </span>
            <TextField
              label="Describe it"
              multiline
              className={classes.formInput}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className={classes.submit}>
            <Button variant="contained" color="secondary"
                    disabled={!isValidForm()}
                    onClick={submit}
            >
              Submit
            </Button>
          </div>
        </form>
      </Container>
    </Layout>
  )
}

export const Head = (): ReactElement => <SEO title="Submission" />
