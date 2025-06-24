import type { APIRoute } from "astro"
import modules from "../../../.cache/modules.json"

export const GET: APIRoute = ({ params, request }) => {
  return new Response(
    JSON.stringify(
      modules.find((m) => {
        return m.name == params.packageId
      })
    )
  )
}

export function getStaticPaths() {
  return modules.map((m) => {
    return { params: { packageId: m.name } }
  })
}
