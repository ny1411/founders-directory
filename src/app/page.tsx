import { prisma } from "@/lib/prisma"
import Link from "next/link"
import { Prisma } from "@prisma/client"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button, buttonVariants } from "@/components/ui/button"
import { Search } from "lucide-react"

export default async function Home(props: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const searchParams = await props.searchParams;
  const q = (searchParams?.q as string) || ""
  const vc = (searchParams?.vc as string) || "all"
  const industry = (searchParams?.industry as string) || "all"
  const sort = (searchParams?.sort as string) || "asc"

  const where: Prisma.CompanyWhereInput = {}
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { description: { contains: q } },
    ]
  }
  if (vc !== "all") {
    where.vcBacker = vc
  }
  if (industry !== "all") {
    where.industry = industry
  }

  const companies = await prisma.company.findMany({
    where,
    orderBy: {
      name: sort === "asc" ? "asc" : "desc",
    },
  })

  // Dummy filter arrays (In real app, you might group by from DB)
  const vcs = ["YCombinator", "a16z", "406 Ventures", "Gruhas"]
  const industries = ["Healthcare", "Tech", "Fintech", "Consumer", "AI", "DevTools"]

  return (
    <div className="flex flex-col gap-16 pb-16">
      
      {/* Hero Section */}
      <section className="flex flex-col gap-6 max-w-3xl pt-12 md:pt-20">
        <h1 className="font-serif text-5xl md:text-7xl leading-tight text-foreground tracking-tight">
          Discover the next generation of startups.
        </h1>
        <p className="text-xl text-secondary-foreground leading-relaxed font-light">
          A curated directory of high-growth companies backed by the world's most prestigious venture capital firms.
        </p>
        <div className="flex items-center gap-4 mt-4">
          <div className="flex flex-col">
            <span className="text-3xl font-serif text-foreground">{companies.length}</span>
            <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Companies</span>
          </div>
        </div>
      </section>

      {/* Main Content & Sidebar */}
      <div className="flex flex-col md:flex-row gap-12">
        
        {/* Sidebar Filters */}
        <aside className="w-full md:w-56 flex flex-col gap-10 shrink-0">
          <div>
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-4">VC Backer</h3>
            <div className="flex flex-col gap-2.5">
              <Link href={`/?q=${q}&vc=all&industry=${industry}&sort=${sort}`} className={`text-sm transition-colors ${vc === 'all' ? 'text-foreground font-medium' : 'text-secondary-foreground hover:text-foreground'}`}>All VCs</Link>
              {vcs.map(v => (
                <Link key={v} href={`/?q=${q}&vc=${v}&industry=${industry}&sort=${sort}`} className={`text-sm transition-colors ${vc === v ? 'text-foreground font-medium' : 'text-secondary-foreground hover:text-foreground'}`}>
                  {v}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-4">Industry</h3>
            <div className="flex flex-col gap-2.5">
              <Link href={`/?q=${q}&vc=${vc}&industry=all&sort=${sort}`} className={`text-sm transition-colors ${industry === 'all' ? 'text-foreground font-medium' : 'text-secondary-foreground hover:text-foreground'}`}>All Industries</Link>
              {industries.map(i => (
                <Link key={i} href={`/?q=${q}&vc=${vc}&industry=${i}&sort=${sort}`} className={`text-sm transition-colors ${industry === i ? 'text-foreground font-medium' : 'text-secondary-foreground hover:text-foreground'}`}>
                  {i}
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
                name="q" 
                placeholder="Search companies..." 
                defaultValue={q} 
                className="pl-11 pr-12 h-12 bg-transparent border-border rounded-full focus-visible:ring-1 focus-visible:ring-foreground transition-all text-base placeholder:text-muted-foreground"
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center justify-center w-6 h-6 rounded border border-border bg-card text-[10px] text-muted-foreground font-medium">
                /
              </div>
              <input type="hidden" name="vc" value={vc} />
              <input type="hidden" name="industry" value={industry} />
              <input type="hidden" name="sort" value={sort} />
            </form>

            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Sort</span>
              <Link href={`/?q=${q}&vc=${vc}&industry=${industry}&sort=${sort === 'asc' ? 'desc' : 'asc'}`} className="text-sm font-medium text-secondary-foreground hover:text-foreground transition-colors">
                {sort === 'asc' ? 'A-Z' : 'Z-A'}
              </Link>
            </div>
          </div>

          {/* Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {companies.map(company => (
              <Link key={company.id} href={`/company/${company.slug}`} className="block h-full group">
                <Card className="h-full bg-card border border-border rounded-2xl p-6 flex flex-col gap-4 transition-all duration-200 hover:bg-accent/50 hover:border-foreground/20 shadow-none">
                  <div className="flex justify-between items-start gap-4">
                    <h2 className="text-xl font-medium tracking-tight text-foreground group-hover:text-primary transition-colors">
                      {company.name}
                    </h2>
                    {company.vcBacker && (
                      <span className="shrink-0 px-2.5 py-1 rounded-full border border-border text-[10px] font-bold uppercase tracking-widest text-secondary-foreground bg-transparent">
                        {company.vcBacker}
                      </span>
                    )}
                  </div>
                  
                  <p className="text-sm text-secondary-foreground line-clamp-2 leading-relaxed flex-1 font-light">
                    {company.description || "No description available."}
                  </p>
                  
                  {company.industry && (
                    <div className="pt-2 mt-auto">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {company.industry}
                      </span>
                    </div>
                  )}
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

        </div>
      </div>
    </div>
  )
}
