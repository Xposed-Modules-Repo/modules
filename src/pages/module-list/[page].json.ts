import { getSiteData } from '../../lib/modules'
import type { ModuleListItem } from '../../lib/types'

interface Props {
  modules: ModuleListItem[]
  page: number
  pageCount: number
  total: number
}

export async function getStaticPaths () {
  const data = await getSiteData()
  const pageCount = Math.ceil(data.listItems.length / data.pageSize)

  return Array.from({ length: pageCount }, (_, index) => {
    const page = index + 1
    const start = index * data.pageSize

    return {
      params: { page: String(page) },
      props: {
        modules: data.listItems.slice(start, start + data.pageSize),
        page,
        pageCount,
        total: data.listItems.length
      } satisfies Props
    }
  })
}

export function GET ({ props }: { props: Props }): Response {
  return Response.json(props)
}
