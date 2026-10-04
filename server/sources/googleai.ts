import type { NewsItem } from "@shared/types"
import { withTranslatedHover } from "#/utils/translate"

const RESEARCH_FEED = "https://research.google/blog/rss/"
const RESEARCH_ORIGIN = "https://research.google/"
const LEDE_CONCURRENCY = 6

// The Research feed's <description> is just the post's category and the post pages
// carry no meta description, so the hover is the lede of each page, read once.
const ledes = new Map<string, string>()

async function research() {
  const xml = await myFetch(RESEARCH_FEED, { responseType: "text" })
  const entries = parseFeed(xml as string).slice(0, MaxItems)
  if (!entries.length) throw new Error("Cannot fetch feed data")

  const unread = entries.filter(entry => entry.url.startsWith(RESEARCH_ORIGIN) && !ledes.has(entry.url))
  await mapWithConcurrency(unread, LEDE_CONCURRENCY, async (entry) => {
    try {
      const html = await myFetch<string>(entry.url, { responseType: "text" as any, timeout: 15000, retry: 0 })
      const lede = firstParagraph(html)
      if (lede) ledes.set(entry.url, lede)
    } catch {}
  })
  const items = entries.map<NewsItem>(entry => ({
    id: entry.url,
    title: entry.title,
    url: entry.url,
    pubDate: entry.pubDate,
    extra: {
      hover: ledes.get(entry.url),
    },
  }))
  return withTranslatedHover(items)
}

// Google's AI announcements (The Keyword) and the Google Research blog, which is
// what the old Google AI Blog (ai.googleblog.com) became.
export default defineSource({
  "googleai-news": defineTranslatedFeedSource("https://blog.google/technology/ai/rss/"),
  "googleai-research": research,
})
