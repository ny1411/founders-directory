import { Directory } from "@/components/directory"
import { JsonLd } from "@/components/json-ld"
import { buildInitialDirectoryData, getDirectoryIndex } from "@/lib/directory-query"
import type { DirectoryInitialData } from "@/lib/directory-types"
import { Suspense } from "react"

export const dynamic = "force-static"
export const revalidate = 300

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://foundersdirectory.com/#website",
      "url": "https://foundersdirectory.com/",
      "name": "Founders Directory",
      "description": "Discover YC startups and VC-backed founders.",
      "potentialAction": {
        "@type": "SearchAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://foundersdirectory.com/?q={search_term_string}",
        },
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@type": "CollectionPage",
      "@id": "https://foundersdirectory.com/#webpage",
      "url": "https://foundersdirectory.com/",
      "name": "Founders Directory - Startup Collection",
      "isPartOf": { "@id": "https://foundersdirectory.com/#website" },
    },
  ],
}

export default async function Home() {
  let initialData: DirectoryInitialData
  try {
    const index = await getDirectoryIndex()
    initialData = await buildInitialDirectoryData(index)
  } catch {
    // Keep builds and the cached public route available during backend outages.
    // Never publish an empty directory or expose database exception details.
    console.warn(JSON.stringify({ event: "directory.home_unavailable" }))
    return <DirectoryUnavailable />
  }

  return (
    <div className="flex flex-col gap-16 pb-16">
      <JsonLd data={jsonLd} />
      <Suspense fallback={<DirectoryFallback companyCount={initialData.totalCount} />}>
        <Directory initialData={initialData} />
      </Suspense>
    </div>
  )
}

function DirectoryUnavailable() {
  return (
    <section className="flex flex-col gap-6 max-w-3xl py-16" role="status" aria-labelledby="directory-unavailable-title">
      <h1 id="directory-unavailable-title" className="font-serif text-5xl md:text-7xl leading-tight text-foreground tracking-tight">
        Directory temporarily unavailable
      </h1>
      <p className="text-xl text-secondary-foreground leading-relaxed font-light">
        We couldn’t load the company directory. Please try again in a few minutes.
      </p>
      {/* A full document reload retries the public route without client prefetch or polling. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className="text-sm text-foreground underline underline-offset-4 self-start">
        Reload directory
      </a>
    </section>
  )
}

function DirectoryFallback({ companyCount }: { companyCount: number }) {
  return (
    <section className="flex flex-col gap-6 max-w-3xl pt-10" aria-busy="true">
      <h1 className="font-serif text-5xl md:text-7xl leading-tight text-foreground tracking-tight">
        Find the Right YC Founders. Reach Out Better.
      </h1>
      <p className="text-xl text-secondary-foreground leading-relaxed font-light">
        Search {companyCount}+ YC startups, find the right founders, and send personalized cold DMs in minutes.
      </p>
      <p className="text-sm text-muted-foreground">Loading directory controls…</p>
    </section>
  )
}
