import { SearchIcon } from '@primer/octicons-react'
import { type ReactElement, useEffect, useMemo, useState } from 'react'
import type { SearchRecord } from '../lib/types'

function normalize (value: string | null | undefined): string {
  return (value || '').toLocaleLowerCase()
}

export default function SearchBox (): ReactElement {
  const [records, setRecords] = useState<SearchRecord[]>([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    fetch('/search.json')
      .then(response => response.ok ? response.json() : [])
      .then((data: SearchRecord[]) => setRecords(data))
      .catch(() => setRecords([]))
  }, [])

  const results = useMemo(() => {
    const value = normalize(query).trim()
    if (!value) return []

    return records
      .map(record => {
        const haystack = normalize([
          record.name,
          record.description,
          record.summary,
          record.readmeExcerpt,
          record.release,
          record.authors
        ].filter(Boolean).join(' '))

        if (!haystack.includes(value)) return null
        const nameScore = normalize(record.name).includes(value) ? 2 : 0
        const titleScore = normalize(record.description).includes(value) ? 1 : 0
        return { record, score: nameScore + titleScore }
      })
      .filter((result): result is { record: SearchRecord, score: number } => Boolean(result))
      .sort((left, right) => right.score - left.score || left.record.name.localeCompare(right.record.name))
      .slice(0, 10)
      .map(result => result.record)
  }, [query, records])

  return (
    <div className="search-shell">
      <label className="sr-only" htmlFor="site-search">Search modules</label>
      <div className="search-box">
        <SearchIcon className="search-icon" size={16} />
        <input
          id="site-search"
          className="search-input"
          type="search"
          value={query}
          placeholder="Search modules"
          autoComplete="off"
          onChange={event => setQuery(event.target.value)}
        />
      </div>
      {query && (
        <div className="search-results" role="listbox">
          {results.length
            ? results.map(result => (
              <a className="search-result" href={`/module/${result.name}/`} key={result.name}>
                <strong>{result.description || result.name}</strong>
                <span>{result.summary || result.readmeExcerpt || result.name}</span>
              </a>
            ))
            : <div className="search-result"><span>No results found</span></div>}
        </div>
      )}
    </div>
  )
}
