import { useEffect, useMemo, useState } from 'react'
import { IssueOpenedIcon } from '@primer/octicons-react'

type SubmitType = 'submission' | 'transfer' | 'appeal' | 'issue' | 'suggestion'

interface SubmitOption {
  value: SubmitType
  label: string
}

const submitOptions: SubmitOption[] = [
  { value: 'submission', label: 'Submit a new package' },
  { value: 'transfer', label: 'Transfer package ownership' },
  { value: 'appeal', label: 'Appeal for package name/ownership' },
  { value: 'issue', label: 'Report an issue' },
  { value: 'suggestion', label: 'Give some suggestions' }
]

const packageTypes = new Set<SubmitType>(['submission', 'transfer', 'appeal'])
const issueBaseUrl = 'https://github.com/Xposed-Modules-Repo/submission/issues/new'

function isSubmitType (value: string | null): value is SubmitType {
  return submitOptions.some(option => option.value === value)
}

function isPackageType (value: SubmitType): boolean {
  return packageTypes.has(value)
}

function validPackageName (value: string): boolean {
  if (!value.includes('.')) return false
  return value.split('.').every(part => /^[a-zA-Z_][a-zA-Z_0-9]*$/.test(part))
}

export default function SubmissionForm () {
  const [type, setType] = useState<SubmitType>('submission')
  const [packageName, setPackageName] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const requestedType = params.get('type')
    if (isSubmitType(requestedType)) setType(requestedType)
  }, [])

  const usesPackageName = isPackageType(type)
  const packageIsValid = validPackageName(packageName)
  const canSubmit = usesPackageName
    ? packageName.length > 0 && packageIsValid
    : title.trim().length > 0

  const issueUrl = useMemo(() => {
    const issueTitle = usesPackageName
      ? `[${type}] ${packageName}`
      : `[${type}] ${title.trim()}`
    const params = new URLSearchParams({
      title: issueTitle,
      body: description
    })
    return `${issueBaseUrl}?${params.toString()}`
  }, [description, packageName, title, type, usesPackageName])

  function updateType (nextType: SubmitType): void {
    setType(nextType)
    const url = new URL(window.location.href)
    url.searchParams.set('type', nextType)
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  }

  function submitIssue (event: { preventDefault: () => void }): void {
    event.preventDefault()
    if (!canSubmit) return
    window.location.assign(issueUrl)
  }

  return (
    <form className="submission-form" onSubmit={submitIssue}>
      <label className="submission-field">
        <span className="submission-label">I'd like to</span>
        <select
          className="submission-control submission-select"
          value={type}
          onChange={event => updateType(event.target.value as SubmitType)}
        >
          {submitOptions.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>

      {usesPackageName
        ? (
            <label className="submission-field">
              <span className="submission-label">Package name</span>
              <input
                className="submission-control"
                value={packageName}
                aria-invalid={packageName.length > 0 && !packageIsValid}
                placeholder="io.github.username.example"
                onChange={event => setPackageName(event.target.value.trim())}
              />
              {packageName.length > 0 && !packageIsValid && (
                <span className="submission-error">Use a valid Android package name.</span>
              )}
            </label>
          )
        : (
            <label className="submission-field">
              <span className="submission-label">Title</span>
              <input
                className="submission-control"
                value={title}
                placeholder="Short title"
                onChange={event => setTitle(event.target.value)}
              />
            </label>
          )}

      <label className="submission-field">
        <span className="submission-label">Description or reason</span>
        <textarea
          className="submission-control submission-textarea"
          value={description}
          placeholder="Describe the module, ownership request, issue, or suggestion."
          rows={6}
          onChange={event => setDescription(event.target.value)}
        />
      </label>

      <div className="submission-actions">
        <button className="btn btn-primary" type="submit" disabled={!canSubmit}>
          <IssueOpenedIcon size={16} />
          Submit on GitHub
        </button>
      </div>
    </form>
  )
}
