import { getSiteData } from '../lib/modules'
import { modulesJson } from '../lib/api'

export async function GET (): Promise<Response> {
  const data = await getSiteData()
  return Response.json(modulesJson(data.modules))
}
