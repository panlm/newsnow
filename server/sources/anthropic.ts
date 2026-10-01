import type { NewsItem } from "@shared/types"
import { withTranslatedHover } from "#/utils/translate"

// Anthropic has no RSS. The /news page is server-rendered and lists each post as
// <a href="/news/<slug>"> ... <time>DATE</time> ... <span class="...__title...">TITLE</span>.
// The CSS-module class hashes churn per deploy, so anchor on the stable readable
// suffixes (`__title`, `__date`) and the /news/ href, never the hash.
const LIST_URL = "https://www.anthropic.com/news"
const ORIGIN = "https://www.anthropic.com"
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"

const HOVER_CONCURRENCY = 6

function decodeEntities(text: string) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number.parseInt(d, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;|&apos;/gi, "'")
    .replace(/&nbsp;/g, " ")
}

function clean(text: string) {
  return decodeEntities(text.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
}

/** Pull the og:description (or meta description) off a post page for the hover. */
async function fetchExcerpt(url: string) {
  try {
    const html = await myFetch<string>(url, {
      responseType: "text" as any,
      headers: { "User-Agent": UA },
      timeout: 15000,
      retry: 0,
    })
    if (typeof html !== "string") return undefined
    const og = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i)
      ?? html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i)
    const text = og?.[1] ? clean(og[1]) : ""
    return text || undefined
  } catch {
    return undefined
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const result = Array.from({ length: items.length }) as R[]
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      result[i] = await fn(items[i])
    }
  }))
  return result
}

export default defineSource(async () => {
  const html = await myFetch<string>(LIST_URL, {
    responseType: "text" as any,
    headers: { "User-Agent": UA },
  })

  const seen = new Set<string>()
  const parsed: { url: string, title: string, date?: string }[] = []
  const anchor = /<a[^>]+href="(\/news\/[^"#?]+)"[^>]*>([\s\S]*?)<\/a>/g
  let m: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((m = anchor.exec(html)) !== null) {
    const href = m[1]
    const inner = m[2]
    if (seen.has(href)) continue
    const titleMatch = inner.match(/__title[^>]*>([\s\S]*?)<\/span>/)
    if (!titleMatch) continue
    const title = clean(titleMatch[1])
    if (!title) continue
    const dateMatch = inner.match(/<time[^>]*>([^<]+)<\/time>/)
    seen.add(href)
    parsed.push({ url: `${ORIGIN}${href}`, title, date: dateMatch ? clean(dateMatch[1]) : undefined })
    if (parsed.length >= 30) break
  }

  const excerpts = await mapWithConcurrency(parsed, HOVER_CONCURRENCY, p => fetchExcerpt(p.url))

  const items = parsed.map<NewsItem>((p, i) => ({
    id: p.url,
    title: p.title,
    url: p.url,
    extra: {
      info: p.date,
      hover: excerpts[i],
    },
  }))

  return withTranslatedHover(items)
})
