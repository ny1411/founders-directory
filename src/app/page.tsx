import { Directory } from "@/components/directory"
import { JsonLd } from "@/components/json-ld"
import { buildInitialDirectoryData, getDirectoryIndex } from "@/lib/directory-query"
import { Suspense } from "react"

export const dynamic = "force-static"
export const revalidate = 3600

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
  const index = await getDirectoryIndex()
  const initialData = await buildInitialDirectoryData(index)

  return (
    <div className="flex flex-col gap-16 pb-16">
      <JsonLd data={jsonLd} />
      <Suspense fallback={<DirectoryFallback companyCount={initialData.totalCount} />}>
        <Directory initialData={initialData} />
      </Suspense>
    </div>
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
