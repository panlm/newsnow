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
import { htmlToText } from "#/utils/html"
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

interface WhatsNewItem {
  item?: {
    additionalFields?: {
      headline?: string
      headlineUrl?: string
      postDateTime?: string
      postBody?: string
    }
  }
}

/** A directory entry, blog post or What's New announcement, as a card shows it. */
interface DirectoryPost {
  link: string
  title: string
  created?: string
  info?: string
  excerpt?: string
}

// The directory search API returns every blog channel at once (machine-learning,
// containers, networking, security, ...), unlike the per-channel RSS feeds.
// `item.locale=zh_CN` returns the AWS China blog (aws.amazon.com/cn/blogs/china/),
// `ja_JP` / `ko_KR` the Japan and Korea blogs (aws.amazon.com/jp/blogs/, /ko/blogs/).
const endpoint = "https://aws.amazon.com/api/dirs/items/search"
const directoryQuery = "item.directoryId=blog-posts&sort_by=item.additionalFields.createdDate&sort_order=desc"
// What's New (aws.amazon.com/new/) is a directory of its own. Most launches get only
// this one-paragraph announcement and never a blog post.
const whatsNewQuery = "item.directoryId=whats-new-v2&sort_by=item.additionalFields.postDateTime&sort_order=desc"

const DAY = 24 * 60 * 60 * 1000

function blogPost(entry: AwsBlogItem): DirectoryPost | undefined {
  const fields = entry?.item?.additionalFields
  if (!fields?.link || !fields.title) return undefined
  return {
    link: fields.link,
    title: fields.title,
    created: fields.createdDate,
    info: fields.displayDate,
    excerpt: fields.postExcerpt?.replace(/\s+/g, " ").trim(),
  }
}

function whatsNewPost(entry: WhatsNewItem): DirectoryPost | undefined {
  const fields = entry?.item?.additionalFields
  const title = fields?.headline?.trim()
  if (!fields?.headlineUrl || !title) return undefined
  const created = fields.postDateTime
  const time = Date.parse(created ?? "")
  return {
    // The directory gives a site-relative path, /about-aws/whats-new/2026/10/<slug>/.
    link: new URL(fields.headlineUrl, "https://aws.amazon.com").href,
    title,
    created,
    // "09 Oct 2026", the same form as a blog post's displayDate.
    info: Number.isNaN(time) ? undefined : new Date(time).toUTCString().slice(5, 16),
    excerpt: fields.postBody ? htmlToText(fields.postBody) : undefined,
  }
}

/**
 * Keep every post of the last `RecentDays` days, topped up to `MaxItems` when the
 * window holds fewer: awsblog-all publishes ~120 posts in 8 days, but the China blog
 * and most categories only a handful (some none), so a strict window would empty
 * their cards. Pages are fetched newest first until one reaches past the window.
 */
async function fetchPosts<T>(url: string, read: (entry: T) => DirectoryPost | undefined) {
  const since = Date.now() - RecentDays * DAY
  const items = new Map<string, NewsItem>()
  let inWindow = 0
  for (let page = 0; items.size < RecentMaxItems; page++) {
    const res = await myFetch<{ items?: T[] }>(`${url}&page=${page}`, { responseType: "json" })
    const entries = res?.items ?? []
    let oldest: string | undefined
    for (const post of entries.map(read)) {
      if (!post) continue
      oldest = post.created ?? oldest
      // A post published mid-paging shifts the next page by one, so dedupe by link.
      if (items.has(post.link)) continue
      items.set(post.link, {
        id: post.link,
        title: post.title,
        url: post.link,
        extra: { info: post.info, hover: post.excerpt },
      })
      if (Date.parse(post.created ?? "") >= since) inWindow = items.size
    }
    if (entries.length < MaxItems || !oldest || Date.parse(oldest) < since) break
  }
  return [...items.values()].slice(0, Math.min(Math.max(inWindow, MaxItems), RecentMaxItems))
}

type Locale = "en_US" | "zh_CN" | "ja_JP" | "ko_KR"

function feed(locale: Locale = "en_US") {
  const url = `${endpoint}?${directoryQuery}&size=${MaxItems}&item.locale=${locale}`

  return defineSource(async () => {
    const items = await fetchPosts(url, blogPost)
    if (locale === "en_US") return withTranslatedHover(items)
    // China blog excerpts are already Chinese.
    if (locale === "zh_CN") return items
    return withTranslatedTitleAndHover(items, locale === "ja_JP" ? "ja" : "ko")
  })
}

function whatsNewFeed() {
  const url = `${endpoint}?${whatsNewQuery}&size=${MaxItems}&item.locale=en_US`
  return defineSource(async () => withTranslatedHover(await fetchPosts(url, whatsNewPost)))
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
  "awsblog-whatsnew": whatsNewFeed(),
  ...channelFeeds,
})

export const __awsblogInternals = { whatsNewPost }
