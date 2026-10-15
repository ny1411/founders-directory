import assert from "node:assert/strict"
import test from "node:test"
import type { Company } from "./types"
import { paginateCompanies } from "./company-pagination"

const companies = Array.from({ length: 23 }, (_, index) => ({ id: String(index).padStart(2, "0"), slug: "duplicate-slug" } as Company)).reverse()

test("candidate pagination has no duplicate or omitted IDs with identical slugs", () => {
  const pages = [1, 2, 3].map(page => paginateCompanies(companies, page, "asc"))
  assert.deepEqual(pages.map(page => page.companies.length), [10, 10, 3])
  assert.deepEqual(pages.flatMap(page => page.companies.map(company => company.id)), [...companies].reverse().map(company => company.id))
  assert.equal(pages[0].totalCount, 23)
  assert.equal(pages[0].totalPages, 3)
  assert.deepEqual(JSON.parse(pages[0].lastItemCursor!), ["duplicate-slug", "09"])
  assert.equal(companies[0].id, "22")
})

test("descending order reverses the full ordering and previous page remains stable", () => {
  assert.deepEqual(paginateCompanies(companies, 1, "desc").companies.map(company => company.id), companies.slice(0, 10).map(company => company.id))
  assert.deepEqual(paginateCompanies(companies, 1, "asc"), paginateCompanies(companies, 1, "asc"))
})

test("invalid and stale page numbers are clamped, including empty results", () => {
  for (const page of [NaN, -2, 0, 1.5]) assert.equal(paginateCompanies(companies, page, "asc").page, 1)
  assert.equal(paginateCompanies(companies, 100, "asc").page, 3)
  assert.deepEqual(paginateCompanies([], 100, "asc"), { companies: [], totalCount: 0, totalPages: 0, page: 1, firstItemCursor: null, lastItemCursor: null })
})
