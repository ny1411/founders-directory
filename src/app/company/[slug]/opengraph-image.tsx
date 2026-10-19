// Older shared links may point here. All companies use the shared static image,
// so social crawlers never trigger a company lookup or per-slug image rendering.
export const alt = "Founders Directory"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"
export const revalidate = 86400

export default function Image() {
  return new Response(null, {
    status: 308,
    headers: {
      Location: "/opengraph-image",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  })
}
