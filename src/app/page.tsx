import { adminDb } from "@/lib/firebase-admin"
import { INDUSTRIES } from "@/lib/industry-filter"
import { EMPLOYEE_RANGES } from "@/lib/employee-filter"
import { getDirectoryOptions } from "@/lib/directory-options"
import { directoryParams, FILTER_GROUPS, parseCursor, parseDirectoryFilters, parsePage, scalarParam, toggleSelection, updateDirectoryParams } from "@/lib/directory-filters"
import { loadDirectoryPage } from "@/lib/directory-query"
import { cn } from "@/lib/utils"
import { Company } from "@/lib/types"
import Link from "next/link"
import Image from "next/image"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { buttonVariants } from "@/components/ui/button"
import { Check, Search } from "lucide-react"
import { SubmitCompanyButton } from "@/components/submit-company-button"
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts"
import { BatchSelect } from "@/components/batch-select"

export default async function Home(props: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const [searchParams, { batches, vcs }] = await Promise.all([props.searchParams, getDirectoryOptions()]);
  const filters = parseDirectoryFilters(searchParams ?? {}, { batches, vcs })
  const { q, sort } = filters
  const { companies, totalCount, totalPages, page, firstItemCursor, lastItemCursor } = await loadDirectoryPage(
    adminDb.collection("companies"), filters, parsePage(searchParams?.page),
    parseCursor(searchParams?.cursor), scalarParam(searchParams?.direction)
  )
  const params = directoryParams(filters)
  const buildUrl = (overrides: Record<string, string | string[] | number | null>) =>
    `/?${updateDirectoryParams(params, overrides).toString()}`
  const selectedClass = (selected: boolean) => cn("text-sm transition-colors flex items-center gap-2", selected
    ? "text-foreground font-medium" : "text-secondary-foreground hover:text-foreground")

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
            "urlTemplate": "https://foundersdirectory.com/?q={search_term_string}"
          },
          "query-input": "required name=search_term_string"
        }
      },
      {
        "@type": "CollectionPage",
        "@id": "https://foundersdirectory.com/#webpage",
        "url": "https://foundersdirectory.com/",
        "name": "Founders Directory - Startup Collection",
        "isPartOf": { "@id": "https://foundersdirectory.com/#website" }
      }
    ]
  };

  return (
    <div className="flex flex-col gap-16 pb-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      {/* Hero Section */}
      <section className="flex flex-col gap-6 max-w-3xl pt-10">
        <h1 className="font-serif text-5xl md:text-7xl leading-tight text-foreground tracking-tight">
          Find the Right YC Founders. Reach Out Better.
        </h1>
        <p className="text-xl text-secondary-foreground leading-relaxed font-light">
          Search 900+ YC startups, find the right founders, and send personalized cold DMs in minutes.
        </p>
        <div className="flex items-center gap-4 mt-4">
          <div className="flex flex-col">
            <span className="text-3xl font-serif text-foreground">{totalCount}</span>
            <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Companies</span>
          </div>
          <SubmitCompanyButton />
        </div>
      </section>

      {/* Main Content & Sidebar */}
      <div className="flex flex-col md:flex-row gap-12">
        
        {/* Sidebar Filters */}
        <aside className="w-full md:w-56 flex flex-col gap-10 shrink-0">
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">Match any option within a group; all groups apply.</p>
            <Link href={buildUrl({ industry: [], employees: [], batch: [], vc: [] })} className="text-xs underline text-secondary-foreground">Clear all filters</Link>
          </div>
          <div>
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-4">Batch</h3>
            <BatchSelect batches={batches} />
          </div>

          {([
            { key: "vc", label: "VC Backer", all: "All VCs", options: vcs },
            { key: "industry", label: "Industry", all: "All Industries", options: INDUSTRIES },
            { key: "employees", label: "Employees", all: "Any Size", options: EMPLOYEE_RANGES },
          ] as const).map(group => (
            <div key={group.key}>
              <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-4">{group.label}</h3>
              <div className="flex flex-col gap-2.5">
                <Link href={buildUrl({ [group.key]: [] })} aria-current={!filters[group.key].length ? "true" : undefined}
                  className={selectedClass(!filters[group.key].length)}>{group.all}</Link>
                {group.options.map(value => {
                  const selected = filters[group.key].includes(value)
                  return (
                    <Link key={value} href={buildUrl({ [group.key]: toggleSelection(filters[group.key], value) })}
                      aria-current={selected ? "true" : undefined} className={selectedClass(selected)}>
                      <span aria-hidden="true" className="w-3 shrink-0">{selected ? <Check className="size-3" /> : null}</span>{value}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </aside>

        {/* Content Area */}
        <div className="flex-1 flex flex-col gap-8 min-w-0">
          
          {/* Search Bar & Controls */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <form method="GET" action="/" className="relative w-full sm:max-w-md">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                id="search-input"
                name="q" 
                placeholder="Search companies..." 
                key={q}
                defaultValue={q} 
                className="pl-11 pr-12 h-12 bg-transparent border-border rounded-full focus-visible:ring-1 focus-visible:ring-foreground transition-all text-base placeholder:text-muted-foreground"
              />
              <KeyboardShortcuts />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center justify-center w-6 h-6 rounded border border-border bg-card text-[10px] text-muted-foreground font-medium">
                /
              </div>
              {FILTER_GROUPS.flatMap(group => filters[group].map(value => (
                <input key={`${group}:${value}`} type="hidden" name={group} value={value} />
              )))}
              {sort !== "asc" && <input type="hidden" name="sort" value={sort} />}
            </form>

            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Sort</span>
              <Link href={buildUrl({ sort: sort === 'asc' ? 'desc' : 'asc' })} className="text-sm font-medium text-secondary-foreground hover:text-foreground transition-colors">
                {sort === 'asc' ? 'A-Z' : 'Z-A'}
              </Link>
            </div>
          </div>

          {/* Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {companies.map((company: Company) => (
              <Link key={company.id} href={`/company/${company.slug}`} className="block h-full group">
                <Card className="h-full bg-card border border-border rounded-2xl p-6 flex flex-col gap-4 transition-all duration-200 hover:bg-accent/50 hover:border-foreground/20 shadow-none">
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex gap-3 items-center">
                      {company.logoUrl && (
                        <Image src={company.logoUrl} alt={`${company.name} logo`} width={32} height={32} className="w-8 h-8 rounded-full object-cover border border-border" />
                      )}
                      <h2 className="text-xl font-medium tracking-tight text-foreground group-hover:text-primary transition-colors">
                        {company.name}
                      </h2>
                    </div>
                    {company.vcBacker && (
                      <span className="shrink-0 px-2.5 py-1 rounded-full border border-border text-[10px] font-bold uppercase tracking-widest text-secondary-foreground bg-transparent">
                        {company.vcBacker}
                      </span>
                    )}
                  </div>
                  
                  {company.oneLiner && (
                    <p className="text-sm font-medium text-foreground">
                      {company.oneLiner}
                    </p>
                  )}
                  
                  <p className="text-sm text-secondary-foreground line-clamp-2 leading-relaxed flex-1 font-light">
                    {company.description || "No description available."}
                  </p>
                  
                  <div className="pt-2 mt-auto flex flex-wrap gap-2 items-center">
                    {company.industry && (
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground bg-secondary/50 px-2 py-1 rounded-md">
                        {company.industry}
                      </span>
                    )}

                    {company.location && (
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground bg-secondary/50 px-2 py-1 rounded-md">
                        {company.location}
                      </span>
                    )}

                    {company.tags && Array.isArray(company.tags) && company.tags.map((tag: string, idx: number) => (
                      <span key={idx} className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground bg-secondary/50 px-2 py-1 rounded-md">
                        {tag.trim()}
                      </span>
                    ))}
                  </div>
                </Card>
              </Link>
            ))}
            
            {companies.length === 0 && (
              <div className="col-span-full py-24 flex flex-col items-center justify-center border border-dashed border-border rounded-2xl">
                <h3 className="text-lg font-medium text-foreground">No companies found</h3>
                <p className="text-secondary-foreground mt-2 font-light">Try adjusting your filters or search query.</p>
                <Link href={buildUrl({ q: null, industry: [], employees: [], batch: [], vc: [] })} className={buttonVariants({ variant: "outline", className: "mt-6 rounded-full border-border hover:bg-accent" })}>
                  Clear Filters
                </Link>
              </div>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 mt-8">
              <Link 
                href={page > 1 && firstItemCursor ? buildUrl({ page: page - 1, cursor: firstItemCursor, direction: "prev" }) : '#'} 
                className={buttonVariants({ variant: "outline", className: `rounded-full ${page <= 1 ? 'pointer-events-none opacity-50' : ''}` })}
                aria-disabled={page <= 1}
              >
                Previous
              </Link>
              
              <span className="text-sm font-medium text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              
              <Link 
                href={page < totalPages && lastItemCursor ? buildUrl({ page: page + 1, cursor: lastItemCursor, direction: "next" }) : '#'} 
                className={buttonVariants({ variant: "outline", className: `rounded-full ${page >= totalPages ? 'pointer-events-none opacity-50' : ''}` })}
                aria-disabled={page >= totalPages}
              >
                Next
              </Link>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
