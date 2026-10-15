import assert from "node:assert/strict"
import test from "node:test"
import type { CollectionReference } from "firebase-admin/firestore"
import { EMPLOYEE_RANGES, loadEmployeeCandidates, matchesEmployeeRange, parseEmployeeRange } from "./employee-filter"
import { matchesIndustry } from "./industry-filter"
import { paginateCompanies } from "./company-pagination"
import type { Company } from "./types"

test("every employee range includes both boundaries and excludes adjacent integers", () => {
  const boundaries = [[1, 10], [11, 50], [51, 200], [201, 500], [501, 100000]]
  for (const [index, range] of EMPLOYEE_RANGES.entries()) {
    const [minimum, maximum] = boundaries[index]
    assert.equal(matchesEmployeeRange(minimum, range), true, range)
    assert.equal(matchesEmployeeRange(maximum, range), true, range)
    assert.equal(matchesEmployeeRange(minimum - 1, range), false, range)
    if (range !== "501+") assert.equal(matchesEmployeeRange(maximum + 1, range), false, range)
  }
})

test("selected sizes exclude unknown, zero, negative, fractional, and nonnumeric counts", () => {
  for (const range of EMPLOYEE_RANGES) {
    for (const invalid of [null, undefined, 0, -1, 1.5, 11.5, 51.5, 201.5, 501.5, "5", "501", NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(matchesEmployeeRange(invalid, range), false, `${range}: ${String(invalid)}`)
    }
  }
  for (const value of [null, undefined, 0, 500]) assert.equal(matchesEmployeeRange(value, "all"), true)
})

test("URL parsing accepts supported single ranges and ignores malformed values", () => {
  for (const range of EMPLOYEE_RANGES) assert.equal(parseEmployeeRange(range), range)
  for (const invalid of [undefined, [], ["1-10"], ["1-10", "501+"], "", "all", "0-10", "toString"]) {
    assert.equal(parseEmployeeRange(invalid), "all")
  }
})

test("size filtering retains exact B2B tag semantics when applied together", () => {
  const companies = [
    { industry: "B2B", tags: [], employees: 5 },
    { industry: "Fintech", tags: ["B2B"], employees: 10 },
    { industry: null, tags: ["B2B"], employees: 11 },
    { industry: "B2B", tags: ["B2B"], employees: null },
  ]
  const filtered = companies.filter(company => matchesIndustry(company, "B2B") && matchesEmployeeRange(company.employees, "1-10"))
  assert.deepEqual(filtered, [companies[1]])
})

test("filtered pages stay alphabetical regardless of employee counts and omit no companies", () => {
  const companies = Array.from({ length: 25 }, (_, index) => ({
    id: String(index), slug: `company-${String(index).padStart(2, "0")}`, employees: 50 - index,
  } as Company)).reverse()
  const filtered = companies.filter(company => matchesEmployeeRange(company.employees, "11-50"))
  const ascending = [1, 2, 3].flatMap(page => paginateCompanies(filtered, page, "asc").companies)
  assert.deepEqual(ascending.map(company => company.slug), [...companies].reverse().map(company => company.slug))
  const descending = [1, 2, 3].flatMap(page => paginateCompanies(filtered, page, "desc").companies)
  assert.deepEqual(descending.map(company => company.id), companies.map(company => company.id))
  assert.equal(paginateCompanies(filtered, 2, "asc").totalCount, 25)
  assert.equal(paginateCompanies(filtered, 2, "asc").totalPages, 3)
})

test("candidate retrieval uses a single numeric field and rechecks stored values", async () => {
  for (const range of EMPLOYEE_RANGES) {
    const conditions: unknown[][] = []
    const query = {
      where: (...condition: unknown[]) => { conditions.push(condition); return query },
      get: async () => ({ docs: [5, 50, 200, 500, 501, 501.5, null].map((employees, index) => ({
        id: String(index), data: () => ({ employees }),
      })) }),
    }
    const companies = await loadEmployeeCandidates(query as unknown as CollectionReference, range)
    assert.ok(conditions.every(([field]) => field === "employees"))
    assert.deepEqual(conditions.map(([, operator]) => operator), range === "501+" ? [">="] : [">=", "<="])
    assert.ok(companies.every(company => matchesEmployeeRange(company.employees, range)))
    assert.ok(companies.every(company => company.id !== undefined))
  }
})
