import assert from "node:assert/strict"
import test from "node:test"
import { getIndustryConditions, INDUSTRIES, matchesIndustry, parseIndustry } from "./industry-filter"

type StoredCompany = { industry?: string | null; tags?: string[] | null; description?: string }

function matches(company: StoredCompany, industry: string): boolean {
  return matchesIndustry({ industry: company.industry ?? null, tags: company.tags ?? null }, industry)
}

test("B2B returns only companies with the explicit Firestore tag", () => {
  const companies: StoredCompany[] = [
    { industry: "B2B", tags: ["SaaS"] },
    { industry: "Fintech", tags: ["B2B"] },
    { industry: null, tags: ["B2B", "AI"] },
    { industry: "B2B", tags: null },
    { description: "A B2B company", tags: ["B2B Marketplace", "b2b"] },
    {},
  ]
  assert.deepEqual(companies.filter(company => matches(company, "B2B")), [companies[1], companies[2]])
})

test("Marketplace and Travel match tags, including companies without an industry", () => {
  for (const industry of ["Marketplace", "Travel"]) {
    assert.equal(matches({ industry: null, tags: [industry] }, industry), true)
    assert.equal(matches({ industry, tags: [] }, industry), false)
    assert.equal(matches({ tags: [`${industry} Tools`] }, industry), false)
  }
})

test("category selections include explicit industry or exact tag without duplicates", () => {
  for (const industry of INDUSTRIES.filter(value => !["B2B", "Marketplace", "Travel", "Unspecified"].includes(value))) {
    assert.equal(matches({ industry, tags: [] }, industry), true)
    assert.equal(matches({ industry: null, tags: [industry] }, industry), true)
    assert.equal(matches({ industry: "Different", tags: [`${industry} Tools`] }, industry), false)
    assert.equal(matches({ industry: null, tags: null }, industry), false)
  }
})

test("Unspecified includes absent, null, empty, and explicitly unspecified industries", () => {
  for (const company of [{}, { industry: null }, { industry: "" }, { industry: "Unspecified" }]) {
    assert.equal(matches(company, "Unspecified"), true)
  }
  assert.equal(matches({ industry: "Fintech", tags: [] }, "Unspecified"), false)
})

test("all industries applies no constraint", () => {
  assert.deepEqual(getIndustryConditions("all"), [])
  assert.equal(matches({}, "all"), true)
})

test("URL parsing accepts known single selections and ignores malformed values", () => {
  for (const industry of INDUSTRIES) assert.equal(parseIndustry(industry), industry)
  for (const invalid of [undefined, [], ["B2B"], ["B2B", "Fintech"], "unknown", "", "all"]) {
    assert.equal(parseIndustry(invalid), "all")
  }
})
