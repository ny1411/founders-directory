import assert from "node:assert/strict"
import { once } from "node:events"
import { existsSync, mkdirSync } from "node:fs"
import { createServer } from "node:http"
import { test } from "node:test"
import { build } from "esbuild"
import { chromium } from "playwright"
import { PHASE_PRODUCTION_BUILD } from "next/constants"
import loadConfig from "next/dist/server/config"
import { ImageOptimizerCache } from "next/dist/server/image-optimizer"
import nextConfig from "../../next.config"

test("real EntityImage and next/image reject unapproved sources and recover safely", { timeout: 60_000 }, async t => {
  // Browser plugin not available. Use Playwright with the actual components and
  // Next ingress validator; only upstream image bytes are replaced by fixtures.
  const config = await loadConfig(PHASE_PRODUCTION_BUILD, process.cwd(), { customConfig: nextConfig, silent: true })
  const images = config.images
  const bundle = await build({
    stdin: { contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
      import {EntityImage} from './src/components/entity-image';
      const logo='https://bookface-images.s3.amazonaws.com/small_logos/example.png';
      const signed='https://bookface-images.s3.us-west-2.amazonaws.com/avatars/example.jpg?X-Amz-Signature=fixture';
      function App(){const [src,setSrc]=useState('https://unapproved.invalid/logo.png');return <main>
        <h1>Company and founder images</h1><p>Approved images load; unsupported and failed sources have accessible fallbacks.</p>
        <section aria-label="Image examples">
          <article><h2>Approved company</h2><EntityImage src={logo} alt="Approved company logo" fallback="company" fallbackLabel="Approved company logo unavailable" width={64} height={64}/></article>
          <article><h2>Signed YC avatar</h2><EntityImage src={signed} alt="Signed founder avatar" fallback="person" fallbackLabel="Signed founder avatar unavailable" width={64} height={64}/></article>
          <article><h2>Unsupported legacy URL</h2><EntityImage src="https://unapproved.invalid/logo.svg" alt="Blocked logo" fallback="company" fallbackLabel="Blocked company logo unavailable" width={64} height={64}/></article>
          <article><h2>Malformed legacy data</h2><EntityImage src={42} alt="Malformed logo" fallback="company" fallbackLabel="Malformed company logo unavailable" width={64} height={64}/></article>
          <article><h2>Unavailable approved image</h2><EntityImage src={logo.replace('example','broken')} alt="Broken approved logo" fallback="company" fallbackLabel="Broken approved logo unavailable" width={64} height={64}/></article>
          <article><h2>Source changes</h2><EntityImage src={src} alt="Changed founder avatar" fallback="person" fallbackLabel="Changed founder avatar unavailable" width={64} height={64}/>
            <button onClick={()=>setSrc(logo)}>Use approved source</button><button onClick={()=>setSrc('https://unapproved.invalid/new.png')}>Use unsupported source</button>
          </article>
        </section>
      </main>}createRoot(document.getElementById('root')).render(<App/>);`,
      resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", tsconfig: "tsconfig.json",
    define: { "process.env.NODE_ENV": '"production"', "process.env.__NEXT_IMAGE_OPTS": JSON.stringify(images) },
  })
  const requestedImages: string[] = []
  const unexpected: string[] = []
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64")
  const server = createServer((request, response) => {
    const url = new URL(request.url!, "http://localhost")
    if (url.pathname === "/client.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].text); return }
    if (url.pathname === "/favicon.ico") { response.statusCode = 204; response.end(); return }
    if (url.pathname === "/_next/image") {
      const params = ImageOptimizerCache.validateParams(request, Object.fromEntries(url.searchParams), config, false)
      assert.ok(!("errorMessage" in params), "Rendered images satisfy the real optimizer policy")
      const src = url.searchParams.get("url")!
      requestedImages.push(src)
      response.setHeader("content-type", "image/png")
      response.end(src.includes("broken") ? "not an image" : png)
      return
    }
    response.setHeader("content-type", "text/html")
    response.end(`<!doctype html><html lang="en"><head><title>Image policy regression</title><style>
      *{box-sizing:border-box}body{margin:0;background:#faf9f6;color:#171717;font:16px system-ui}main{max-width:1000px;margin:auto;padding:24px}
      section{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}article{padding:16px;border:1px solid #ddd;border-radius:12px}
      h1{font-size:28px}h2{font-size:17px}button{display:block;padding:8px;margin-top:12px}span[role=img]{display:inline-flex;align-items:center;justify-content:center;background:#eee;border-radius:8px}
      svg{width:26px;height:26px}
    </style></head><body><div id="root"></div><script src="/client.js"></script></body></html>`)
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  const origin = `http://127.0.0.1:${address.port}`
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.CHROMIUM_PATH || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined) })
  t.after(async () => { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())) })

  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await t.test(`${viewport.width}px: loaded images, safe fallbacks and source changes`, async () => {
      const page = await browser.newPage({ viewport })
      const errors: string[] = []
      page.on("pageerror", error => errors.push(error.message))
      page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()) })
      page.on("request", request => { if (!request.url().startsWith(origin)) unexpected.push(request.url()) })
      await page.goto(`${origin}/image-policy`)
      assert.equal(page.url(), `${origin}/image-policy`)
      assert.equal(await page.title(), "Image policy regression")
      await page.getByRole("heading", { name: "Company and founder images" }).waitFor()
      for (const name of ["Approved company logo", "Signed founder avatar"]) {
        await page.getByRole("img", { name, exact: true }).evaluate(async image => {
          if (!(image as HTMLImageElement).complete) await new Promise(resolve => image.addEventListener("load", resolve, { once: true }))
          if (!(image as HTMLImageElement).naturalWidth) throw new Error("Approved image did not decode")
        })
      }
      for (const name of ["Blocked company logo unavailable", "Malformed company logo unavailable", "Broken approved logo unavailable", "Changed founder avatar unavailable"]) {
        await page.getByRole("img", { name, exact: true }).waitFor()
      }
      await page.getByRole("button", { name: "Use approved source", exact: true }).click()
      await page.getByRole("img", { name: "Changed founder avatar", exact: true }).waitFor()
      await page.getByRole("button", { name: "Use unsupported source", exact: true }).click()
      await page.getByRole("img", { name: "Changed founder avatar unavailable", exact: true }).waitFor()
      assert.equal(await page.locator("nextjs-portal").count(), 0)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
      assert.deepEqual(errors, [])
      if (process.env.IMAGE_POLICY_SCREENSHOT_DIR) {
        mkdirSync(process.env.IMAGE_POLICY_SCREENSHOT_DIR, { recursive: true })
        await page.screenshot({ path: `${process.env.IMAGE_POLICY_SCREENSHOT_DIR}/image-policy-${viewport.width}.png`, fullPage: true })
      }
      await page.close()
    })
  }
  assert.ok(requestedImages.length > 0)
  assert.ok(requestedImages.every(src => src.startsWith("https://bookface-images.s3")))
  assert.deepEqual(unexpected, [], "Unsupported sources never reach the browser network")
})
