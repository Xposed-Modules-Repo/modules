import type { APIRoute } from "astro"
import modules from "../../.cache/modules.json"

export const GET: APIRoute = ({ params, request }) => {
  return new Response(
    JSON.stringify(
      modules.map((m) => {
        m.releases.splice(1)
        return m
      })
    )
  )
}
