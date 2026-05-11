import { getSiteData } from '../lib/modules'

export async function GET (): Promise<Response> {
  const data = await getSiteData()
  return Response.json(data.searchRecords)
}
