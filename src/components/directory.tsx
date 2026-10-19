"use client"

import { BatchSelect } from "@/components/batch-select"
import { EntityImage } from "@/components/entity-image"
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts"
import { SubmitCompanyButton } from "@/components/submit-company-button"
import { buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  directoryParams,
  FILTER_GROUPS,
  parseDirectoryFilters,
  parsePage,
  toggleSelection,
  updateDirectoryParams,
  type SearchParams,
} from "@/lib/directory-filters"
import type { DirectoryInitialData, DirectoryPageData } from "@/lib/directory-types"
import { EMPLOYEE_RANGES } from "@/lib/employee-filter"
import { INDUSTRIES } from "@/lib/industry-filter"
import { cn } from "@/lib/utils"
import { Check, Search } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState, useSyncExternalStore } from "react"

const subscribeToHydration = () => () => undefined
type DirectoryError = { message: string; retryAt: number | null }

export function Directory({ initialData }: { initialData: DirectoryInitialData }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false)
  const rawParams = useMemo(
    () => hydrated ? toSearchParams(searchParams) : {},
    [hydrated, searchParams],
  )
  const filters = useMemo(
    () => parseDirectoryFilters(rawParams, initialData),
    [rawParams, initialData],
  )
  const params = directoryParams(filters)
  const requestedPage = parsePage(rawParams.page)
  if (requestedPage > 1) params.set("page", String(requestedPage))
  const requestQuery = params.toString()
  const [remote, setRemote] = useState<{ query: string; data: DirectoryPageData; error?: DirectoryError }>({
    query: "",
    data: initialData,
  })
  const [attempt, setAttempt] = useState(0)
  const [now, setNow] = useState(0)
  const loading = Boolean(requestQuery) && remote.query !== requestQuery
  const error = requestQuery && remote.query === requestQuery ? remote.error : undefined
  const retrySeconds = error?.retryAt ? Math.max(0, Math.ceil((error.retryAt - now) / 1000)) : 0
  const displayedResult = !requestQuery || loading ? initialData : remote.data

  useEffect(() => {
    if (!requestQuery) return

    const controller = new AbortController()
    void fetch(`/api/directory?${requestQuery}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) {
          if (controller.signal.aborted) return
          const failure = directoryError(response)
          setNow(Date.now())
          setRemote({ query: requestQuery, data: initialData, error: failure })
          return
        }
        const data = await response.json() as DirectoryPageData
        if (!controller.signal.aborted) setRemote({ query: requestQuery, data })
      })
      .catch(() => {
        if (!controller.signal.aborted) setRemote({ query: requestQuery, data: initialData,
          error: { message: "Search is temporarily unavailable. Please try again.", retryAt: null } })
      })

    return () => controller.abort()
  }, [initialData, requestQuery, attempt])

  useEffect(() => {
    if (!error?.retryAt || retrySeconds === 0) return
    const timer = window.setTimeout(() => setNow(Date.now()), 1000)
    return () => window.clearTimeout(timer)
  }, [error?.retryAt, retrySeconds])

  const buildUrl = (overrides: Record<string, string | string[] | number | null>) => {
    const query = updateDirectoryParams(params, overrides).toString()
    return query ? `/?${query}` : "/"
  }
  const selectedClass = (selected: boolean) => cn(
    "text-sm transition-colors flex items-center gap-2",
    selected ? "text-foreground font-medium" : "text-secondary-foreground hover:text-foreground",
  )

  return (
    <>
      <section className="flex flex-col gap-6 max-w-3xl pt-10">
        <h1 className="font-serif text-5xl md:text-7xl leading-tight text-foreground tracking-tight">
          Find the Right YC Founders. Reach Out Better.
        </h1>
        <p className="text-xl text-secondary-foreground leading-relaxed font-light">
          Search {initialData.totalCount.toLocaleString()}+ YC startups, find the right founders, and send personalized cold DMs in minutes.
        </p>
        <div className="flex items-center gap-4 mt-4">
          <div className="flex flex-col">
            <span className="text-3xl font-serif text-foreground">{displayedResult.totalCount}</span>
            <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Companies</span>
          </div>
          <SubmitCompanyButton />
        </div>
      </section>

      <div className="flex flex-col md:flex-row gap-12">
        <aside className="w-full md:w-56 flex flex-col gap-10 shrink-0">
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">Match any option within a group; all groups apply.</p>
            <Link href={buildUrl({ industry: [], employees: [], batch: [], vc: [] })} className="text-xs underline text-secondary-foreground">
              Clear all filters
            </Link>
          </div>
          <div>
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-4">Batch</h3>
            <BatchSelect
              batches={initialData.batches}
              value={filters.batch}
              onValueChange={batch => router.push(buildUrl({ batch }))}
            />
          </div>

          {([
            { key: "vc", label: "VC Backer", all: "All VCs", options: initialData.vcs },
            { key: "industry", label: "Industry", all: "All Industries", options: INDUSTRIES },
            { key: "employees", label: "Employees", all: "Any Size", options: EMPLOYEE_RANGES },
          ] as const).map(group => (
            <div key={group.key}>
              <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-4">{group.label}</h3>
              <div className="flex flex-col gap-2.5">
                <Link
                  href={buildUrl({ [group.key]: [] })}
                  aria-current={!filters[group.key].length ? "true" : undefined}
                  className={selectedClass(!filters[group.key].length)}
                >
                  {group.all}
                </Link>
                {group.options.map(value => {
                  const selected = filters[group.key].includes(value)
                  return (
                    <Link
                      key={value}
                      href={buildUrl({ [group.key]: toggleSelection(filters[group.key], value) })}
                      aria-current={selected ? "true" : undefined}
                      className={selectedClass(selected)}
                    >
                      <span aria-hidden="true" className="w-3 shrink-0">{selected ? <Check className="size-3" /> : null}</span>
                      {value}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </aside>

        <div className="flex-1 flex flex-col gap-8 min-w-0" aria-busy={requestQuery ? loading : false}>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <form method="GET" action="/" className="relative w-full sm:max-w-md">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="search-input"
                name="q"
                placeholder="Search companies..."
                key={filters.q}
                defaultValue={filters.q}
                className="pl-11 pr-12 h-12 bg-transparent border-border rounded-full focus-visible:ring-1 focus-visible:ring-foreground transition-all text-base placeholder:text-muted-foreground"
              />
              <KeyboardShortcuts />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center justify-center w-6 h-6 rounded border border-border bg-card text-[10px] text-muted-foreground font-medium">
                /
              </div>
              {FILTER_GROUPS.flatMap(group => filters[group].map(value => (
                <input key={`${group}:${value}`} type="hidden" name={group} value={value} />
              )))}
              {filters.sort !== "asc" && <input type="hidden" name="sort" value={filters.sort} />}
            </form>

            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Sort</span>
              <Link
                href={buildUrl({ sort: filters.sort === "asc" ? "desc" : "asc" })}
                className="text-sm font-medium text-secondary-foreground hover:text-foreground transition-colors"
              >
                {filters.sort === "asc" ? "A-Z" : "Z-A"}
              </Link>
            </div>
          </div>

          {error && (
            <div role="alert" className="rounded-2xl border border-border p-6 text-sm text-secondary-foreground">
              <p>{error.message}</p>
              {retrySeconds > 0 && <p role="status">Try again in {retrySeconds} {retrySeconds === 1 ? "second" : "seconds"}.</p>}
              <button type="button" disabled={retrySeconds > 0}
                className={buttonVariants({ variant: "outline", className: "mt-4 rounded-full disabled:opacity-50" })}
                onClick={() => { setRemote(previous => ({ ...previous, query: "", error: undefined })); setAttempt(value => value + 1) }}>
                Retry search
              </button>
            </div>
          )}
          {!error && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {displayedResult.companies.map(company => (
              <Link key={company.id} href={`/company/${company.slug}`} className="block h-full group">
                <Card className="h-full bg-card border border-border rounded-2xl p-6 flex flex-col gap-4 transition-all duration-200 hover:bg-accent/50 hover:border-foreground/20 shadow-none">
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex gap-3 items-center">
                      <EntityImage
                        src={company.logoUrl}
                        alt={`${company.name} logo`}
                        fallback="company"
                        fallbackLabel={`${company.name} logo unavailable`}
                        width={32}
                        height={32}
                        className="w-8 h-8 rounded-full object-cover border border-border"
                      />
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

                  {company.oneLiner && <p className="text-sm font-medium text-foreground">{company.oneLiner}</p>}
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
                    {company.tags?.map((tag, index) => (
                      <span key={`${tag}:${index}`} className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground bg-secondary/50 px-2 py-1 rounded-md">
                        {tag.trim()}
                      </span>
                    ))}
                  </div>
                </Card>
              </Link>
            ))}

            {displayedResult.companies.length === 0 && (
              <div className="col-span-full py-24 flex flex-col items-center justify-center border border-dashed border-border rounded-2xl">
                <h3 className="text-lg font-medium text-foreground">No companies found</h3>
                <p className="text-secondary-foreground mt-2 font-light">Try adjusting your filters or search query.</p>
                <Link
                  href={buildUrl({ q: null, industry: [], employees: [], batch: [], vc: [] })}
                  className={buttonVariants({ variant: "outline", className: "mt-6 rounded-full border-border hover:bg-accent" })}
                >
                  Clear Filters
                </Link>
              </div>
            )}
          </div>}

          {requestQuery && loading && <p className="text-center text-xs text-muted-foreground">Updating directory…</p>}

          {!error && displayedResult.totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 mt-8">
              <Link
                href={displayedResult.page > 1 ? buildUrl({ page: displayedResult.page - 1 }) : "#"}
                className={buttonVariants({ variant: "outline", className: `rounded-full ${displayedResult.page <= 1 ? "pointer-events-none opacity-50" : ""}` })}
                aria-disabled={displayedResult.page <= 1}
              >
                Previous
              </Link>
              <span className="text-sm font-medium text-muted-foreground">
                Page {displayedResult.page} of {displayedResult.totalPages}
              </span>
              <Link
                href={displayedResult.page < displayedResult.totalPages ? buildUrl({ page: displayedResult.page + 1 }) : "#"}
                className={buttonVariants({ variant: "outline", className: `rounded-full ${displayedResult.page >= displayedResult.totalPages ? "pointer-events-none opacity-50" : ""}` })}
                aria-disabled={displayedResult.page >= displayedResult.totalPages}
              >
                Next
              </Link>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function directoryError(response: Response): DirectoryError {
  const message = response.status === 429 ? "Too many searches. Please wait before trying again."
    : response.status === 400 ? "This search is too long. Shorten it and try again."
      : "Search is temporarily unavailable. Please try again."
  // Do not display server response bodies: proxies/providers can return HTML or
  // internal diagnostics. Honor either supported Retry-After format, bounded to
  // one day so malformed upstream headers cannot disable retries indefinitely.
  const header = response.headers.get("Retry-After")
  const seconds = header && /^\d+$/.test(header) ? Number(header) : null
  const deadline = seconds !== null ? Date.now() + seconds * 1000 : header ? Date.parse(header) : NaN
  const retryAt = Number.isFinite(deadline) ? Math.min(Date.now() + 86400000, Math.max(Date.now(), deadline)) : null
  return { message, retryAt }
}

function toSearchParams(params: ReturnType<typeof useSearchParams>): SearchParams {
  const result: SearchParams = {}
  for (const key of ["q", "sort", "industry", "employees", "batch", "vc", "page"] as const) {
    const values = params.getAll(key)
    if (values.length === 1) result[key] = values[0]
    if (values.length > 1) result[key] = values
  }
  return result
}
