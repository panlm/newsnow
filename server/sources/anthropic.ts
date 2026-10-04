import type { NewsItem } from "@shared/types"
import { withTranslatedHover } from "#/utils/translate"

// Anthropic has no RSS. /news, /engineering and /research are server-rendered and
// list each post as <a href="/<section>/<slug>"> ... <time>DATE</time> ... TITLE,
// where TITLE sits in a `__title` element on /news and /research and in a plain
// heading on /engineering. The CSS-module class hashes churn per deploy, so anchor
// on the stable readable suffix (`__title`) and the section href, never the hash.
const ORIGIN = "https://www.anthropic.com"
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"

const HOVER_CONCURRENCY = 6
const MAX_POSTS = 30

// A post's excerpt does not change, so each page is fetched once.
const excerpts = new Map<string, string>()
const SITE_BLURB = /^Anthropic is an AI safety and research company\b/

/**
 * The og:description (or meta description) of a post page for the hover. Engineering
 * posts only carry the site-wide blurb there, so fall back to the lede.
 */
async function fetchExcerpt(url: string) {
  const cached = excerpts.get(url)
  if (cached) return cached
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
    const description = og?.[1] ? htmlToText(og[1]) : ""
    const text = description && !SITE_BLURB.test(description) ? description : firstParagraph(html) ?? ""
    if (text) excerpts.set(url, text)
    return text || undefined
  } catch {
    return undefined
  }
}

function parseListing(html: string, section: string) {
  const seen = new Set<string>()
  const posts: { url: string, title: string, date?: string }[] = []
  const anchor = new RegExp(`<a[^>]+href="(/${section}/[^"#?]+)"[^>]*>([\\s\\S]*?)</a>`, "g")
  for (const [, href, inner] of html.matchAll(anchor)) {
    if (seen.has(href)) continue
    const title = htmlToText(
      inner.match(/__title[^>]*>([\s\S]*?)<\/(?:span|h\d)>/)?.[1]
      ?? inner.match(/<h\d[^>]*>([\s\S]*?)<\/h\d>/)?.[1]
      ?? "",
    )
    if (!title) continue
    seen.add(href)
    const date = inner.match(/<time[^>]*>([^<]+)<\/time>/)?.[1]
    posts.push({ url: `${ORIGIN}${href}`, title, date: date ? htmlToText(date) : undefined })
    if (posts.length >= MAX_POSTS) break
  }
  // /research leads with a featured grid out of date order. /engineering features
  // one post without a date; keep it on top, where the site puts it.
  const time = (date?: string) => (date && Date.parse(date)) || Number.POSITIVE_INFINITY
  return posts.sort((a, b) => time(b.date) - time(a.date))
}

function section(name: "news" | "engineering" | "research") {
  return defineSource(async () => {
    const html = await myFetch<string>(`${ORIGIN}/${name}`, {
      responseType: "text" as any,
      headers: { "User-Agent": UA },
    })
    const posts = parseListing(html, name)
    if (!posts.length) throw new Error(`Anthropic /${name} lists no posts`)

    const hovers = await mapWithConcurrency(posts, HOVER_CONCURRENCY, post => fetchExcerpt(post.url))
    const items = posts.map<NewsItem>((post, i) => ({
      id: post.url,
      title: post.title,
      url: post.url,
      extra: {
        info: post.date,
        hover: hovers[i],
      },
    }))
    return withTranslatedHover(items)
  })
}

export default defineSource({
  "anthropic-news": section("news"),
  "anthropic-engineering": section("engineering"),
  "anthropic-research": section("research"),
})

export const __anthropicInternals = { parseListing }
