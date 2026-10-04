import type { NewsItem } from "@shared/types"
import { withTranslatedHover } from "#/utils/translate"

const BLOG = "https://ai.meta.com/blog/"
// ai.meta.com answers a full desktop-Chrome UA (myFetch's default) with an error
// page, but serves the rendered page to a plain one.
const UA = "Mozilla/5.0"
const LIST_PAGES = 3
const POST_CONCURRENCY = 4
const MONTH_DATE = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}\b/

interface Post {
  title: string
  pubDate?: number
  excerpt?: string
}

// The listing shows each post twice with its date on different sides of the link,
// so read title and date off the post page instead. Posts don't change once
// published; each page is read once.
const posts = new Map<string, Post>()

function fetchPage(url: string) {
  return myFetch<string>(url, {
    responseType: "text" as any,
    headers: { "User-Agent": UA },
    timeout: 15000,
  })
}

async function readPost(url: string): Promise<Post | undefined> {
  const html = await fetchPage(url)
  const title = htmlToText(html.match(/<meta[^>]+og:title"[^>]+content="([^"]*)"/)?.[1] ?? "")
  if (!title) return undefined
  const date = html.match(MONTH_DATE)?.[0]
  // og:description is empty on these pages.
  return { title, pubDate: date ? Date.parse(date) : undefined, excerpt: firstParagraph(html) }
}

async function blog() {
  const pages = await Promise.all(Array.from({ length: LIST_PAGES }, (_, i) =>
    fetchPage(i ? `${BLOG}?page=${i + 1}` : BLOG).catch(() => "")))
  const urls = [...new Set(pages.flatMap(html =>
    [...html.matchAll(/href="(https:\/\/ai\.meta\.com\/blog\/[a-z0-9-]+\/)"/g)].map(match => match[1])))]
  if (!urls.length) throw new Error("Meta AI blog lists no posts")

  await mapWithConcurrency(urls.filter(url => !posts.has(url)), POST_CONCURRENCY, async (url) => {
    const post = await readPost(url).catch(() => undefined)
    if (post) posts.set(url, post)
  })
  const items = urls
    .flatMap<NewsItem>((url) => {
      const post = posts.get(url)
      return post ? [{ id: url, url, title: post.title, pubDate: post.pubDate, extra: { hover: post.excerpt } }] : []
    })
    .sort((a, b) => (Number(b.pubDate) || 0) - (Number(a.pubDate) || 0))
  return withTranslatedHover(items)
}

export default defineSource({
  "metaai-blog": blog,
  "metaai-news": defineTranslatedFeedSource("https://about.fb.com/news/tag/ai/feed/"),
})
