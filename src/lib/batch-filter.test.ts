import assert from "node:assert/strict"
import test from "node:test"
import { matchesBatch, parseBatch, sortBatches, updateBatchParams } from "./batch-filter"

test("batch options contain only unique stored labels in descending calendar order", () => {
  assert.deepEqual(sortBatches(["Winter 2026", "Fall 2025", "Spring 2026", "Summer 2026", "Fall 2026", "Winter 2026", null, "", " ", 2027]), [
    "Fall 2026", "Summer 2026", "Spring 2026", "Winter 2026", "Fall 2025",
  ])
  assert.deepEqual(sortBatches(["Summer 2005", "Winter 2027", "Legacy cohort"]), ["Winter 2027", "Summer 2005", "Legacy cohort"])
})

test("batch parsing accepts stored labels and ignores unknown or malformed selections", () => {
  const batches = ["Spring 2026", "Winter 2005"]
  assert.equal(parseBatch("Spring 2026", batches), "Spring 2026")
  for (const value of [undefined, null, [], ["Spring 2026"], "Winter 2027", "", "all"]) {
    assert.equal(parseBatch(value, batches), "all")
  }
})

test("batch matches exact stored values and all includes missing values", () => {
  assert.equal(matchesBatch("Spring 2026", "Spring 2026"), true)
  for (const value of [null, undefined, "Summer 2026", "Spring 2026 extra", "spring 2026"]) {
    assert.equal(matchesBatch(value, "Spring 2026"), false)
    assert.equal(matchesBatch(value, "all"), true)
  }
})

test("changing or clearing batch resets pagination and preserves every other selection", () => {
  const current = new URLSearchParams("q=ai&industry=B2B&industry=Fintech&vc=YCombinator&employees=1-10&sort=desc&batch=Winter+2026&page=3&cursor=old&direction=prev")
  const changed = updateBatchParams(current, "Spring 2026")
  assert.equal(changed.get("batch"), "Spring 2026")
  assert.deepEqual(changed.getAll("industry"), ["B2B", "Fintech"])
  for (const key of ["q", "vc", "employees", "sort"]) assert.equal(changed.get(key), current.get(key))
  for (const key of ["page", "cursor", "direction"]) assert.equal(changed.has(key), false)
  for (const value of ["all", null]) assert.equal(updateBatchParams(current, value).has("batch"), false)
  assert.equal(current.get("page"), "3")
})
