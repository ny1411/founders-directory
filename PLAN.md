# Project Plan: Founders Directory

## 1. Architecture & Tech Stack
- **Framework:** Next.js (App Router)
- **Styling:** Tailwind CSS v4 + shadcn/ui
- **Database / Auth:** Firebase (Firestore / Firebase Authentication)
- **Scraping:** Playwright / Cheerio (Node.js scripts)
- **AI Integration:** @google/genai (Gemini API)
- **Analytics:** Vercel Analytics

## 2. Database Schema (Firestore)
- **Companies Collection:** `id` (slug), `name`, `description`, `logoUrl`, `vcBacker`, `industry`, `employees`, `location`, `foundedYear`, `stage`, `raised`, `amountRaised`, `website`, `twitterUrl`, `linkedinUrl`
- **Founders Subcollection/Linked Docs:** `companyId`, `name`, `role`, `email`, `phone`, `avatarUrl`, `twitterUrl`, `linkedinUrl`, `bio`
- **Users Collection:** `uid`, `email`, `resumeText` (or extracted resume details)

## 3. Implementation Checklist

### Phase 1: Setup & Database
- [x] Initialize Next.js project with Tailwind v4.
- [x] Set up Firebase client and admin SDKs.
- [x] Define Firestore database structure for Companies, Founders, and Users.

### Phase 2: Scraping Infrastructure
- [x] Set up a `scripts/scraper` directory.
- [x] Install scraping dependencies (`playwright`, `cheerio`).
- [x] Create YCombinator scraper (`yc.ts`).
- [x] Create a unified script to run all scrapers and insert/upsert data into Firestore.

### Phase 3: UI/UX & Layout Setup
- [x] Add required shadcn components.
- [x] Create a responsive main layout (`src/app/layout.tsx`) with a top navigation bar and theme toggle (Dark/Light mode).
- [x] Design a cohesive color palette matching modern directories (like grindmap).
- [x] Add Vercel Analytics to layout.

### Phase 4: Main Directory Page (Home)
- [x] **UI Components:**
  - [x] Search Bar (Search by name or description).
  - [x] Filter Sidebar / Topbar (VC Backer, Industry, Employees, Seed Rounds, Raised).
  - [x] Sort Dropdown (A-Z default).
- [x] **Data Fetching:**
  - [x] Create components to fetch companies from Firestore.
  - [x] Implement URL parameter-based filtering (e.g., `?vc=YCombinator&industry=tech`).
  - [x] **Implement Pagination (10 items/page):**
    - Query total number of companies and calculate total pages.
    - Add Pagination UI controls (Previous/Next buttons).
  - [x] Design the UI mimicking Vercel's component library (using shadcn/ui).
  - [x] Support generic mock filters (stage, employees, raised).
- [x] **Grid Layout:**
  - [x] Build a responsive grid of Company Cards.
  - [x] Each card shows Logo, Name, VC Backer badge, and a short description.

## Phase 5: Dynamic Details Page (UI & Data)
- **Goal:** Display individual company deep-dive page.
- **Tasks:**
  - [x] Create `src/app/company/[slug]/page.tsx`.
  - [x] Query Company and its related Founder records by slug.
  - [x] Render all details like social links, cap table, and founder bios.
  - [x] Use Next.js capabilities for fast load.

## Phase 6: Polish, Performance & Optimisation
- **Goal:** Finalize the developer-centric, premium experience and optimize.
- **Tasks:**
  - [x] Add dark mode toggle (default to dark).
  - [x] Add lenis for smooth scrolling.
  - [x] Add loading skeletons for the grid and detail pages.
  - [x] Generate standard SEO metadata dynamically.
  - [x] Implement true Firestore server-side pagination to reduce memory usage and reads.

## Phase 7: Cold DM Generator Feature
- **Goal:** Implement a feature to generate a custom cold DM based on user's resume and company/founder's description.
- **Tasks:**
  - **1. Authentication (Firebase):**
    - [x] Install and configure Firebase SDK.
    - [x] Set up Firebase Auth (Google and/or Email/Password).
    - [x] Create login flow and auth context.
  - **2. Database & User Profile:**
    - [x] Update Firestore rules and schema to include a `Users` collection.
    - [x] Create `/profile` page with a resume upload feature.
    - [x] Extract resume text (using an API or pdf-parse) and store it in Firestore.
    - [x] Provide UI in `/profile` for users to verify the extracted text and hit save.
  - **3. UI Updates (Company Page):**
    - [x] Add "Send Custom Text" button on the founder cards.
    - [x] Implement UI flow: If user clicks the button, open a DM generation modal.
    - [x] **Access Guards:** Redirect to login or profile if not properly configured.
  - **4. Gemini API Integration:**
    - [x] Set up an API route (e.g., `src/app/api/generate-dm/route.ts` or server action) to handle Gemini API requests securely on the server.
    - [x] Construct a detailed prompt combining: User's resume data + Company description + Selected Founder's details.
  - **5. Final User Flow (The Modal/Dialog):**
    - [x] Show a loading state while the Gemini API is generating the cold email.
    - [x] Display the generated response in an editable text area.
    - [x] Add a **"Copy Text"** button (copies to clipboard).
    - [x] Add a **"Send to Founder"** button (copies text and prompts user to open the founder's X/LinkedIn profile).
