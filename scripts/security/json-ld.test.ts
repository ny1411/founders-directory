import assert from "node:assert/strict"
import { test } from "node:test"
import { serializeJsonLd } from "../../src/components/json-ld"

test("JSON-LD serialization preserves nested data, Unicode, quotes, and URL values", () => {
  const data = {
    "@context": "https://schema.org",
    "@graph": [{
      "@type": "Organization",
      name: 'A & B <Labs> "Research" — नमस्ते 🚀',
      description: "Line\u2028separator\u2029paragraph\nnewline",
      sameAs: ["https://example.com/?a=1&b=2", null],
      numberOfEmployees: 0,
      active: false,
    }],
  }
  const json = serializeJsonLd(data)

  assert.deepEqual(JSON.parse(json), data)
  assert.doesNotMatch(json, /[<>&\u2028\u2029]/)
})

test("JSON-LD never emits HTML script terminators or comment openers from submitted text", () => {
  for (const payload of [
    '</script><script>window.__jsonLdExecuted = true</script>',
    '</ScRiPt><img src=x onerror="window.__jsonLdExecuted = true">',
    '<!--<script>double escaped text</script></script>',
  ]) {
    const data = { name: payload, description: payload, url: payload }
    const json = serializeJsonLd(data)

    assert.doesNotMatch(json, /<\/script|<!--/i)
    assert.deepEqual(JSON.parse(json), data)
  }
})
