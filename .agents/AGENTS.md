<!-- BEGIN:robust-web-scraping -->
# Robust Web Scraping & Selector Hygiene
When writing or modifying web scrapers (e.g., Playwright, Puppeteer, Cheerio):
1. **Avoid Global Fallbacks for Specific Data**: Never use broad tag selectors (like `a[href^="http"]` or `h3`) globally across the document to extract entity-specific data. They frequently capture global navigation, headers, or footers (e.g., capturing a 'Home' link instead of a company's website).
2. **Use Contextual Scoping**: Always locate the specific container element first (e.g., `.founder-card` or `#main-content`), and scope your subsequent `querySelector` calls within that container.
3. **Explicit Denylists**: When extracting external links (like a company website or social profile), explicitly filter out the host domain and known internal/partner domains to prevent capturing navigation links.
4. **Resilient Text Extraction**: Do not rely purely on semantic HTML tags (`h1`, `h2`) being present; modern SPAs frequently use utility classes (`.text-2xl`, `.font-bold`) without semantic tags. Use CSS properties or class pattern matching as robust fallbacks.
<!-- END:robust-web-scraping -->
