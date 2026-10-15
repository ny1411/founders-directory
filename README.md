# Founders Directory

Founders Directory is a premium, developer-focused platform designed to help you search for YCombinator startups and discover the exact founders you need to connect with. Built with a "less is more" philosophy, you can access founders' social data, link your resume to build a tailored profile, and automatically generate personalized cold DMs leveraging both your background and the founder's details to send directly to them.

## Key Features

- **YC Startup Search**: Search for YCombinator startups by name or description. Filter results by VC Backer, Industry, Employees, Seed Rounds, and Raised amount.
- **Precision Founder Search**: Find and match with the exact founders you need based on their role or background.
- **Comprehensive Social Data**: Get direct access to founders' social data (LinkedIn, X), cap tables, and detailed bios right from the company pages.
- **Tailored User Profiles**: Create a profile and link/upload your resume to parse your professional background and experience.
- **AI-Powered Cold DMs**: Generate highly personalized cold outreach messages utilizing the Gemini API. The AI seamlessly combines your resume data, the company's description, and the selected founder's details to craft the perfect pitch.
- **Direct Outreach**: Easily copy the generated message and send it directly to the founder via their social profiles (X/LinkedIn) with a single click.
- **Premium UI/UX**: Designed to feel like a premium developer tool (inspired by Linear, Vercel, Raycast). Features a minimalist, typography-driven UI using Tailwind CSS v4, shadcn/ui, dark mode by default, and Lenis smooth scrolling.
- **Automated Data Pipeline**: Built-in Playwright and Cheerio scripts (`scripts/scraper/`) scrape and update company and founder data continuously into Firestore.

## Tech Stack

- **Framework:** [Next.js 15](https://nextjs.org) (App Router, Server Components)
- **Styling:** [Tailwind CSS v4](https://tailwindcss.com/) & [shadcn/ui](https://ui.shadcn.com/)
- **Database & Auth:** [Firebase](https://firebase.google.com/) (Firestore & Firebase Authentication)
- **AI Integration:** [@google/genai](https://github.com/google/generative-ai-js) (Gemini API)
- **Scraping:** [Playwright](https://playwright.dev/) & [Cheerio](https://cheerio.js.org/)
- **Analytics:** [Vercel Analytics](https://vercel.com/analytics)

## Architecture

- `src/app/`: Next.js App Router pages (Home, Company Details, Profile) and API routes.
- `src/components/`: Reusable UI components including layout components, Company Cards, and Filter Sidebars.
- `src/context/`: React context providers (e.g., AuthContext).
- `src/lib/`: Firebase configuration, database utilities, and TypeScript types.
- `scripts/scraper/`: Web scraping scripts (e.g., `yc.ts`) for data population.

## Getting Started

### Prerequisites

You need Node.js installed on your machine.

### Installation

1. Clone the repository and install dependencies:
```bash
npm install
```

2. Set up environment variables:
Create a `.env` or `.env.local` file in the root directory and add your keys:
- Firebase configuration (Client & Admin SDKs)
- Next.js secrets
- Gemini API key

3. Run the development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Directory Filters

Batch, VC Backer, Industry, and Employees support multiple selections. Options
within a group match **any** selection; different groups must **all** match.
B2B, Marketplace, and Travel require the exact stored tag. Other industry
categories match either the industry field or an exact tag. Unspecified includes
missing, null, and empty industries. Employee ranges require integer counts.

Batch and VC options come from Firestore and are cached for five minutes. Filtered
requests fetch candidates using one field, then apply the remaining groups,
alphabetical sorting, counts, and pagination on the server. This avoids requiring
composite indexes for every combination, but reads the full candidate set. The
unfiltered directory keeps its count and limited page queries.

Run the regression tests with:

```bash
npm run test:filters
npm run build
npx next start --hostname 127.0.0.1 --port 3000
```

In a second terminal, run `npm run test:filters:e2e`. The browser tests require
Firebase Admin credentials in `.env` and Playwright Chromium. They compare rendered
results with read-only Firestore data. Set `DIRECTORY_TEST_URL` to test another URL.

The directory avoids a root loading boundary because this Next.js/React version
can leave client navigation pending after data arrives, as reported in
[Next.js issue #86151](https://github.com/vercel/next.js/issues/86151). The browser
suite checks production filter clicks and pagination to catch this regression.

## YC Scraper

With Firebase Admin credentials in `.env` and Playwright Chromium installed
(`npx playwright install chromium`), run:

```bash
npm run scrape:yc
```

Each run targets **1,000 newly saved, unique companies**, skipping slugs already
in Firestore. The scraper discovers the full directory using YC batch filters:
the unfiltered search only exposes its first 1,000 results, so scrolling alone
cannot reach the full directory. Discovery verifies every batch and the total
before writing. Company profiles supply public company and founder data.

```bash
npm run scrape:yc -- --dry-run       # Discover and compare with Firebase; no writes
npm run scrape:yc -- --limit 25      # Optional smaller run
npm run test:scraper
```

In Windows PowerShell, use `npm.cmd` when passing flags so the npm PowerShell
wrapper forwards them correctly:

```powershell
npm.cmd run scrape:yc -- --dry-run
npm.cmd run scrape:yc -- --limit 25
```

Three bounded workers process profiles; only confirmed new saves count toward
the target, and parallel workers cannot overshoot it. Transient requests and
database operations are retried. Company and founder
documents are saved together in a transaction with stable IDs, so reruns resume
from the data already saved. Existing records with random IDs are also skipped.
The summary reports discovered, existing, saved, and failed companies. Failed
profiles remain eligible on the next run. Database failures or an unmet target
caused by failed profiles produce a nonzero exit status. When fewer than 1,000
new companies remain, the final run saves the remainder and reports exhaustion.
Repeat the default command to work through the directory; the total changes as
YC adds companies, and inaccessible profiles may require later retries.

## Design Philosophy

The interface focuses on a calm, understated, and information-first aesthetic:
- Minimalist UI with purposeful elements (no unnecessary shadows, borders, or colors).
- Typography-driven hierarchy over excessive decoration (utilizing fonts like Inter, Instrument Serif, and Geist Mono).
- Consistent, generous spacing and muted color palettes.
- See `design.md` for full design guidelines.

## Deployment

The easiest way to deploy this Next.js app is to use the [Vercel Platform](https://vercel.com/). Ensure all environment variables (Firebase, Gemini API) are configured in your Vercel project settings.
