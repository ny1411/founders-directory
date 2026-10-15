import { adminDb } from "@/lib/firebase-admin"
import { INDUSTRIES, loadIndustryCandidates, matchesIndustry, parseIndustry } from "@/lib/industry-filter"
import { EMPLOYEE_RANGES, loadEmployeeCandidates, matchesEmployeeRange, parseEmployeeRange } from "@/lib/employee-filter"
import { paginateCompanies } from "@/lib/company-pagination"
import { getBatchOptions } from "@/lib/batch-options"
import { loadBatchCandidates, matchesBatch, parseBatch } from "@/lib/batch-filter"
import { Company } from "@/lib/types"
import { FieldPath, type Query } from "firebase-admin/firestore"
import Link from "next/link"
import Image from "next/image"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { buttonVariants } from "@/components/ui/button"
import { Search } from "lucide-react"
import { SubmitCompanyButton } from "@/components/submit-company-button"
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts"
import { BatchSelect } from "@/components/batch-select"
import { Suspense } from "react"

export default async function Home(props: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const [searchParams, batches] = await Promise.all([props.searchParams, getBatchOptions()]);
  const q = (searchParams?.q as string) || ""
  const vc = (searchParams?.vc as string) || "all"
  const industry = parseIndustry(searchParams?.industry)
  const sort = (searchParams?.sort as string) || "asc"
  const pageParam = searchParams?.page as string
  let page = pageParam ? parseInt(pageParam, 10) : 1
  const employees = parseEmployeeRange(searchParams?.employees)
  const batch = parseBatch(searchParams?.batch, batches)
  const cursor = (searchParams?.cursor as string);
  const direction = (searchParams?.direction as string) || "next";

  const take = 10;
  let companies: Company[];
  let totalCount: number;
  let totalPages: number;
  let firstItemCursor: string | null;
  let lastItemCursor: string | null;

  if (batch !== "all" || industry !== "all" || employees !== "all") {
    const collection = adminDb.collection("companies");
    const candidates = batch !== "all"
      ? await loadBatchCandidates(collection, batch)
      : industry !== "all"
        ? await loadIndustryCandidates(collection, industry)
        : await loadEmployeeCandidates(collection, employees);
    const searchQ = q.trim().toLowerCase();
    const filtered = candidates.filter(company =>
      (!q || (company.slug >= searchQ && company.slug <= searchQ + "\uf8ff")) &&
      (vc === "all" || company.vcBacker === vc) &&
      matchesBatch(company.batch, batch) &&
      matchesIndustry(company, industry) &&
      matchesEmployeeRange(company.employees, employees)
    );
    ({ companies, totalCount, totalPages, page, firstItemCursor, lastItemCursor } = paginateCompanies(filtered, page, sort, take));
  } else {
    let companiesQuery: Query = adminDb.collection("companies");

    if (q) {
      const searchQ = q.trim().toLowerCase();
      companiesQuery = companiesQuery.where('slug', '>=', searchQ).where('slug', '<=', searchQ + '\uf8ff');
    }
    if (vc !== "all") {
      companiesQuery = companiesQuery.where("vcBacker", "==", vc);
    }

    // Sort
    const sortDirection = sort === 'asc' ? 'asc' : 'desc';

    // Base query separation: Get total count BEFORE applying orderBy
    const countSnapshot = await companiesQuery.count().get();
    totalCount = countSnapshot.data().count;
    totalPages = Math.ceil(totalCount / take);

    // Apply sorting AFTER count
    companiesQuery = companiesQuery
      .orderBy("slug", sortDirection)
      .orderBy(FieldPath.documentId(), sortDirection);

    if (cursor) {
      try {
        const [cursorName, cursorId] = JSON.parse(cursor);
        if (direction === "prev") {
          companiesQuery = companiesQuery.endBefore(cursorName, cursorId).limitToLast(take);
        } else {
          companiesQuery = companiesQuery.startAfter(cursorName, cursorId).limit(take);
        }
      } catch {
        companiesQuery = companiesQuery.limit(take);
      }
    } else {
      companiesQuery = companiesQuery.limit(take);
    }

    const snapshot = await companiesQuery.get();

    companies = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as Company[];

    firstItemCursor = snapshot.docs.length > 0
      ? JSON.stringify([ snapshot.docs[0].get("employees"), snapshot.docs[0].get("slug"), snapshot.docs[0].id])
      : null;
    lastItemCursor = snapshot.docs.length > 0
      ? JSON.stringify([snapshot.docs[snapshot.docs.length - 1].get("employees"), snapshot.docs[snapshot.docs.length - 1].get("slug"), snapshot.docs[snapshot.docs.length - 1].id])
      : null;
  }

  // Dummy filter arrays (In real app, you might group by from DB)
  const vcs = ["YCombinator"]
  const industries = INDUSTRIES
  const employeeRanges = EMPLOYEE_RANGES

  const buildUrl = (overrides: Record<string, string | number | null>) => {
    const params = new URLSearchParams()
    if (q) params.set("q", q)
    if (vc !== "all") params.set("vc", vc)
    if (industry !== "all") params.set("industry", industry)
    if (sort !== "asc") params.set("sort", sort)
    if (employees !== "all") params.set("employees", employees)
    if (batch !== "all") params.set("batch", batch)
    if (page > 1) params.set("page", page.toString())

    Object.entries(overrides).forEach(([key, value]) => {
      if (value === "all" || value === 1 || (value === "asc" && key === "sort") || value === null || value === undefined) {
        params.delete(key)
      } else {
        params.set(key, value.toString())
      }
    })

    return `/?${params.toString()}`
  }

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
          <div>
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-4">Batch</h3>
            <Suspense fallback={<div className="relative h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 shadow-sm" />}>
              <BatchSelect batches={batches} />
            </Suspense>
          </div>

          <div>
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-4">VC Backer</h3>
            <div className="flex flex-col gap-2.5">
              <Link href={buildUrl({ vc: 'all', page: 1 })} className={`text-sm transition-colors ${vc === 'all' ? 'text-foreground font-medium' : 'text-secondary-foreground hover:text-foreground'}`}>All VCs</Link>
              {vcs.map(v => (
                <Link key={v} href={buildUrl({ vc: v, page: 1 })} className={`text-sm transition-colors ${vc === v ? 'text-foreground font-medium' : 'text-secondary-foreground hover:text-foreground'}`}>
                  {v}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-4">Industry</h3>
            <div className="flex flex-col gap-2.5">
              <Link href={buildUrl({ industry: 'all', page: 1 })} className={`text-sm transition-colors ${industry === 'all' ? 'text-foreground font-medium' : 'text-secondary-foreground hover:text-foreground'}`}>All Industries</Link>
              {industries.map(i => (
                <Link key={i} href={buildUrl({ industry: i, page: 1 })} className={`text-sm transition-colors ${industry === i ? 'text-foreground font-medium' : 'text-secondary-foreground hover:text-foreground'}`}>
                  {i}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-4">Employees</h3>
            <div className="flex flex-col gap-2.5">
              <Link href={buildUrl({ employees: 'all', page: 1 })} className={`text-sm transition-colors ${employees === 'all' ? 'text-foreground font-medium' : 'text-secondary-foreground hover:text-foreground'}`}>Any Size</Link>
              {employeeRanges.map(e => (
                <Link key={e} href={buildUrl({ employees: e, page: 1 })} className={`text-sm transition-colors ${employees === e ? 'text-foreground font-medium' : 'text-secondary-foreground hover:text-foreground'}`}>
                  {e}
                </Link>
              ))}
            </div>
          </div>
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
                defaultValue={q} 
                className="pl-11 pr-12 h-12 bg-transparent border-border rounded-full focus-visible:ring-1 focus-visible:ring-foreground transition-all text-base placeholder:text-muted-foreground"
              />
              <KeyboardShortcuts />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center justify-center w-6 h-6 rounded border border-border bg-card text-[10px] text-muted-foreground font-medium">
                /
              </div>
              {vc !== "all" && <input type="hidden" name="vc" value={vc} />}
              {industry !== "all" && <input type="hidden" name="industry" value={industry} />}
              {sort !== "asc" && <input type="hidden" name="sort" value={sort} />}
              {employees !== "all" && <input type="hidden" name="employees" value={employees} />}
              {batch !== "all" && <input type="hidden" name="batch" value={batch} />}
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
                <Link href="/" className={buttonVariants({ variant: "outline", className: "mt-6 rounded-full border-border hover:bg-accent" })}>
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
