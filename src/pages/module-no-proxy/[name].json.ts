import { moduleJsonNoProxy } from '../../lib/api'
import { getSiteData } from '../../lib/modules'

export async function getStaticPaths () {
  const data = await getSiteData()
  return data.allModules.map(module => ({
    params: { name: module.name },
    props: { module }
  }))
}

export async function GET ({ props }: { props: Awaited<ReturnType<typeof getSiteData>>['allModules'][number] extends infer M ? { module: M } : never }): Promise<Response> {
  return Response.json(moduleJsonNoProxy(props.module))
}
