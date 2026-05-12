import { RepoIcon, StarIcon } from '@primer/octicons-react'
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ModuleListItem } from '../lib/types'

interface Props {
  modules: ModuleListItem[]
  totalCount?: number
  nextPage?: number
  pageUrlTemplate?: string
}

interface ModuleListPage {
  modules: ModuleListItem[]
  page: number
  pageCount: number
  total: number
}

function relativeTime (value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60]
  ]
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

  for (const [unit, unitSeconds] of units) {
    if (seconds >= unitSeconds) return formatter.format(-Math.floor(seconds / unitSeconds), unit)
  }
  return 'just now'
}

function releaseLabels (module: ModuleListItem): ReactElement | null {
  if (!module.latestRelease && !module.latestBetaRelease && !module.latestSnapshotRelease) return null

  return (
    <>
      {module.latestRelease && <span className="Label Label--success">{module.latestRelease}</span>}
      {module.latestBetaRelease && <span className="Label Label--attention">{module.latestBetaRelease}</span>}
      {module.latestSnapshotRelease && <span className="Label Label--secondary">{module.latestSnapshotRelease}</span>}
    </>
  )
}

export default function ModuleList ({
  modules,
  totalCount = modules.length,
  nextPage,
  pageUrlTemplate
}: Props): ReactElement {
  const [items, setItems] = useState(modules)
  const [pageToLoad, setPageToLoad] = useState(nextPage)
  const [isLoading, setIsLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const canFetchMore = Boolean(pageUrlTemplate && pageToLoad)
  const hasMore = items.length < totalCount && canFetchMore && !loadFailed

  useEffect(() => {
    setItems(modules)
    setPageToLoad(nextPage)
    setLoadFailed(false)
  }, [modules, nextPage])

  const loadMore = useCallback(async () => {
    if (!pageUrlTemplate || !pageToLoad || isLoading) return

    setIsLoading(true)
    setLoadFailed(false)
    try {
      const response = await fetch(pageUrlTemplate.replace('{page}', String(pageToLoad)))
      if (!response.ok) throw new Error(`Unable to load module page ${pageToLoad}`)

      const payload = await response.json() as ModuleListPage
      setItems(current => {
        const existingNames = new Set(current.map(module => module.name))
        const nextModules = payload.modules.filter(module => !existingNames.has(module.name))
        return current.concat(nextModules)
      })
      setPageToLoad(payload.page < payload.pageCount ? payload.page + 1 : undefined)
    } catch {
      setLoadFailed(true)
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, loadFailed, pageToLoad, pageUrlTemplate])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore) return

    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        void loadMore()
      }
    }, {
      rootMargin: '480px 0px'
    })

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loadMore])

  const visibleModules = useMemo(() => items, [items])

  return (
    <section className="module-list-shell" aria-label="Modules">
      <div className="module-list-header">
        <div className="module-list-search-placeholder">All repositories</div>
        <div className="module-list-total">{totalCount}</div>
      </div>
      <div className="module-list">
        {visibleModules.map(module => {
          const title = module.description || module.name
          const summary = module.summary?.trim()
          const labels = releaseLabels(module)

          return (
            <article className="module-list-row" key={module.name}>
              <RepoIcon className="module-list-icon" size={16} />
              <div className="module-list-main">
                <div className="module-list-title-line">
                  <h2><a href={`/module/${module.name}/`}>{title}</a></h2>
                  <span className="Label Label--secondary module-list-package">{module.name}</span>
                </div>
                {summary && <p className="module-list-description">{summary}</p>}
                <div className="module-list-meta">
                  {labels && <span className="module-list-releases">{labels}</span>}
                  {typeof module.stargazerCount === 'number' && module.stargazerCount > 0 && (
                    <span className="module-list-meta-item">
                      <StarIcon size={14} />
                      {module.stargazerCount}
                    </span>
                  )}
                  {module.updatedAt && (
                    <time className="module-list-meta-item" dateTime={module.updatedAt} suppressHydrationWarning>
                      Updated {relativeTime(module.updatedAt)}
                    </time>
                  )}
                </div>
              </div>
              <div className="module-list-actions">
                {module.homepageUrl && <a className="btn btn-sm" href={module.homepageUrl} target="_blank" rel="noreferrer">Website</a>}
                {module.sourceUrl && <a className="btn btn-sm" href={module.sourceUrl} target="_blank" rel="noreferrer">Source</a>}
              </div>
            </article>
          )
        })}
      </div>
      {hasMore && (
        <div className="module-list-loader" ref={sentinelRef}>
          {isLoading ? 'Loading more modules...' : 'Scroll to load more'}
        </div>
      )}
      {loadFailed && (
        <button className="module-list-loader module-list-retry" type="button" onClick={() => { void loadMore() }}>
          Retry loading modules
        </button>
      )}
    </section>
  )
}
