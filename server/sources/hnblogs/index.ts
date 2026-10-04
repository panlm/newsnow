import type { NewsItem } from "@shared/types"
import { FEEDS } from "./feeds"
import type { FeedEntry } from "#/utils/feed"
import { withTranslatedHover } from "#/utils/translate"

const FEED_TIMEOUT_MS = 8000
const CONCURRENCY = 16
const DAY = 24 * 60 * 60 * 1000
const UA = "Mozilla/5.0 (compatible; NewsNow; +https://newsnow.aws.panlm.click)"

interface CachedFeed {
  etag?: string
  lastModified?: string
  entries: FeedEntry[]
}

// Most of these blogs post a few times a month and answer ETag / Last-Modified, so
// after the first pass a refresh is mostly 304s instead of ~25 MB of XML.
const feedCache = new Map<string, CachedFeed>()

async function readFeed(url: string) {
  const cached = feedCache.get(url)
  try {
    const res = await myFetch.raw<string, "text">(url, {
      responseType: "text",
      headers: {
        "User-Agent": UA,
        "Accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
        ...(cached?.etag ? { "If-None-Match": cached.etag } : {}),
        ...(cached?.lastModified ? { "If-Modified-Since": cached.lastModified } : {}),
      },
      timeout: FEED_TIMEOUT_MS,
      retry: 0,
    })
    if (res.status === 304 && cached) return cached.entries
    const entries = parseFeed(res._data ?? "")
    feedCache.set(url, {
      etag: res.headers.get("etag") ?? undefined,
      lastModified: res.headers.get("last-modified") ?? undefined,
      entries,
    })
    return entries
  } catch {
    // One dead blog must not sink the block: keep serving its last good copy.
    return cached?.entries ?? []
  }
}

export default defineSource({
  hnblogs: async () => {
    const perFeed = await mapWithConcurrency(FEEDS, CONCURRENCY, async feed =>
      (await readFeed(feed.url)).map(entry => ({ ...entry, blog: feed.name })))
    const now = Date.now()
    const seen = new Set<string>()
    const posts = perFeed.flat()
      // Undated posts cannot be placed in time; future dates are feed mistakes.
      .filter(post => post.pubDate && post.pubDate <= now + DAY)
      .sort((a, b) => b.pubDate! - a.pubDate!)
      .filter(post => !seen.has(post.url) && !!seen.add(post.url))
    if (!posts.length) throw new Error("No HN blog feed answered")

    // Same rule as the AWS blog: every post of the last RecentDays days, topped up
    // to MaxItems in a quiet week.
    const since = now - RecentDays * DAY
    const inWindow = posts.filter(post => post.pubDate! >= since).length
    const items = posts
      .slice(0, Math.min(Math.max(inWindow, MaxItems), RecentMaxItems))
      .map<NewsItem>(post => ({
        id: post.url,
        title: post.title,
        url: post.url,
        pubDate: post.pubDate,
        extra: {
          info: post.blog,
          hover: post.summary,
        },
      }))
    return withTranslatedHover(items)
  },
})
