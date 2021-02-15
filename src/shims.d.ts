declare module 'react-use-flexsearch' {
  export interface SearchResult {
    name: string
    description: string
    summary: string
    readmeExcerpt: string
  }
  const useFlexSearch: (query: string, index: object | string, store: object, limit?: number) => SearchResult[]
}

declare module 'segmentit' {
  const Segment: any
  const useDefault: any
}
