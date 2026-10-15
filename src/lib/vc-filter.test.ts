import assert from "node:assert/strict"
import test from "node:test"
import type { CollectionReference } from "firebase-admin/firestore"
import { getVcOptions, loadVcCandidates, matchesVc, parseVc } from "./vc-filter"
import { matchesIndustry } from "./industry-filter"
import { matchesEmployeeRange } from "./employee-filter"
import { matchesBatch } from "./batch-filter"
import { paginateCompanies } from "./company-pagination"
import type { Company } from "./types"

test("VC options use only unique, nonempty stored string labels", () => {
  assert.deepEqual(getVcOptions(["YCombinator", "Sequoia", "YCombinator", "Accel", null, undefined, "", " ", 123, ["Other"]]), [
    "Accel", "Sequoia", "YCombinator",
  ])
  assert.deepEqual(getVcOptions([" YCombinator "]), [" YCombinator "])
})

test("VC URL parsing accepts only exact known scalar selections", () => {
  const vcs = ["YCombinator", "Sequoia"]
  for (const vc of vcs) assert.equal(parseVc(vc, vcs), vc)
  for (const value of [undefined, null, [], ["YCombinator"], ["YCombinator", "Sequoia"], "", "all", "yc", "ycombinator", "YCombinator extra", " YCombinator "]) {
    assert.equal(parseVc(value, vcs), "all")
  }
})

test("VC matching uses the exact field, and all includes missing or empty backers", () => {
  assert.equal(matchesVc("YCombinator", "YCombinator"), true)
  for (const value of [null, undefined, "", "ycombinator", "YCombinator extra", ["YCombinator"], { toString: () => "YCombinator" }]) {
    assert.equal(matchesVc(value, "YCombinator"), false)
    assert.equal(matchesVc(value, "all"), true)
  }
})

test("VC intersects industry, size, and batch without broadening B2B semantics", () => {
  const companies = [
    { id: "match", industry: "Fintech", tags: ["B2B"], employees: 10, batch: "Winter 2026", vcBacker: "YCombinator" },
    { id: "wrong-vc", industry: "Fintech", tags: ["B2B"], employees: 10, batch: "Winter 2026", vcBacker: "Other" },
    { id: "no-tag", industry: "B2B", tags: [], employees: 10, batch: "Winter 2026", vcBacker: "YCombinator" },
    { id: "wrong-size", industry: "Fintech", tags: ["B2B"], employees: 11, batch: "Winter 2026", vcBacker: "YCombinator" },
    { id: "wrong-batch", industry: "Fintech", tags: ["B2B"], employees: 10, batch: "Summer 2026", vcBacker: "YCombinator" },
  ]
  assert.deepEqual(companies.filter(company =>
    matchesVc(company.vcBacker, "YCombinator") && matchesIndustry(company, "B2B") &&
    matchesEmployeeRange(company.employees, "1-10") && matchesBatch(company.batch, "Winter 2026")
  ).map(company => company.id), ["match"])
})

test("VC candidate retrieval uses equality without ordering or additional fields", async () => {
  const conditions: unknown[][] = []
  const query = {
    where: (...condition: unknown[]) => { conditions.push(condition); return query },
    get: async () => ({ docs: ["YCombinator", "Other", null].map((vcBacker, index) => ({
      id: String(index), data: () => ({ vcBacker }),
    })) }),
  }
  const companies = await loadVcCandidates(query as unknown as CollectionReference, "YCombinator")
  assert.deepEqual(conditions, [["vcBacker", "==", "YCombinator"]])
  assert.deepEqual(companies.map(company => company.id), ["0"])
  conditions.length = 0
  assert.equal((await loadVcCandidates(query as unknown as CollectionReference, "all")).length, 3)
  assert.deepEqual(conditions, [])
})

test("VC pages remain alphabetically ordered with stable counts and document IDs", () => {
  const companies = Array.from({ length: 25 }, (_, index) => ({
    id: String(index).padStart(2, "0"), slug: `company-${String(index).padStart(2, "0")}`, vcBacker: "YCombinator",
  } as Company)).reverse()
  const filtered = companies.filter(company => matchesVc(company.vcBacker, "YCombinator"))
  const ascending = [1, 2, 3].flatMap(page => paginateCompanies(filtered, page, "asc").companies)
  assert.deepEqual(ascending.map(company => company.id), [...companies].reverse().map(company => company.id))
  const descending = [1, 2, 3].flatMap(page => paginateCompanies(filtered, page, "desc").companies)
  assert.deepEqual(descending.map(company => company.id), companies.map(company => company.id))
  assert.equal(paginateCompanies(filtered, 2, "asc").totalCount, 25)
  assert.equal(paginateCompanies(filtered, 2, "asc").totalPages, 3)
})
