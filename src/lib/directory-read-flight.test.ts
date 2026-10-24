import assert from "node:assert/strict"
import test from "node:test"
import { createDirectoryReadFlight } from "./directory-read-flight"

test("concurrent cache misses share one read; results are not retained after settlement", async () => {
  const read = createDirectoryReadFlight()
  let calls = 0
  const load = async () => { calls++; return "result" }
  const results = await Promise.all(Array.from({ length: 20 }, () => read("same-page", load)))
  assert.ok(results.every(result => result === "result"))
  assert.equal(calls, 1)
  await read("same-page", load)
  assert.equal(calls, 2)
})

test("different pages do not share reads and failures do not poison later retries", async () => {
  const read = createDirectoryReadFlight()
  let calls = 0
  const load = async () => { calls++; throw new Error("Datastore unavailable") }
  const failures = await Promise.allSettled([read("a", load), read("a", load), read("b", load)])
  assert.ok(failures.every(result => result.status === "rejected"))
  assert.equal(calls, 2)
  assert.equal(await read("a", async () => "recovered"), "recovered")
})
