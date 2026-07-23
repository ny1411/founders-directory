import { adminDb } from "@/lib/firebase-admin"
import { Company } from "@/lib/types"
import { FieldPath, type Query, type QueryDocumentSnapshot } from "firebase-admin/firestore"
import Link from "next/link"
import Image from "next/image"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { buttonVariants } from "@/components/ui/button"
import { Search } from "lucide-react"
import { SubmitCompanyButton } from "@/components/submit-company-button"
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts"

export default async function Home(props: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const searchParams = await props.searchParams;
  const q = (searchParams?.q as string) || ""
  const vc = (searchParams?.vc as string) || "all"
  const industry = (searchParams?.industry as string) || "all"
  const sort = (searchParams?.sort as string) || "asc"
  const pageParam = searchParams?.page as string
  const page = pageParam ? parseInt(pageParam, 10) : 1
  const employees = (searchParams?.employees as string) || "all"
  const cursor = (searchParams?.cursor as string);
  const direction = (searchParams?.direction as string) || "next";

  let companiesQuery: Query = adminDb.collection("companies");

  if (q) {
    // Note: Firestore only supports prefix search for text fields.
    companiesQuery = companiesQuery.where('name', '>=', q).where('name', '<=', q + '\uf8ff');
  }
  if (vc !== "all") {
    companiesQuery = companiesQuery.where("vcBacker", "==", vc);
  }
  if (industry !== "all") {
    companiesQuery = companiesQuery.where("industry", "==", industry);
  }
  if (employees !== "all") {
    if (employees === "1-10") {
      companiesQuery = companiesQuery.where("employees", ">=", 1).where("employees", "<=", 10);
    } else if (employees === "11-50") {
      companiesQuery = companiesQuery.where("employees", ">=", 11).where("employees", "<=", 50);
    } else if (employees === "51-200") {
      companiesQuery = companiesQuery.where("employees", ">=", 51).where("employees", "<=", 200);
    } else if (employees === "201-500") {
      companiesQuery = companiesQuery.where("employees", ">=", 201).where("employees", "<=", 500);
    } else if (employees === "501+") {
      companiesQuery = companiesQuery.where("employees", ">=", 501);
    }
  }

  // Sort
  const sortDirection = sort === 'asc' ? 'asc' : 'desc';

  const take = 10;
  
  // Base query separation: Get total count BEFORE applying orderBy
  const countSnapshot = await companiesQuery.count().get();
  const totalCount = countSnapshot.data().count;
  const totalPages = Math.ceil(totalCount / take);

  // Apply sorting AFTER count
  if (employees !== "all") {
    companiesQuery = companiesQuery
      .orderBy("employees", sortDirection)
      .orderBy("name", sortDirection)
      .orderBy(FieldPath.documentId(), sortDirection);
  } else {
    companiesQuery = companiesQuery
      .orderBy("name", sortDirection)
      .orderBy(FieldPath.documentId(), sortDirection);
  }

  if (cursor) {
    try {
      const [cursorName, cursorId] = JSON.parse(cursor);
      if (direction === "prev") {
        companiesQuery = companiesQuery.endBefore(cursorName, cursorId).limitToLast(take);
      } else {
        companiesQuery = companiesQuery.startAfter(cursorName, cursorId).limit(take);
      }
    } catch (e) {
      companiesQuery = companiesQuery.limit(take);
    }
  } else {
    companiesQuery = companiesQuery.limit(take);
  }

  const snapshot = await companiesQuery.get();

  const companies = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  })) as Company[];

  const firstItemCursor = snapshot.docs.length > 0 
    ? JSON.stringify([ snapshot.docs[0].get("employees"), snapshot.docs[0].get("name"), snapshot.docs[0].id])
    : null;
  const lastItemCursor = snapshot.docs.length > 0 
    ? JSON.stringify([snapshot.docs[snapshot.docs.length - 1].get("employees"), snapshot.docs[snapshot.docs.length - 1].get("name"), snapshot.docs[snapshot.docs.length - 1].id])
    : null;

  // Dummy filter arrays (In real app, you might group by from DB)
  const vcs = ["YCombinator"]
  const industries = [
    "B2B",
    "Marketplace",
    "Travel",
    "Fintech",
    "Consumer",
    "Healthcare",
    "Education",
    "Industrials",
    "Real Estate and Construction",
    "Government",
    "Unspecified"
  ]
  const employeeRanges = ["1-10", "11-50", "51-200", "201-500", "501+"]

  const buildUrl = (overrides: Record<string, string | number | null>) => {
    const params = new URLSearchParams()
    if (q) params.set("q", q)
    if (vc !== "all") params.set("vc", vc)
    if (industry !== "all") params.set("industry", industry)
    if (sort !== "asc") params.set("sort", sort)
    if (employees !== "all") params.set("employees", employees)
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

  return (
    <div className="flex flex-col gap-16 pb-16">
      
      {/* Hero Section */}
      <section className="flex flex-col gap-6 max-w-3xl pt-10">
        <h1 className="font-serif text-5xl md:text-7xl leading-tight text-foreground tracking-tight">
          Discover the next generation of startups.
        </h1>
        <p className="text-xl text-secondary-foreground leading-relaxed font-light">
          A curated directory of high-growth companies backed by the world&apos;s most prestigious venture capital firms.
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

                    {company.tags && company.tags.split(',').map((tag: string, idx: number) => (
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
