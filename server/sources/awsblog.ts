import type { NewsItem } from "@shared/types"
import type { Database } from "db0"
import type { SourceGetter } from "#/types"
import type { AwsBlogBlockId, AwsBlogPost } from "#/utils/awsblog-index"
import {
  awsBlogChannelGroups,
  awsBlogChannelOf,
  awsBlogOtherId,
  createAwsBlogDbStore,
  createAwsBlogIndex,
  createAwsBlogMemoryStore,
} from "#/utils/awsblog-index"
import { withTranslatedHover, withTranslatedTitleAndHover } from "#/utils/translate"

interface AwsBlogItem {
  item?: {
    additionalFields?: {
      title?: string
      link?: string
      createdDate?: string
      displayDate?: string
      postExcerpt?: string
    }
  }
}

// The directory search API returns every blog channel at once (machine-learning,
// containers, networking, security, ...), unlike the per-channel RSS feeds.
// `item.locale=zh_CN` returns the AWS China blog (aws.amazon.com/cn/blogs/china/),
// `ja_JP` / `ko_KR` the Japan and Korea blogs (aws.amazon.com/jp/blogs/, /ko/blogs/).
const endpoint = "https://aws.amazon.com/api/dirs/items/search"
const directoryQuery = "item.directoryId=blog-posts&sort_by=item.additionalFields.createdDate&sort_order=desc"

const DAY = 24 * 60 * 60 * 1000

/**
 * Keep every post of the last `RecentDays` days, topped up to `MaxItems` when the
 * window holds fewer: awsblog-all publishes ~120 posts in 8 days, but the China blog
 * and most categories only a handful (some none), so a strict window would empty
 * their cards. Pages are fetched newest first until one reaches past the window.
 */
async function fetchPosts(url: string) {
  const since = Date.now() - RecentDays * DAY
  const items = new Map<string, NewsItem>()
  let inWindow = 0
  for (let page = 0; items.size < RecentMaxItems; page++) {
    const res = await myFetch<{ items?: AwsBlogItem[] }>(`${url}&page=${page}`, { responseType: "json" })
    const batch = (res?.items ?? []).map(entry => entry?.item?.additionalFields)
    for (const fields of batch) {
      // A post published mid-paging shifts the next page by one, so dedupe by link.
      if (!fields?.link || !fields.title || items.has(fields.link)) continue
      items.set(fields.link, {
        id: fields.link,
        title: fields.title,
        url: fields.link,
        extra: {
          info: fields.displayDate,
          hover: fields.postExcerpt?.replace(/\s+/g, " ").trim(),
        },
      })
      if (Date.parse(fields.createdDate ?? "") >= since) inWindow = items.size
    }
    const oldest = batch.at(-1)?.createdDate
    if (batch.length < MaxItems || !oldest || Date.parse(oldest) < since) break
  }
  return [...items.values()].slice(0, Math.min(Math.max(inWindow, MaxItems), RecentMaxItems))
}

type Locale = "en_US" | "zh_CN" | "ja_JP" | "ko_KR"

function feed(locale: Locale = "en_US") {
  const url = `${endpoint}?${directoryQuery}&size=${MaxItems}&item.locale=${locale}`

  return defineSource(async () => {
    const items = await fetchPosts(url)
    if (locale === "en_US") return withTranslatedHover(items)
    // China blog excerpts are already Chinese.
    if (locale === "zh_CN") return items
    return withTranslatedTitleAndHover(items, locale === "ja_JP" ? "ja" : "ko")
  })
}

/** One page of the English blog posts of every channel, newest first. */
async function fetchEnglishPage(page: number, size: number): Promise<AwsBlogPost[]> {
  const res = await myFetch<{ items?: AwsBlogItem[] }>(
    `${endpoint}?${directoryQuery}&item.locale=en_US&size=${size}&page=${page}`,
    // The seed page holds 2,000 posts.
    { responseType: "json", timeout: 30_000 },
  )
  return (res?.items ?? []).flatMap((entry) => {
    const fields = entry?.item?.additionalFields
    const channel = fields?.link ? awsBlogChannelOf(fields.link) : undefined
    if (!fields?.link || !fields.title || !fields.createdDate || !channel) return []
    return [{
      link: fields.link,
      channel,
      title: fields.title,
      created: fields.createdDate,
      displayDate: fields.displayDate,
      excerpt: fields.postExcerpt?.replace(/\s+/g, " ").trim(),
    }]
  })
}

let channelIndex: ReturnType<typeof createAwsBlogIndex> | undefined

function getChannelIndex() {
  if (!channelIndex) {
    let db: Database | undefined
    try {
      db = useDatabase() as Database
    } catch {
      // Without a database the posts live in memory and start over on restart.
    }
    channelIndex = createAwsBlogIndex({
      store: db ? createAwsBlogDbStore(db) : createAwsBlogMemoryStore(),
      fetchPage: fetchEnglishPage,
    })
  }
  return channelIndex
}

function channelFeed(id: AwsBlogBlockId) {
  return defineSource(async () => {
    const index = getChannelIndex()
    await index.sync()
    const posts = await index.postsFor(id)
    return withTranslatedHover(posts.map((post): NewsItem => ({
      id: post.link,
      title: post.title,
      url: post.link,
      extra: { info: post.displayDate, hover: post.excerpt },
    })))
  })
}

const channelFeeds = Object.fromEntries(
  [...awsBlogChannelGroups.map(group => group.id), awsBlogOtherId].map(id => [id, channelFeed(id)]),
) as Record<AwsBlogBlockId, SourceGetter>

export default defineSource({
  "awsblog-all": feed(),
  "awsblog-china": feed("zh_CN"),
  "awsblog-japan": feed("ja_JP"),
  "awsblog-korea": feed("ko_KR"),
  ...channelFeeds,
})
