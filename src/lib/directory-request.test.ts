import assert from "node:assert/strict"
import test from "node:test"
import { parseDirectoryRequest } from "./directory-request"

test("canonicalizes search, defaults, facet order and duplicate values", () => {
  const result = parseDirectoryRequest("?industry=healthcare&sort=asc&industry=B2B&q=%20AI%20%20TOOLS%20&page=1&industry=b2b")
  assert.deepEqual(result, {
    ok: true,
    params: { q: "ai tools", industry: ["B2B", "Healthcare"] },
    canonicalQuery: "q=ai+tools&industry=B2B&industry=Healthcare",
  })
  assert.deepEqual(parseDirectoryRequest(`?${result.ok ? result.canonicalQuery : ""}`), result)
})

test("keeps valid sort, facets and bounded pagination", () => {
  assert.deepEqual(parseDirectoryRequest("?sort=desc&employees=501%2B&batch=Winter+2026&vc=YC&page=500"), {
    ok: true,
    params: { sort: "desc", employees: ["501+"], batch: ["Winter 2026"], vc: ["YC"], page: "500" },
    canonicalQuery: "sort=desc&employees=501%2B&batch=Winter+2026&vc=YC&page=500",
  })
})

test("rejects unknown and unbounded inputs before directory work", () => {
  const bad = [
    "?noise=a", "?noise=b", `?q=${"x".repeat(101)}`, `?${"q=x&".repeat(1500)}`,
    `?${Array.from({ length: 11 }, () => "industry=B2B").join("&")}`,
    `?${Array.from({ length: 11 }, (_, i) => `vc=VC${i}`).join("&")}`,
    `?${Array.from({ length: 10 }, (_, i) => `vc=VC${i}`).join("&")}&${Array.from({ length: 10 }, (_, i) => `batch=B${i}`).join("&")}&industry=B2B`,
    "?page=100001", "?page=999999999999", "?page=0", "?page=01", "?q=x&q=y", "?industry=", "?sort=bad",
  ]
  for (const search of bad) assert.equal(parseDirectoryRequest(search).ok, false, search)
})


test("page URLs can grow beyond the old 5,000-company snapshot cap", () => {
  assert.equal(parseDirectoryRequest("?page=501").ok, true)
  assert.equal(parseDirectoryRequest("?page=100000").ok, true)
})
