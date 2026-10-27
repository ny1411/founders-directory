import assert from "node:assert/strict"
import test from "node:test"
import { hasKnownDirectoryFacets, parseDirectoryRequest } from "./directory-request"

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

test("normalized Unicode search and canonical encoding remain inside the same request bounds", () => {
  assert.equal(parseDirectoryRequest(`?q=${"İ".repeat(51)}`).ok, false)
  const accepted = parseDirectoryRequest(`?q=${"İ".repeat(50)}`)
  assert.equal(accepted.ok, true)
  if (accepted.ok) {
    assert.equal(accepted.params.q?.length, 100)
    assert.deepEqual(parseDirectoryRequest(`?${accepted.canonicalQuery}`), accepted)
  }
  // URLSearchParams escapes ~, which can grow a syntactically bounded query
  // beyond the limit even without adding any facet values or search letters.
  const facets = ["batch", "vc"].flatMap(key => Array.from({ length: 10 }, (_, i) => `${key}=${i}${"~".repeat(99)}`)).join("&")
  assert.ok(facets.length < 4096)
  assert.equal(parseDirectoryRequest(`?${facets}`).ok, false)
  let escapes = 994
  const boundary = ["batch", "vc"].flatMap((key, group) => Array.from({ length: 10 }, (_, i) => {
    const length = group === 0 && i === 0 ? 98 : 99
    const escaped = Math.min(escapes, length)
    escapes -= escaped
    return `${key}=${i}${"~".repeat(escaped)}${"x".repeat(length - escaped)}`
  })).join("&")
  assert.equal(new URLSearchParams(boundary).toString().length, 4096)
  assert.equal(parseDirectoryRequest(`?${boundary}`).ok, false, 'the canonical leading ? also counts toward the query bound')
})

test("dynamic facets must all exist with their exact stored spelling instead of silently disappearing", () => {
  const options = { batches: ["Winter 2026", "Custom Cohort"], vcs: ["YC", "Other VC"] }
  assert.equal(hasKnownDirectoryFacets({}, options), true)
  assert.equal(hasKnownDirectoryFacets({ batch: ["Custom Cohort", "Winter 2026"], vc: ["YC", "Other VC"] }, options), true)
  for (const params of [{ batch: "Winter 2025" }, { vc: "yc" }, { vc: ["YC", "Unknown"] }, { batch: ["Winter 2026", "Unknown"] }]) {
    assert.equal(hasKnownDirectoryFacets(params, options), false)
  }
})
