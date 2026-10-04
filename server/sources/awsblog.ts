import type { NewsItem } from "@shared/types"
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
const baseQuery = `item.directoryId=blog-posts&sort_by=item.additionalFields.createdDate&sort_order=desc&size=${MaxItems}`

const DAY = 24 * 60 * 60 * 1000

/**
 * Posts carry two category axes. `blog-posts#category` mixes real topics with
 * bookkeeping tags (post-types, learning-levels), so filter on
 * `GLOBAL#tech-category` instead — one tag per AWS service category.
 */
const TECH_CATEGORY_NAMESPACE = "GLOBAL#tech-category"

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

function feed(category?: string, locale: "en_US" | "zh_CN" | "ja_JP" | "ko_KR" = "en_US") {
  const query = `${baseQuery}&item.locale=${locale}`
  const url = category
    ? `${endpoint}?${query}&tags.id=${encodeURIComponent(`${TECH_CATEGORY_NAMESPACE}#${category}`)}`
    : `${endpoint}?${query}`

  return defineSource(async () => {
    const items = await fetchPosts(url)
    if (locale === "en_US") return withTranslatedHover(items)
    // China blog excerpts are already Chinese.
    if (locale === "zh_CN") return items
    return withTranslatedTitleAndHover(items, locale === "ja_JP" ? "ja" : "ko")
  })
}

export default defineSource({
  "awsblog-all": feed(),
  "awsblog-china": feed(undefined, "zh_CN"),
  "awsblog-japan": feed(undefined, "ja_JP"),
  "awsblog-korea": feed(undefined, "ko_KR"),
  "awsblog-compute": feed("compute"),
  "awsblog-ai": feed("ai-ml"),
  "awsblog-security": feed("security-identity-compliance"),
  "awsblog-databases": feed("databases"),
  "awsblog-analytics": feed("analytics"),
  "awsblog-storage": feed("storage"),
  "awsblog-management": feed("mgmt-govern"),
  "awsblog-networking": feed("networking-content-dev"),
  "awsblog-integration": feed("app-integration"),
  "awsblog-mobile": feed("mobile"),
  "awsblog-devtools": feed("devtools"),
  "awsblog-iot": feed("iot"),
  "awsblog-robotics": feed("robotics"),
  "awsblog-quantum": feed("quantum"),
  "awsblog-media": feed("media-services"),
  "awsblog-migration": feed("migration"),
  "awsblog-satellite": feed("satellite"),
  "awsblog-blockchain": feed("blockchain"),
})
