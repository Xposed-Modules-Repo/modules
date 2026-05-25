import { getSiteData } from '../lib/modules'
import { modulesJsonNoProxy } from '../lib/api'

export async function GET (): Promise<Response> {
  const data = await getSiteData()
  return Response.json(modulesJsonNoProxy(data.modules))
}
