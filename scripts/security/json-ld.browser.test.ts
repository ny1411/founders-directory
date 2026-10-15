import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { test } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { chromium } from "playwright"
import { JsonLd } from "../../src/components/json-ld"

test("the rendered JSON-LD component keeps hostile company data inert in a browser", async () => {
  const executablePath = process.env.CHROMIUM_PATH ||
    (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined)
  const browser = await chromium.launch({ executablePath, headless: true })

  try {
    const scriptPayload = '</script><script>window.__jsonLdExecuted = true</script>'
    const imagePayload = '</ScRiPt><img src=x onerror="window.__jsonLdExecuted = true">'
    const company = {
      "@context": "https://schema.org",
      "@graph": [{
        "@type": "Organization",
        name: scriptPayload,
        description: imagePayload,
        url: `https://example.com/?q=${scriptPayload}&tag=R&D`,
        logo: "<!--<script>comment</script>",
      }, {
        "@type": "BreadcrumbList",
        itemListElement: [{ "@type": "ListItem", position: 1, name: scriptPayload }],
      }],
    }

    // Verify this browser executes the harmless proof payload without escaping.
    const unsafePage = await browser.newPage()
    await unsafePage.setContent(`<script type="application/ld+json">${JSON.stringify({ name: scriptPayload })}</script>`)
    assert.equal(await unsafePage.evaluate(() => Reflect.get(window, "__jsonLdExecuted")), true)
    await unsafePage.close()

    // Exercise the same component rendered by both application pages.
    const page = await browser.newPage()
    const markup = renderToStaticMarkup(createElement(JsonLd, { data: company }))
    await page.setContent(`<!doctype html><html><body>${markup}<p id="after">After JSON-LD</p></body></html>`)

    assert.equal(await page.evaluate(() => Reflect.get(window, "__jsonLdExecuted")), undefined)
    assert.equal(await page.locator("script").count(), 1)
    assert.equal(await page.locator("img").count(), 0)
    assert.equal(await page.locator("#after").textContent(), "After JSON-LD")
    const json = await page.locator('script[type="application/ld+json"]').textContent()
    assert.deepEqual(JSON.parse(json!), company)
  } finally {
    await browser.close()
  }
})
