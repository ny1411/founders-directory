import { prisma } from "@/lib/prisma"
import { notFound } from "next/navigation"
import Image from "next/image"
import Link from "next/link"
import { Metadata } from "next"
import { ArrowLeft, ExternalLink, Building2, MapPin, Users, Calendar, Banknote } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"

export async function generateMetadata(
  props: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const params = await props.params;
  const company = await prisma.company.findUnique({
    where: { slug: params.slug },
  })

  if (!company) {
    return {
      title: "Company Not Found",
    }
  }

  return {
    title: `${company.name} | VC Portfolio Directory`,
    description: company.oneLiner || company.description || `View details about ${company.name}`,
  }
}

export default async function CompanyPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const company = await prisma.company.findUnique({
    where: { slug: params.slug },
    include: { founders: true },
  })

  if (!company) {
    notFound()
  }

  return (
    <div className="flex flex-col gap-16 pb-16">
      {/* Back Button */}
      <div>
        <Link href="/" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Directory
        </Link>
      </div>

      {/* Hero Section */}
      <section className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-6 max-w-3xl">
          <div className="flex items-center gap-4">
            {company.logoUrl && (
              <Image 
                src={company.logoUrl} 
                alt={`${company.name} logo`} 
                width={80} 
                height={80} 
                className="w-20 h-20 rounded-2xl object-cover border border-border shadow-sm bg-card" 
              />
            )}
            <div>
              <h1 className="font-serif text-4xl md:text-5xl text-foreground tracking-tight">
                {company.name}
              </h1>
              {company.vcBacker && (
                <span className="inline-block mt-2 px-3 py-1 rounded-full border border-border text-xs font-bold uppercase tracking-widest text-secondary-foreground bg-transparent">
                  {company.vcBacker} Backed
                </span>
              )}
            </div>
          </div>
          
          {company.oneLiner && (
            <p className="text-xl md:text-2xl text-foreground font-medium leading-relaxed">
              {company.oneLiner}
            </p>
          )}

          <p className="text-lg text-secondary-foreground leading-relaxed font-light">
            {company.description || "No detailed description available for this company."}
          </p>

          <div className="flex flex-wrap gap-4 mt-2">
            {company.website && (
              <a href={company.website} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "default" })}>
                Visit Website
                <ExternalLink className="w-4 h-4 ml-2" />
              </a>
            )}
            {company.twitterUrl && (
              <a href={company.twitterUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "icon" })}>
                <img src="https://thesvg.org/icons/x/default.svg" alt="Twitter" className="w-4 h-4 grayscale opacity-70 hover:opacity-100 hover:grayscale-0 transition-all dark:invert dark:hover:invert-0" />
                <span className="sr-only">Twitter</span>
              </a>
            )}
            {company.linkedinUrl && (
              <a href={company.linkedinUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "icon" })}>
                <img src="https://thesvg.org/icons/linkedin/default.svg" alt="LinkedIn" className="w-4 h-4 grayscale opacity-70 hover:opacity-100 hover:grayscale-0 transition-all dark:invert dark:hover:invert-0" />
                <span className="sr-only">LinkedIn</span>
              </a>
            )}
            {company.ycUrl && (
              <a href={company.ycUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline" })}>
                <span className="font-semibold text-[#F26522] mr-2">YC Profile</span>
              </a>
            )}
          </div>
        </div>

        {/* Key Details Card */}
        <div className="w-full md:w-80 shrink-0 bg-card border border-border rounded-2xl p-6 flex flex-col gap-6 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-widest text-foreground">Company Overview</h3>
          
          <div className="flex flex-col gap-4">
            {company.industry && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                  <Building2 className="w-4 h-4 text-muted-foreground" />
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Industry</div>
                  <div className="text-sm font-medium text-foreground">{company.industry}</div>
                </div>
              </div>
            )}
            
            {company.location && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                  <MapPin className="w-4 h-4 text-muted-foreground" />
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Location</div>
                  <div className="text-sm font-medium text-foreground">{company.location}</div>
                </div>
              </div>
            )}

            {company.employees && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                  <Users className="w-4 h-4 text-muted-foreground" />
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Company Size</div>
                  <div className="text-sm font-medium text-foreground">{company.employees}</div>
                </div>
              </div>
            )}

            {company.foundedYear && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Founded</div>
                  <div className="text-sm font-medium text-foreground">{company.foundedYear}</div>
                </div>
              </div>
            )}
            
            {(company.stage || company.raised) && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                  <Banknote className="w-4 h-4 text-muted-foreground" />
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Funding</div>
                  <div className="text-sm font-medium text-foreground">
                    {company.stage && <span>{company.stage} </span>}
                    {company.stage && company.raised && <span className="text-muted-foreground">• </span>}
                    {company.raised && <span>{company.raised}</span>}
                  </div>
                </div>
              </div>
            )}
          </div>
          
          {company.tags && (
            <div className="pt-4 border-t border-border flex flex-wrap gap-2">
              {company.tags.split(',').map((tag, idx) => (
                <span key={idx} className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground bg-secondary/50 px-2 py-1 rounded-md">
                  {tag.trim()}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Founders Section */}
      {company.founders && company.founders.length > 0 && (
        <section className="pt-10 border-t border-border">
          <div className="flex items-center justify-between mb-8">
            <h2 className="font-serif text-3xl text-foreground">Founding Team</h2>
            <span className="px-3 py-1 bg-secondary rounded-full text-xs font-bold text-foreground">
              {company.founders.length} Founder{company.founders.length !== 1 ? 's' : ''}
            </span>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {company.founders.map(founder => (
              <div key={founder.id} className="bg-card border border-border rounded-2xl p-6 flex flex-col gap-4 shadow-sm group hover:border-foreground/20 transition-colors">
                <div className="flex items-center gap-4">
                  {founder.avatarUrl ? (
                    <Image 
                      src={founder.avatarUrl} 
                      alt={founder.name} 
                      width={64} 
                      height={64} 
                      className="w-16 h-16 rounded-full object-cover border border-border bg-secondary"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-secondary border border-border flex items-center justify-center shrink-0">
                      <Users className="w-6 h-6 text-muted-foreground" />
                    </div>
                  )}
                  <div>
                    <h3 className="text-lg font-medium text-foreground group-hover:text-primary transition-colors">{founder.name}</h3>
                    <p className="text-sm font-medium text-secondary-foreground">{founder.role || "Founder"}</p>
                  </div>
                </div>
                
                {founder.bio && (
                  <p className="text-sm text-secondary-foreground font-light line-clamp-3">
                    {founder.bio}
                  </p>
                )}
                
                <div className="pt-4 mt-auto flex items-center gap-2 border-t border-border/50">
                  {founder.linkedinUrl && (
                    <a href={founder.linkedinUrl} target="_blank" rel="noopener noreferrer" className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-full transition-colors flex items-center justify-center">
                      <img src="https://thesvg.org/icons/linkedin/default.svg" alt="LinkedIn" className="w-4 h-4 grayscale opacity-70 hover:opacity-100 hover:grayscale-0 transition-all dark:invert dark:hover:invert-0" />
                      <span className="sr-only">LinkedIn</span>
                    </a>
                  )}
                  {founder.twitterUrl && (
                    <a href={founder.twitterUrl} target="_blank" rel="noopener noreferrer" className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-full transition-colors flex items-center justify-center">
                      <img src="https://thesvg.org/icons/x/default.svg" alt="Twitter" className="w-4 h-4 grayscale opacity-70 hover:opacity-100 hover:grayscale-0 transition-all dark:invert dark:hover:invert-0" />
                      <span className="sr-only">Twitter</span>
                    </a>
                  )}
                  {(!founder.linkedinUrl && !founder.twitterUrl) && (
                    <span className="text-xs text-muted-foreground italic">No social links</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
