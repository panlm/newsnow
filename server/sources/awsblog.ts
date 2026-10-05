import type { AllSourceID, NewsItem } from "@shared/types"
import type { SourceGetter } from "#/types"
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
 * Posts carry two category axes, filled inconsistently. `blog-posts#category` is
 * the one the blog homepage filters on and every post has it, while
 * `GLOBAL#tech-category` is missing on about a third of 2026's posts (most of the
 * Machine Learning Blog). Yet some Compute, Management, Application Integration and
 * Mobile posts carry only the tech category. So a category matches either axis:
 * `|` inside one `tags.id` is OR, while repeating `tags.id` would be AND.
 *
 * Only topic values of `blog-posts#category` are listed, because it also holds
 * bookkeeping values (post-types, learning-levels, industries). The homepage
 * filter's own security, iot, mobile and networking values match no posts; the
 * posts use the spellings below.
 */
const BLOG_CATEGORY_NAMESPACE = "blog-posts#category"
const TECH_CATEGORY_NAMESPACE = "GLOBAL#tech-category"

function categoryTags(blogCategories: string[], techCategory?: string) {
  const tags = blogCategories.map(category => `${BLOG_CATEGORY_NAMESPACE}#${category}`)
  return techCategory ? [...tags, `${TECH_CATEGORY_NAMESPACE}#${techCategory}`] : tags
}

const categories = {
  "awsblog-compute": categoryTags(["compute"], "compute"),
  "awsblog-ai": categoryTags(["artificial-intelligence", "generative-ai-2"], "ai-ml"),
  "awsblog-security": categoryTags(["security-identity-compliance"], "security-identity-compliance"),
  "awsblog-databases": categoryTags(["database"], "databases"),
  "awsblog-analytics": categoryTags(["analytics"], "analytics"),
  "awsblog-storage": categoryTags(["storage"], "storage"),
  "awsblog-management": categoryTags(["management-tools", "management-and-governance"], "mgmt-govern"),
  "awsblog-networking": categoryTags(["networking-content-delivery"], "networking-content-dev"),
  "awsblog-integration": categoryTags(["application-integration"], "app-integration"),
  "awsblog-mobile": categoryTags(["mobile-services"], "mobile"),
  "awsblog-devtools": categoryTags(["developer-tools"], "devtools"),
  "awsblog-iot": categoryTags(["internet-of-things"], "iot"),
  "awsblog-robotics": categoryTags(["robotics"], "robotics"),
  "awsblog-quantum": categoryTags(["quantum-technologies"], "quantum"),
  "awsblog-media": categoryTags(["media-services"], "media-services"),
  "awsblog-migration": categoryTags(["migration", "migration-solutions"], "migration"),
  "awsblog-satellite": categoryTags(["satellite"], "satellite"),
  "awsblog-blockchain": categoryTags(["blockchain"], "blockchain"),
  // Topics with no tech-category counterpart. The homepage labels
  // aws-cloud-financial-management "Business Applications", but its posts are
  // about billing and FinOps.
  "awsblog-architecture": categoryTags(["architecture"]),
  "awsblog-cfm": categoryTags(["aws-cloud-financial-management"]),
  "awsblog-euc": categoryTags(["end-user-computing", "desktop-app-streaming"]),
  "awsblog-hpc": categoryTags(["high-performance-computing"]),
  "awsblog-serverless": categoryTags(["serverless"]),
  "awsblog-containers": categoryTags(["containers"]),
  "awsblog-devops": categoryTags(["devops"]),
  "awsblog-messaging": categoryTags(["messaging"]),
  "awsblog-opensource": categoryTags(["open-source"]),
  "awsblog-strategy": categoryTags(["enterprise-strategy"]),
  "awsblog-sustainability": categoryTags(["sustainability"]),
  "awsblog-supplychain": categoryTags(["supply-chain"]),
} satisfies Partial<Record<AllSourceID, string[]>>

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

function feedUrl(tags?: string[], locale: Locale = "en_US") {
  const query = `${baseQuery}&item.locale=${locale}`
  return tags
    ? `${endpoint}?${query}&tags.id=${encodeURIComponent(tags.join("|"))}`
    : `${endpoint}?${query}`
}

function feed(tags?: string[], locale: Locale = "en_US") {
  const url = feedUrl(tags, locale)

  return defineSource(async () => {
    const items = await fetchPosts(url)
    if (locale === "en_US") return withTranslatedHover(items)
    // China blog excerpts are already Chinese.
    if (locale === "zh_CN") return items
    return withTranslatedTitleAndHover(items, locale === "ja_JP" ? "ja" : "ko")
  })
}

const categoryFeeds = Object.fromEntries(
  Object.entries(categories).map(([id, tags]) => [id, feed(tags)]),
) as Record<keyof typeof categories, SourceGetter>

export default defineSource({
  "awsblog-all": feed(),
  "awsblog-china": feed(undefined, "zh_CN"),
  "awsblog-japan": feed(undefined, "ja_JP"),
  "awsblog-korea": feed(undefined, "ko_KR"),
  ...categoryFeeds,
})

export const __awsblogInternals = { categories, feedUrl }
