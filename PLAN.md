# Project Plan: VC Portfolio Scraper & Directory

## 1. Architecture & Tech Stack
- **Framework:** Next.js (App Router)
- **Styling:** Tailwind CSS + shadcn/ui
- **Database:** SQLite (local development) / PostgreSQL (production) via Prisma ORM
- **Scraping:** Playwright / Cheerio (Node.js scripts)
- **State Management:** React hooks + URL search params (for shareable filters)

## 2. Database Schema (Prisma)
- **Company Model:** `id`, `slug`, `name`, `description`, `logoUrl`, `vcBacker` (Enum/String), `industry`, `employees` (Range/String), `location`, `foundedYear`, `stage`, `raised` (String), `amountRaised` (Float), `website`, `twitterUrl`, `linkedinUrl`
- **Founder Model:** `id`, `companyId`, `name`, `role`, `email`, `phone`, `avatarUrl`, `twitterUrl`, `linkedinUrl`, `bio`

## 3. Implementation Checklist

### Phase 1: Setup & Database
- [x] Initialize Prisma and set up SQLite/PostgreSQL database.
- [x] Define `Company` and `Founder` schema in `schema.prisma`.
- [x] Generate Prisma client and create a database seed script.

### Phase 2: Scraping Infrastructure
- [x] Set up a `scripts/scraper` directory.
- [x] Install scraping dependencies (`playwright`, `cheerio`).
- [x] Create YCombinator scraper (`yc.ts`).
- [x] Create a unified script to run all scrapers and insert/upsert data into the database.

### Phase 3: UI/UX & Layout Setup
- [x] Add required shadcn components (`npx shadcn@latest add card input select badge button skeleton`).
- [x] Create a responsive main layout (`src/app/layout.tsx`) with a top navigation bar and theme toggle (Dark/Light mode).
- [x] Design a cohesive color palette matching modern directories (like grindmap).

### Phase 4: Main Directory Page (Home)
- [x] **UI Components:**
  - [x] Search Bar (Search by name or description).
  - [x] Filter Sidebar / Topbar (VC Backer, Industry, Employees, Seed Rounds, Raised).
  - [x] Sort Dropdown (A-Z default).
- [x] **Data Fetching:**
  - [x] Create a Server Component to fetch companies from the database.
  - [x] Implement URL parameter-based filtering (e.g., `?vc=YCombinator&industry=tech`).
  - [x] **Implement Server-Side Pagination (10 items/page):**
    - Update `src/app/page.tsx` to read a `page` URL search parameter (defaulting to 1).
    - Modify the `prisma.company.findMany` call in `src/app/page.tsx` to include `take: 10` and `skip: (page - 1) * 10`.
    - Query `prisma.company.count({ where })` to get the total number of companies and calculate total pages.
    - Add a Pagination UI control (Previous/Next buttons) below the company grid in `src/app/page.tsx` that links to the respective `?page=N` URL.
  - [x] Design the UI mimicking Vercel's component library (using shadcn/ui).
  - [x] Support generic mock filters (stage, employees, raised).
- [x] **Grid Layout:**
  - [x] Build a responsive grid of Company Cards.
  - [x] Each card shows Logo, Name, VC Backer badge, and a short description.

## Phase 5: Dynamic Details Page (UI & Data)
- **Goal:** Display individual company deep-dive page.
- **Tasks:**
  - [ ] Create `src/app/company/[slug]/page.tsx`.
  - [ ] Query `Company` and its related `Founder` records by slug.
  - [ ] Render all details like social links, cap table, and founder bios.
  - [ ] Use Next.js Server Components for fast load.

## Phase 6: Polish & Performance
- **Goal:** Finalize the developer-centric, premium experience.
- **Tasks:**
  - [ ] Add dark mode toggle (default to dark).
  - [ ] Add lenis for smooth scrooling.
  - [ ] Add loading skeletons for the grid and detail pages.
  - [ ] Generate standard SEO metadata dynamically.

# Expected User Flows
1. **Initial Load:** User visits `/`. They see a large, premium hero section and a grid of companies.
2. **Filtering:** User clicks on "YCombinator" in the VC filter. The page instantly updates (using React transitions or Next.js server components) to show only YCombinator companies.
3. **Searching:** User types "health" in the search bar. The grid filters to companies with "health" in their name or description.
4. **Details:** User clicks on a company card. They are navigated to `/company/doordash`.
5. **Deep Dive:** On the detail page, the user can read about the company, see the founders, and click their social links or copy their contact info. They can use the browser back button to return to their preserved filtered state.
